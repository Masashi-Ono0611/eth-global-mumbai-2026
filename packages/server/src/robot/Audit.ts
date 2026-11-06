import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { DecideInput, EpisodeEvidence, requestIdsHash } from '@ethmumbai/protocol/Errand'
import { keccak256Utf8 } from '@ethmumbai/protocol/Keccak'
import { scanMessage } from '@ethmumbai/protocol/Scan'
import { Effect, Option, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import * as HttpRouter from 'effect/http/HttpRouter'
import { createPublicClient, http, parseAbi } from 'viem'
import { decisionsOf } from './Decide.ts'
import { type EpisodeRow, type ErrandDeps, readEpisode } from './Errands.ts'
import { readEvidence } from './Evidence.ts'
import { frameSha256, type ObservationRow, observationsOf, scanSignedBy } from './Observations.ts'
import { decodeTeeProof, teeSignerMatches } from './TeeProof.ts'
import { decide } from './ZeroGClient.ts'
import { CurrentSession, requireSession } from '../auth/Session.ts'
import { readRobot } from '../chip/Lease.ts'
import type { Hex } from '@ethmumbai/protocol/Hex'
import { json, jsonError, notConfigured } from '../Respond.ts'

// The owner's audit of a finished errand (6 Nov, Kris's ask): does 0G Chain hold what we anchored, and would the brain
// decide the same today? Both are read-only: nothing here writes a decision, an errand or a payment.

export const ZG_CHAIN_RPC_DEFAULT = 'https://evmrpc-testnet.0g.ai'
/** Where frames are downloaded from 0G Storage by root (`GET /file?root=`): Galileo's turbo indexer by default. */
export const ZG_STORAGE_INDEXER_DEFAULT = 'https://indexer-storage-testnet-turbo.0g.ai'

/** Where the anchors live: `EPISODE_LOG_ADDRESS` on 0G Chain (`ZG_CHAIN_RPC`, Galileo by default). */
export interface EpisodeLogConfig {
  readonly address: Hex
  readonly rpcUrl: string
}

const episodeLogAbi = parseAbi([
  'function records(bytes32 episodeKey) view returns (bytes32 rootHash, bytes32 requestIdsHash, address recorder, uint64 recordedAt)',
])

const sameHex = (left: string | null | undefined, right: string | null | undefined) =>
  left != null && right != null && left.toLowerCase() === right.toLowerCase()

/** The session's own episode, or nothing (another owner's episode is indistinguishable from a missing one). */
const ownEpisode = Effect.fnUntraced(function* (deps: ErrandDeps) {
  const { episodeId } = yield* HttpRouter.params
  const session = yield* CurrentSession
  const episode = yield* readEpisode(deps.database, episodeId ?? '')
  return Option.filter(episode, (row) => row.account_id === session.accountId)
})

/** `EpisodeLog.records(keccak256(episodeId))` by one `eth_call`; `None` when the episode has no record yet. */
const readRecord = (config: EpisodeLogConfig, episodeId: string) =>
  Effect.tryPromise(() =>
    createPublicClient({ transport: http(config.rpcUrl, { timeout: 5_000, retryCount: 0 }) }).readContract({
      address: config.address,
      abi: episodeLogAbi,
      functionName: 'records',
      args: [keccak256Utf8(episodeId)],
    }),
  ).pipe(
    Effect.timeout('5 seconds'),
    Effect.map(([rootHash, recordedHash, recorder, recordedAt]) =>
      recordedAt === 0n
        ? Option.none()
        : Option.some({ rootHash, requestIdsHash: recordedHash, recorder, recordedAt: Number(recordedAt) }),
    ),
  )

const storedFor = Effect.fnUntraced(function* (deps: ErrandDeps, episode: EpisodeRow) {
  const decisions = yield* decisionsOf(deps.database, episode.id)
  const requestIds = decisions.flatMap((decision) => (decision.request_id === null ? [] : [decision.request_id]))
  const evidence = Option.getOrUndefined(yield* readEvidence(deps.database, episode.id))
  return {
    rootHash: evidence?.rootHash ?? null,
    requestIdsHash: requestIdsHash(requestIds),
    storageTx: evidence?.storageTx ?? null,
    logTx: evidence?.logTx ?? null,
    uploadStatus: evidence?.status ?? null,
  }
})

/** The frame's bytes from 0G Storage by root; `None` when the indexer does not answer with them in 10 s. */
const downloadFrame = (indexer: string, rootHash: string) =>
  HttpClient.get(`${indexer}/file?root=${rootHash}`).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.arrayBuffer),
    Effect.map((buffer) => new Uint8Array(buffer)),
    Effect.timeout('10 seconds'),
    Effect.provide(FetchHttpClient.layer),
    Effect.option,
  )

