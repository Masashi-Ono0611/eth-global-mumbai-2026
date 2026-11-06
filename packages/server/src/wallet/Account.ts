import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { type ArcClient, rpc } from '@ethmumbai/chain/Arc'
import { counterfactualAccount } from '@ethmumbai/chain/Owner'
import type { Relayer } from '@ethmumbai/chain/Relayer'
import { Effect, Option, Schema } from 'effect'
import { getAddress, type Hex, parseAbi } from 'viem'
import { accountPasskey } from '../auth/Store.ts'
import { firstRow } from '../Sql.ts'
import { ChainFailed, Conflict, NotFound } from './Errors.ts'

export const OwnerRow = Schema.Struct({
  id: Schema.String,
  display_name: Schema.String,
  smart_account: Schema.String,
  deploy_status: Schema.Literals(['counterfactual', 'deploying', 'deployed', 'failed']),
  deploy_tx: Schema.NullOr(Schema.String),
})
export type OwnerRow = typeof OwnerRow.Type

export const readOwner = (database: QueryDatabaseClient, accountId: string) =>
  firstRow(
    database
      .prepare('SELECT id, display_name, smart_account, deploy_status, deploy_tx FROM accounts WHERE id = ?')
      .bind(accountId),
    OwnerRow,
  ).pipe(Effect.flatMap(Effect.fromOption), Effect.orDie)

const erc1271 = parseAbi(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)'])
const ERC1271_MAGIC = '0x1626ba7e'

const chainFailed = (stage: string) => (error: { readonly message: string }) =>
  ChainFailed.make({ stage, reason: error.message })

export const hasCode = (arc: ArcClient, address: string) =>
  rpc('getCode', () => arc.getCode({ address: getAddress(address) })).pipe(
    Effect.map((code) => code !== undefined && code !== '0x'),
    Effect.mapError(chainFailed('getCode')),
  )

const setDeployStatus = (
  database: QueryDatabaseClient,
  accountId: string,
  status: OwnerRow['deploy_status'],
  tx: string | null,
) =>
  database
    .prepare('UPDATE accounts SET deploy_status = ?, deploy_tx = COALESCE(?, deploy_tx) WHERE id = ?')
    .bind(status, tx, accountId)
    .run()

/**
 * The account must exist on Arc before a grant is redeemed (the DM checks ECDSA for codeless delegators). The relayer
 * deploys it through SimpleFactory under the persistent key `deploy:<smartAccount>` (spec §4), once.
 */
export const ensureDeployed = Effect.fn('EthMumbai.Wallet.ensureDeployed')(function* (
  deps: { readonly database: QueryDatabaseClient; readonly arc: ArcClient; readonly relayer: Relayer },
  accountId: string,
) {
  const { database, arc, relayer } = deps
  const owner = yield* readOwner(database, accountId)
  if (yield* hasCode(arc, owner.smart_account)) {
    if (owner.deploy_status !== 'deployed') yield* setDeployStatus(database, accountId, 'deployed', null)
    return Option.fromNullishOr(owner.deploy_tx)
  }
  const passkey = yield* accountPasskey(database, accountId)
  if (Option.isNone(passkey)) return yield* NotFound.make({ what: 'passkey' })
  const factory = yield* counterfactualAccount({
    accountId,
    keyId: passkey.value.credential_id,
    x: passkey.value.x,
    y: passkey.value.y,
  })
  if (factory.smartAccount !== getAddress(owner.smart_account))
    return yield* Effect.die(new Error('stored smart account differs from its counterfactual address'))
  yield* setDeployStatus(database, accountId, 'deploying', null)
  const sent = yield* relayer
    .send({ key: `deploy:${factory.smartAccount}`, kind: 'deploy', to: factory.factory, data: factory.factoryData })
    .pipe(
      Effect.catchTag('AlreadySubmitted', (existing) =>
        Effect.flatMap(hasCode(arc, owner.smart_account), (deployed) =>
          deployed
            ? Effect.succeed({ txHash: existing.txHash ?? '', success: true })
            : Effect.fail(Conflict.make({ detail: 'the account deploy is still in flight; try again shortly' })),
        ),
      ),
      Effect.catchTag(['RelayerError', 'RelayerStoreError'], (error) =>
        Effect.andThen(setDeployStatus(database, accountId, 'failed', null), Effect.fail(chainFailed('deploy')(error))),
      ),
    )
  if (!sent.success) {
    yield* setDeployStatus(database, accountId, 'failed', sent.txHash)
    return yield* ChainFailed.make({ stage: 'deploy', reason: 'deploy reverted on chain' })
  }
  yield* setDeployStatus(database, accountId, 'deployed', sent.txHash)
  yield* Effect.logInfo('owner account deployed').pipe(Effect.annotateLogs({ accountId, txHash: sent.txHash }))
  return Option.some(sent.txHash)
})

/** The deployed account itself accepts the passkey signature over `digest` (ERC-1271), before D1 calls a grant active. */
export const verifyOwnerSignature = Effect.fn('EthMumbai.Wallet.verifyOwnerSignature')(function* (
  arc: ArcClient,
  smartAccount: string,
  digest: Hex,
  signature: Hex,
) {
  const result = yield* rpc('isValidSignature', () =>
    arc.readContract({
      address: getAddress(smartAccount),
      abi: erc1271,
      functionName: 'isValidSignature',
      args: [digest, signature],
    }),
  ).pipe(Effect.mapError(chainFailed('isValidSignature')))
  if (result !== ERC1271_MAGIC)
    return yield* ChainFailed.make({ stage: 'isValidSignature', reason: 'the account rejected the passkey signature' })
})
