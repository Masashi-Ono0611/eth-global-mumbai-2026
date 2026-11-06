import { DecideInput, requestIdsHash } from '@ethmumbai/protocol/Errand'
import { keccak256Utf8 } from '@ethmumbai/protocol/Keccak'
import { Effect, Option, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpRouter from 'effect/http/HttpRouter'
import { createPublicClient, http, parseAbi } from 'viem'
import { decisionsOf } from './Decide.ts'
import { type EpisodeRow, type ErrandDeps, readEpisode } from './Errands.ts'
import { readEvidence } from './Evidence.ts'
import { decide } from './ZeroGClient.ts'
import { CurrentSession, requireSession } from '../auth/Session.ts'
import type { Hex } from '@ethmumbai/protocol/Hex'
import { json, jsonError, notConfigured } from '../Respond.ts'

// The owner's audit of a finished errand (6 Nov, Kris's ask): does 0G Chain hold what we anchored, and would the brain
// decide the same today? Both are read-only: nothing here writes a decision, an errand or a payment.

export const ZG_CHAIN_RPC_DEFAULT = 'https://evmrpc-testnet.0g.ai'

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

const verify = (deps: ErrandDeps, config: Option.Option<EpisodeLogConfig>) =>
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
export const auditRoutes = (deps: ErrandDeps, episodeLog: Option.Option<EpisodeLogConfig>) =>
  HttpRouter.addAll([
    HttpRouter.route('POST', '/api/wallet/episodes/:episodeId/verify', requireSession(verify(deps, episodeLog))),
    HttpRouter.route('POST', '/api/wallet/episodes/:episodeId/replay', requireSession(replay(deps))),
  ])