/**
 * The frame's 0G Storage copy: downloaded by root and re-hashed against the signed digest, and is that root the one
 * the anchored episode names (`inEvidence`; false for an episode uploaded before its frame). `null` before upload.
 */
const checkFrameOnZeroG = Effect.fnUntraced(function* (
  indexer: string,
  row: ObservationRow,
  anchoredRoots: ReadonlyMap<string, string>,
) {
  if (row.zg_root_hash === null) return null
  const bytes = yield* downloadFrame(indexer, row.zg_root_hash)
  return {
    rootHash: row.zg_root_hash,
    storageTx: row.zg_storage_tx,
    downloaded: Option.isSome(bytes),
    hashMatches: Option.exists(bytes, (frame) => frameSha256(frame) === row.frame_sha256),
    inEvidence: sameHex(anchoredRoots.get(row.frame_sha256), row.zg_root_hash),
  }
})

/** One scan re-checked from R2: do the stored bytes still hash to the signed digest, and did the chip sign it? */
const checkObservation = Effect.fnUntraced(function* (
  media: ReadWriteBucketClient,
  chipAddress: Hex | null,
  row: ObservationRow,
) {
  const object = Option.getOrNull(yield* media.get(row.r2_key).pipe(Effect.option))
  const bytes = object === null ? Option.none() : yield* object.bytes().pipe(Effect.option)
  const message = scanMessage(row.invoice_id, row.frame_sha256, row.captured_at, row.robot_id)
  return {
    sha256: row.frame_sha256,
    hashMatches: Option.exists(bytes, (frame) => frameSha256(frame) === row.frame_sha256),
    signerMatches: yield* scanSignedBy(message, row.chip_sig, chipAddress),
  }
})

const decodeEvidence = Schema.decodeUnknownOption(EpisodeEvidence)

/** Each frame's root as the stored episode evidence names it (the JSON EpisodeLog anchors once it is on 0G). */
const anchoredFrameRoots = (payload: unknown) =>
  new Map(
    Option.match(decodeEvidence(payload), {
      onNone: () => [],
      onSome: (evidence) =>
        (evidence.observations ?? []).flatMap((entry): Array<[string, string]> =>
          entry.rootHash === undefined ? [] : [[entry.sha256, entry.rootHash]],
        ),
    }),
  )

const checkObservations = Effect.fnUntraced(function* (
  deps: ErrandDeps,
  media: ReadWriteBucketClient,
  indexer: string,
  episode: EpisodeRow,
) {
  const robot = yield* readRobot(deps.database, episode.robot_id)
  const chipAddress = Option.getOrNull(Option.flatMapNullishOr(robot, (row) => row.chip_address))
  const rows = yield* observationsOf(deps.database, episode.id)
  const evidence = yield* readEvidence(deps.database, episode.id)
  const anchoredRoots = anchoredFrameRoots(Option.getOrNull(Option.map(evidence, (row) => row.payload)))
  return yield* Effect.forEach(rows, (row) =>
    Effect.map(
      Effect.all([checkObservation(media, chipAddress, row), checkFrameOnZeroG(indexer, row, anchoredRoots)]),
      ([fromR2, zeroG]) => ({ ...fromR2, zeroG }),
    ),
  )
})

/** Each stored TEE proof re-checked: does its signature over `text` recover to the signer the registry named? */
const checkTee = Effect.fnUntraced(function* (deps: ErrandDeps, episode: EpisodeRow) {
  const proofs = (yield* decisionsOf(deps.database, episode.id)).flatMap((decision) =>
    Option.toArray(decodeTeeProof(decision.tee_json)),
  )
  const matches = yield* Effect.forEach(proofs, teeSignerMatches)
  return {
    present: proofs.length > 0,
    signerMatches: proofs.length > 0 && matches.every(Boolean),
    signer: proofs[0]?.signer ?? null,
  }
})

