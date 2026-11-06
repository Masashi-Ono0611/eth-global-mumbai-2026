import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { Address } from '@ethmumbai/protocol/Hex'
import { Effect, Layer, Option, Redacted, Schema } from 'effect'
import { chipRoutes } from './chip/Routes.ts'
import { liveEnabled, scansEnabled } from './Features.ts'
import { merchantPayees, merchantRoutes } from './merchant/Routes.ts'
import type { Settlement } from './merchant/X402.ts'
import { type ApprovalPort, type ErrandDeps, errandChipHooks } from './robot/Errands.ts'
import { auditRoutes, ZG_CHAIN_RPC_DEFAULT, ZG_STORAGE_INDEXER_DEFAULT } from './robot/Audit.ts'
import { evidenceRoutes } from './robot/Evidence.ts'
import { evidenceFrameRoutes } from './robot/EvidenceFrames.ts'
import { proofRoutes } from './robot/Proofs.ts'
import { intentRoutes } from './robot/Intents.ts'
import { liveRoutes } from './robot/Live.ts'
import { navRoutes } from './robot/Nav.ts'
import { ZG_COMPUTE_RPC_DEFAULT, ZG_INFERENCE_CONTRACT_DEFAULT } from './robot/TeeProof.ts'
import { robotRoutes } from './robot/routes.ts'
import { scanRoutes } from './robot/Scans.ts'
import { voiceRoutes } from './robot/Voice.ts'
import { ZeroGBindings, ZeroGExtraBody } from './robot/ZeroGClient.ts'
import { type Bindings, optionalBinding } from './Respond.ts'

const EvidenceToken = Schema.String.check(Schema.isMinLength(16))
const isUnset = (value: unknown) => value === undefined || value === '' || value === 'pending'

/**
 * The merchant (§7), the chip protocol (§8), the Robot Agent's errands and the evidence queue (§6), from the Worker's
 * bindings. Feature bindings are optional: a missing one makes only its own routes answer 503 "not configured".
 * The returned `errands` are what the World callback (§9) calls to continue or deny an errand.
 */
export const robotAgentRoutes = Effect.fn('EthMumbai.RobotAgent.routes')(function* (input: {
  readonly database: QueryDatabaseClient
  /** The private media bucket (`AppMedia`): scan crops, owner-only, never public. */
  readonly media: ReadWriteBucketClient
  readonly env: Bindings
  readonly origin: string
  readonly settlement: Option.Option<Settlement>
  readonly approvals: ApprovalPort
}) {
  const { database, media, env, origin, settlement, approvals } = input
  const baseUrl = yield* optionalBinding(env, 'ZG_BASE_URL', ZeroGBindings.baseUrl)
  const apiKey = yield* optionalBinding(env, 'ZG_API_KEY', ZeroGBindings.apiKey)
  const model = yield* optionalBinding(env, 'ZG_MODEL', ZeroGBindings.model)
  // Usually absent; only a present but malformed value is worth a warning.
  const extraBody = isUnset(env.ZG_EXTRA_JSON)
    ? Option.none()
    : yield* optionalBinding(env, 'ZG_EXTRA_JSON', ZeroGExtraBody)
  const evidenceToken = yield* optionalBinding(env, 'EVIDENCE_TOKEN', EvidenceToken)
  const episodeLogAddress = yield* optionalBinding(env, 'EPISODE_LOG_ADDRESS', Address)
  const chainRpc = isUnset(env.ZG_CHAIN_RPC)
    ? Option.some(ZG_CHAIN_RPC_DEFAULT)
    : yield* optionalBinding(env, 'ZG_CHAIN_RPC', ZeroGBindings.baseUrl)
  // Where Verify downloads frames from 0G Storage: Galileo's turbo indexer unless the stack points elsewhere.
  const storageIndexer = isUnset(env.ZG_STORAGE_INDEXER)
    ? Option.some(ZG_STORAGE_INDEXER_DEFAULT)
    : yield* optionalBinding(env, 'ZG_STORAGE_INDEXER', ZeroGBindings.baseUrl)
  // The 0G Compute provider registry for decisions' TEE proofs: mainnet unless the stack points elsewhere.
  const computeRpc = isUnset(env.ZG_COMPUTE_RPC)
    ? Option.none()
    : yield* optionalBinding(env, 'ZG_COMPUTE_RPC', ZeroGBindings.baseUrl)
  const inference = isUnset(env.ZG_INFERENCE_CONTRACT)
    ? Option.none()
    : yield* optionalBinding(env, 'ZG_INFERENCE_CONTRACT', Address)
  const payees = yield* merchantPayees(env)
  const errands: ErrandDeps = {
    database,
    origin,
    payees,
    zeroG: Option.map(Option.all({ baseUrl, apiKey, model }), (zeroG) => ({
      ...zeroG,
      apiKey: Redacted.make(zeroG.apiKey),
      ...(Option.isSome(extraBody) ? { extraBody: extraBody.value } : {}),
    })),
    settlement,
    approvals,
    teeRegistry: {
      rpcUrl: Option.getOrElse(computeRpc, () => ZG_COMPUTE_RPC_DEFAULT),
      inference: Option.getOrElse(inference, () => ZG_INFERENCE_CONTRACT_DEFAULT),
    },
  }
  const layer = Layer.mergeAll(
    yield* merchantRoutes(database, env, origin, settlement, payees),
    chipRoutes(database, errandChipHooks(errands)),
    robotRoutes(errands),
    evidenceRoutes(database, Option.map(evidenceToken, Redacted.make)),
    evidenceFrameRoutes(database, media, Option.map(evidenceToken, Redacted.make)),
    proofRoutes(database, {
      chainId: 16602,
      episodeLog: Option.getOrNull(episodeLogAddress),
      rpcUrl: Option.getOrElse(chainRpc, () => ZG_CHAIN_RPC_DEFAULT),
      indexerUrl: Option.getOrElse(storageIndexer, () => ZG_STORAGE_INDEXER_DEFAULT),
    }),
    auditRoutes(
      errands,
      media,
      Option.all({ address: episodeLogAddress, rpcUrl: chainRpc }),
      Option.getOrElse(storageIndexer, () => ZG_STORAGE_INDEXER_DEFAULT),
    ),
    // Scan-initiated errands, the owner's errand intents and the simulator's 0G navigation exist only while
    // SCANS_ENABLED is `true`; otherwise their paths are not mounted (404).
    scansEnabled(env)
      ? Layer.mergeAll(scanRoutes(errands, media), intentRoutes(errands), navRoutes(errands))
      : Layer.empty,
    // Vita's voice is always mounted (no flag); without 0G it answers 503. Its `buy` turns create intents.
    voiceRoutes({ ...errands, media }),
    // The robot's live camera view exists only while LIVE_ENABLED is `true`; otherwise its paths are 404.
    liveEnabled(env) ? liveRoutes(errands, media) : Layer.empty,
  )
  return { layer, errands }
})
