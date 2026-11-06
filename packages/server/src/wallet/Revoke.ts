import { AssertionRequest } from '@ethmumbai/auth'
import { arcAddresses } from '@ethmumbai/chain/Env'
import { buildRevoke, redeemCalldata, revokeExecution } from '@ethmumbai/chain/Grant'
import { encodePermissionContext } from '@ethmumbai/chain/Hashes'
import { Delegation, delegationDigest } from '@ethmumbai/protocol/Delegation'
import { Effect, Layer, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { decodeBody } from '../auth/Routes.ts'
import { CurrentSession, requireSession, type SessionAccount } from '../auth/Session.ts'
import { json } from '../Respond.ts'
import type { GrantRow } from '../robot/Budget.ts'
import { changes } from '../Sql.ts'
import type { WalletDeps } from './Deps.ts'
import { answerWalletErrors, ChainFailed, Conflict, required } from './Errors.ts'
import { readGrant } from './Grants.ts'
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
        key: `revoke:${row.delegation_hash}`,
        kind: 'revoke',
        to: arcAddresses.delegationManager,
        data: redeemCalldata(encodePermissionContext([{ ...revoke, signature }]), revokeExecution(grant)),
      })
      .pipe(
        Effect.catchTags({
          AlreadySubmitted: ({ status }) => restoreAndFail(`already submitted (${status})`),
          RelayerError: ({ message }) => restoreAndFail(message),
          RelayerStoreError: ({ message }) => restoreAndFail(message),
        }),
      )
    if (!sent.success) return yield* restoreAndFail('revoke reverted on chain')
    yield* setStatus(deps, row.id, 'revoking', 'revoked', sent.txHash)
    yield* Effect.logInfo('grant revoked').pipe(Effect.annotateLogs({ grantId: row.id, txHash: sent.txHash }))
    return yield* json({ grantId: row.id, status: 'revoked', revokeTx: sent.txHash })
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
