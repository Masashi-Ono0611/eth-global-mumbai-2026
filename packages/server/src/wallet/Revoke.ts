import { AssertionRequest } from '@ethmumbai/auth'
import { arcAddresses } from '@ethmumbai/chain/Env'
import { rpc } from '@ethmumbai/chain/Arc'
import { buildRevoke, delegationManagerAbi, redeemCalldata, revokeExecution } from '@ethmumbai/chain/Grant'
import { encodePermissionContext } from '@ethmumbai/chain/Hashes'
import { Delegation, delegationDigest } from '@ethmumbai/protocol/Delegation'
import { isHex } from '@ethmumbai/protocol/Hex'
import { Effect, Layer, Option, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { decodeBody } from '../auth/Routes.ts'
import { CurrentSession, requireSession, type SessionAccount } from '../auth/Session.ts'
import { json } from '../Respond.ts'
import type { GrantRow } from '../robot/Budget.ts'
import { changes, firstRow } from '../Sql.ts'
import type { WalletDeps } from './Deps.ts'
import { answerWalletErrors, ChainFailed, Conflict, required } from './Errors.ts'
import { readGrant } from './Grants.ts'
import { enqueueNotification } from '../telegram/Enqueue.ts'
import { ownerSignature, ownerSignatureOptions } from './OwnerSignature.ts'

const GrantPath = Schema.Struct({ id: Schema.String })
const SignedGrant = Schema.fromJsonString(Delegation)

/** The owner's one-time revoke delegation for an active grant: owner → relayer, ExactExecution(DM, 0,
 * disableDelegation(grant)) · LimitedCalls(1) (spec §4/§5). Deterministic, so options and sign rebuild the same. */
const revokeFor = Effect.fn('EthMumbai.Wallet.revokeFor')(function* (deps: WalletDeps, row: GrantRow) {
  const relayer = yield* required(deps.relayer, 'RELAYER_PRIVATE_KEY')
  if (row.status !== 'active') return yield* Conflict.make({ detail: `grant is ${row.status}` })
  const grant = yield* Schema.decodeUnknownEffect(SignedGrant)(row.delegation_json).pipe(Effect.orDie)
  return { relayer, grant, revoke: buildRevoke({ grantId: row.id, grant, relayer: relayer.address }) }
})

const grantOf = Effect.fn('EthMumbai.Wallet.grantOf')(function* (deps: WalletDeps, session: SessionAccount) {
  const { id } = yield* HttpRouter.schemaPathParams(GrantPath).pipe(Effect.orDie)
  return yield* readGrant(deps.database, session, id)
})

/** `POST /api/wallet/grants/:id/revoke/options` → the passkey prompt for the revoke delegation's digest. */
const revokeOptions = (deps: WalletDeps) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    const row = yield* grantOf(deps, session)
    const { revoke } = yield* revokeFor(deps, row)
    const prompt = yield* ownerSignatureOptions(deps.database, {
      accountId: session.accountId,
      action: 'revoke',
      ref: row.id,
      digest: delegationDigest(revoke),
    })
    return yield* json({ grantId: row.id, ...prompt })
  })

const setStatus = (deps: WalletDeps, grantId: string, from: string, to: string, tx: string | null) =>
  changes(
    deps.database
      .prepare('UPDATE grants SET status = ?, revoke_tx = COALESCE(?, revoke_tx) WHERE id = ? AND status = ?')
      .bind(to, tx, grantId, from),
  )

const revokeKey = (row: GrantRow) => `revoke:${row.delegation_hash}`

/** The grant is revoked on Arc: the owner hears it in Telegram (spec §14); queuing never fails the revoke. */
const revokedNotice = (deps: WalletDeps, row: GrantRow) =>
  enqueueNotification(deps.database, { accountId: row.account_id, kind: 'grant_revoked', subjectId: row.id })

const RelayerRow = Schema.Struct({ status: Schema.String, tx_hash: Schema.NullOr(Schema.String) })

/**
 * A revoke whose outcome the request did not see (receipt timeout, a second attempt, a store failure after the send):
 * Arc is the authority. Disabled on the DelegationManager → `revoked`; no broadcast or a failed one → `active` again
 * (the owner may retry); otherwise still `revoking`. Also run lazily by `GET /api/robots`.
 */
