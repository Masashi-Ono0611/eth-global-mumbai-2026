import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { type ArcClient, makeArcClient } from '@ethmumbai/chain/Arc'
import { type Approver, makeApprover } from '@ethmumbai/chain/Approver'
import { makeRelayer, type Relayer } from '@ethmumbai/chain/Relayer'
import { Address } from '@ethmumbai/protocol/Hex'
import { Effect, Option, Schema } from 'effect'
import type { Address as EvmAddress } from 'viem'
import type { Settlement } from '../merchant/X402.ts'
import { type Bindings, optionalBinding } from '../Respond.ts'
import { makeD1RelayerStore } from './RelayerStore.ts'
import { makeSettlement } from './Settlement.ts'

const PrivateKey = Schema.TemplateLiteral(['0x', Schema.String]).check(Schema.isPattern(/^0x[0-9a-f]{64}$/))
const RpcUrl = Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/))
export const PUBLIC_ARC_RPC = 'https://rpc.mainnet.arc.io'

/** The chain singletons of one isolate. One relayer instance = one nonce sequence for deploy, revoke and settle. */
export type ChainServices = {
  readonly arc: Option.Option<ArcClient>
  readonly relayer: Option.Option<Relayer>
  readonly approver: Option.Option<Approver>
  readonly approverAddress: Option.Option<EvmAddress>
  readonly enforcer: Option.Option<EvmAddress>
  readonly settlement: Option.Option<Settlement>
}

/**
 * Decoded from the Worker bindings (spec §10), each optional: a missing or malformed value logs one warning (its name
 * only) and the routes that need it answer 503. Without `ARC_RPC_URL` the public Arc RPC is used (throttled, but
 * enough for a demo; the keyed URL replaces it when set).
 */
export const makeChainServices = Effect.fn('EthMumbai.Chain.services')(function* (
  database: QueryDatabaseClient,
  env: Bindings,
) {
  const rpcUrl = yield* optionalBinding(env, 'ARC_RPC_URL', RpcUrl)
  const arc = makeArcClient(Option.getOrElse(rpcUrl, () => PUBLIC_ARC_RPC))
  const relayerKey = yield* optionalBinding(env, 'RELAYER_PRIVATE_KEY', PrivateKey)
  const approverKey = yield* optionalBinding(env, 'APPROVER_PRIVATE_KEY', PrivateKey)
  const enforcer = yield* optionalBinding(env, 'ENFORCER_ADDRESS', Address)
  const store = yield* makeD1RelayerStore(database)
  const relayer = Option.map(relayerKey, (privateKey) => makeRelayer({ client: arc, privateKey, store }))
  const approver = Option.map(approverKey, makeApprover)
  const settlement = Option.isSome(relayer)
    ? Option.some(yield* makeSettlement({ database, client: arc, relayer: relayer.value }))
    : Option.none<Settlement>()
  const services: ChainServices = {
    arc: Option.some(arc),
    relayer,
    approver,
    approverAddress: Option.map(approver, (signer) => signer.address),
    enforcer,
    settlement,
  }
  return services
})