const verify = (
  deps: ErrandDeps,
  media: ReadWriteBucketClient,
  config: Option.Option<EpisodeLogConfig>,
  indexer: string,
) =>
  Effect.gen(function* () {
    const episode = yield* ownEpisode(deps)
    if (Option.isNone(episode)) return yield* jsonError(404, 'unknown episode')
    if (Option.isNone(config)) return yield* notConfigured('EPISODE_LOG_ADDRESS')
    const stored = yield* storedFor(deps, episode.value)
    const record = yield* readRecord(config.value, episode.value.id).pipe(Effect.option)
    if (Option.isNone(record)) return yield* jsonError(502, '0G Chain did not answer')
    const onChain = Option.getOrNull(record.value)
    const paidTx = episode.value.state === 'paid' ? episode.value.result : null
    return yield* json({
      episodeId: episode.value.id,
      stored,
      onChain,
      matches: {
        rootHash: sameHex(stored.rootHash, onChain?.rootHash),
        requestIdsHash: sameHex(stored.requestIdsHash, onChain?.requestIdsHash),
      },
      links: {
        storagescan: stored.storageTx === null ? null : `https://storagescan-galileo.0g.ai/tx/${stored.storageTx}`,
        chainscan: stored.logTx === null ? null : `https://chainscan-galileo.0g.ai/tx/${stored.logTx}`,
        ...(paidTx === null ? {} : { arcTx: `https://explorer.arc.io/tx/${paidTx}` }),
      },
      // The Worker cannot run the 0G Storage SDK (it needs Node); the uploader downloads and compares each root.
      downloadCheckedBy: 'uploader',
      // Each scan's crop re-read from R2 and re-hashed, its chip signature recovered, and its 0G Storage copy
      // downloaded by root and re-hashed (`zeroG: null` until uploaded; `[]` without scans).
      observations: yield* checkObservations(deps, media, indexer, episode.value),
      // The decision's provider TEE signature recovered again (`present: false` without a proof).
      tee: yield* checkTee(deps, episode.value),
    })
  })

const decodeInput = Schema.decodeUnknownOption(Schema.fromJsonString(DecideInput))

/** Re-ask the current brain with the latest decision's stored input: temperature 0, 10 s, nothing written. */
const replay = (deps: ErrandDeps) =>
  Effect.gen(function* () {
    const episode = yield* ownEpisode(deps)
    if (Option.isNone(episode)) return yield* jsonError(404, 'unknown episode')
    if (Option.isNone(deps.zeroG)) return yield* notConfigured('ZG_API_KEY')
    const latest = (yield* decisionsOf(deps.database, episode.value.id)).at(-1)
    const input = latest === undefined ? Option.none() : decodeInput(latest.input_json)
    if (latest === undefined || Option.isNone(input)) return yield* jsonError(409, 'episode has no decision to replay')
    const outcome = yield* decide(deps.zeroG.value, input.value).pipe(Effect.provide(FetchHttpClient.layer))
    const { call } = outcome
    return yield* json({
      episodeId: episode.value.id,
      binding: false,
      original: {
        action: latest.action,
        reason: latest.reason,
        requestId: latest.request_id,
        provider: latest.provider,
      },
      replay: outcome.ok
        ? {
            ok: true,
            action: outcome.result.action,
            reason: outcome.result.reason,
            requestId: call.requestId,
            provider: call.provider,
            latencyMs: call.latencyMs,
          }
        : { ok: false, error: outcome.error, provider: call.provider, latencyMs: call.latencyMs },
      same: outcome.ok && outcome.result.action === latest.action,
    })
  })

/** `POST /api/wallet/episodes/:id/verify` and `/replay`, behind the session and the Origin check. */
export const auditRoutes = (
  deps: ErrandDeps,
  media: ReadWriteBucketClient,
  episodeLog: Option.Option<EpisodeLogConfig>,
  storageIndexer: string,
) =>
  HttpRouter.addAll([
    HttpRouter.route(
      'POST',
      '/api/wallet/episodes/:episodeId/verify',
      requireSession(verify(deps, media, episodeLog, storageIndexer)),
    ),
    HttpRouter.route('POST', '/api/wallet/episodes/:episodeId/replay', requireSession(replay(deps))),
  ])