export const finalizeRevoke = Effect.fn('EthMumbai.Wallet.finalizeRevoke')(function* (deps: WalletDeps, row: GrantRow) {
  const relayed = yield* firstRow(
    deps.database.prepare('SELECT status, tx_hash FROM relayer_txs WHERE key = ?').bind(revokeKey(row)),
    RelayerRow,
  )
  const hash = row.delegation_hash
  const disabled = yield* Option.match(
    Option.filter(deps.arc, () => isHex(hash)),
    {
      onNone: () => Effect.succeed(false),
      onSome: (arc) =>
        rpc('disabledDelegations', () =>
          arc.readContract({
            address: arcAddresses.delegationManager,
            abi: delegationManagerAbi,
            functionName: 'disabledDelegations',
            args: [isHex(hash) ? hash : '0x'],
          }),
        ).pipe(Effect.orElseSucceed(() => false)),
    },
  )
  if (disabled) {
    const tx = Option.getOrNull(Option.flatMap(relayed, (relayer) => Option.fromNullishOr(relayer.tx_hash)))
    if ((yield* setStatus(deps, row.id, 'revoking', 'revoked', tx)) === 1) yield* revokedNotice(deps, row)
    return 'revoked' as const
  }
  if (Option.isNone(relayed) || relayed.value.status === 'failed') {
    yield* setStatus(deps, row.id, 'revoking', 'active', null)
    return 'active' as const
  }
  return 'revoking' as const
})

/** `POST /api/wallet/grants/:id/revoke/sign`: the relayer redeems the signed revoke, so Arc's DelegationManager
 * disables the grant (`revoke:<delegationHash>`); the next payment under it reverts `CannotUseADisabledDelegation`. */
const revokeSign = (deps: WalletDeps) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    const request = yield* decodeBody(AssertionRequest)
    const row = yield* grantOf(deps, session)
    const { relayer, grant, revoke } = yield* revokeFor(deps, row)
    const signature = yield* ownerSignature(deps.database, {
      accountId: session.accountId,
      action: 'revoke',
      ref: row.id,
      digest: delegationDigest(revoke),
      request,
    })
    const restoreAndFail = (reason: string) =>
      Effect.andThen(
        setStatus(deps, row.id, 'revoking', 'active', null),
        Effect.fail(ChainFailed.make({ stage: 'revoke', reason })),
      )
    if ((yield* setStatus(deps, row.id, 'active', 'revoking', null)) !== 1)
      return yield* Conflict.make({ detail: 'grant is no longer active' })
    const sent = yield* relayer
      .send({
        key: revokeKey(row),
        kind: 'revoke',
        to: arcAddresses.delegationManager,
        data: redeemCalldata(encodePermissionContext([{ ...revoke, signature }]), revokeExecution(grant)),
      })
      .pipe(
        Effect.map(Option.some),
        Effect.catchTags({
          // Never broadcast: nothing changed on Arc, so the grant is active again and the owner may retry.
          RelayerError: (error) => (error.stage === 'receipt' ? Effect.succeedNone : restoreAndFail(error.message)),
          // Possibly broadcast (another attempt, or the store failed after the send): Arc decides, below.
          AlreadySubmitted: () => Effect.succeedNone,
          RelayerStoreError: () => Effect.succeedNone,
        }),
      )
    if (Option.isSome(sent) && !sent.value.success) return yield* restoreAndFail('revoke reverted on chain')
    const status = Option.isSome(sent)
      ? yield* Effect.as(
          Effect.tap(setStatus(deps, row.id, 'revoking', 'revoked', sent.value.txHash), (moved) =>
            moved === 1 ? revokedNotice(deps, row) : Effect.void,
          ),
          'revoked' as const,
        )
      : yield* finalizeRevoke(deps, row)
    yield* Effect.logInfo('grant revoke').pipe(Effect.annotateLogs({ grantId: row.id, status }))
    const revokeTx = Option.isSome(sent) ? sent.value.txHash : null
    return yield* json({ grantId: row.id, status, revokeTx }, status === 'revoked' ? 200 : 202)
  })

export const revokeRoutes = (deps: WalletDeps) =>
  Layer.mergeAll(
    HttpRouter.add(
      'POST',
      '/api/wallet/grants/:id/revoke/options',
      requireSession(answerWalletErrors(revokeOptions(deps))),
    ),
    HttpRouter.add('POST', '/api/wallet/grants/:id/revoke/sign', requireSession(answerWalletErrors(revokeSign(deps)))),
  )
