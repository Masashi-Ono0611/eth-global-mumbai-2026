import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { EpisodeEvidence, type EvidenceNavigation, requestIdsHash } from '@ethmumbai/protocol/Errand'
import { Bytes32 } from '@ethmumbai/protocol/Hex'
import { Clock, Effect, Option, Redacted, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import type * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { decisionsOf } from './Decide.ts'
import type { EpisodeRow } from './Errands.ts'
import { IntentRow, navCallsOf, navTurnsOf } from './IntentRows.ts'
import { evidenceObservation, observationsOf } from './Observations.ts'
import { decodeTeeProof } from './TeeProof.ts'
import { json, jsonError, notConfigured, nowSeconds, sha256Hex } from '../Respond.ts'
import { allRows, changes, firstRow } from '../Sql.ts'

const EvidenceRow = Schema.Struct({
  episode_id: Schema.String,
  status: Schema.Literals(['pending', 'uploading', 'uploaded', 'failed']),
  payload_json: Schema.NullOr(Schema.String),
  request_ids_hash: Schema.NullOr(Schema.String),
  root_hash: Schema.NullOr(Schema.String),
  storage_tx: Schema.NullOr(Schema.String),
  log_tx: Schema.NullOr(Schema.String),
  attempts: Schema.NullOr(Schema.Finite),
  claimed_at: Schema.NullOr(Schema.Finite),
  uploaded_at: Schema.NullOr(Schema.Finite),
  error: Schema.NullOr(Schema.String),
  created_at: Schema.Finite,
})
type EvidenceRow = typeof EvidenceRow.Type

const ApprovalRef = Schema.Struct({ id: Schema.String })

/**
 * The navigation that led to the scan, when the episode claimed an errand intent: the instruction's hash (never its
 * text) and each 0G turn's ids, calls and TEE proof. `None` for an episode without an intent.
 */
const navigationOf = Effect.fnUntraced(function* (database: QueryDatabaseClient, episodeId: string) {
  const intent = yield* firstRow(
    database.prepare('SELECT * FROM intents WHERE episode_id = ? LIMIT 1').bind(episodeId),
    IntentRow,
  )
  if (Option.isNone(intent)) return Option.none<EvidenceNavigation>()
  const turns = yield* navTurnsOf(database, intent.value.id)
  return Option.some<EvidenceNavigation>({
    instructionSha256: `0x${intent.value.instruction_sha256.replace(/^0x/, '')}`,
    turns: turns.map((turn) => ({
      step: turn.step,
      model: turn.model,
      requestId: turn.request_id,
      chatId: turn.chat_id,
      promptSha256: turn.prompt_sha256,
      calls: navCallsOf(turn.calls_json).map(({ name, args }) => ({ name, args })),
      ...Option.match(decodeTeeProof(turn.tee_json), { onNone: () => ({}), onSome: (tee) => ({ tee }) }),
    })),
  })
})

const encodeEvidence = Schema.encodeEffect(Schema.fromJsonString(EpisodeEvidence))

/**
 * On entry to a terminal state: the episode's evidence JSON (spec §6) as an `evidence_uploads` row, `pending` until
 * the uploader puts it on 0G Storage and records it in `EpisodeLog`.
 */
export const enqueueEvidence = Effect.fn('EthMumbai.Robot.enqueueEvidence')(function* (
  database: QueryDatabaseClient,
  episode: EpisodeRow,
) {
  const decisions = yield* decisionsOf(database, episode.id)
  const approval = yield* firstRow(
    database
      .prepare(`SELECT id FROM approvals WHERE episode_id = ? AND status IN ('approved', 'consumed') LIMIT 1`)
      .bind(episode.id),
    ApprovalRef,
  )
  const requestIds = decisions.flatMap((decision) => (decision.request_id === null ? [] : [decision.request_id]))
  // A scan's hash and chip signature, never its image; absent when the errand had no scan (older evidence unchanged).
  const observations = (yield* observationsOf(database, episode.id)).map(evidenceObservation)
  const navigation = yield* navigationOf(database, episode.id)
  const txHash = Option.getOrUndefined(
    Schema.decodeUnknownOption(Bytes32)(episode.state === 'paid' ? episode.result : undefined),
  )
  const payload = yield* encodeEvidence({
    episodeId: episode.id,
    robotId: episode.robot_id,
    item: episode.item,
    decisions: decisions.map((decision) => ({
      step: decision.step,
      model: decision.model,
      requestId: decision.request_id,
      chatId: decision.chat_id,
      provider: decision.provider,
      latencyMs: decision.latency_ms,
      promptSha256: decision.prompt_sha256,
      action: decision.action,
      reason: decision.reason,
      outcome: decision.outcome,
      // The provider TEE's proof when one was fetched; absent otherwise, so older evidence is byte-identical.
      ...Option.match(decodeTeeProof(decision.tee_json), { onNone: () => ({}), onSome: (tee) => ({ tee }) }),
    })),
    outcome: {
      state: episode.state,
      ...(txHash === undefined ? {} : { txHash }),
      ...(Option.isSome(approval) ? { approvalId: approval.value.id } : {}),
    },
    requestIds,
    ...(observations.length > 0 ? { observations } : {}),
    // Only an episode that claimed an errand intent has it, so every other episode encodes byte-identically.
    ...Option.match(navigation, { onNone: () => ({}), onSome: (present) => ({ navigation: present }) }),
  }).pipe(Effect.orDie)
  const hash = requestIdsHash(requestIds)
  const createdAt = yield* Clock.currentTimeMillis
  yield* database.batch([
    database
      .prepare(
        `INSERT INTO evidence_uploads (episode_id, status, payload_json, request_ids_hash, attempts, created_at)
          VALUES (?, 'pending', ?, ?, 0, ?) ON CONFLICT(episode_id) DO NOTHING`,
      )
      .bind(episode.id, payload, hash, createdAt),
    database
      .prepare('UPDATE episodes SET request_ids_hash = ?, decision_count = ? WHERE id = ?')
      .bind(hash, decisions.length, episode.id),
  ])
})

/** Equal-length digests compared without an early exit, so the token never leaks through timing. */
const sameSecret = (left: string, right: string) =>
  Effect.map(Effect.all([sha256Hex(left), sha256Hex(right)]), ([a, b]) => {
    let difference = 0
    for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
    return difference === 0
  })

/** `Authorization: Bearer <EVIDENCE_TOKEN>`: 503 without a configured token, 401 for any other token. */
const withUploaderToken = <E, R>(
  token: Option.Option<Redacted.Redacted>,
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  Effect.gen(function* () {
    if (Option.isNone(token)) return yield* notConfigured('EVIDENCE_TOKEN')
    const request = yield* HttpServerRequest.HttpServerRequest
    const given = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1] ?? ''
    if (!(yield* sameSecret(given, Redacted.value(token.value)))) return yield* jsonError(401, 'bad evidence token')
    return yield* handler
  })

/** An upload stuck in `uploading` this long is handed out again. */
const RECLAIM_SECONDS = 300
const MAX_ATTEMPTS = 5

const pendingRoute = (database: QueryDatabaseClient, token: Option.Option<Redacted.Redacted>) =>
  HttpRouter.route(
    'GET',
    '/api/evidence/pending',
    withUploaderToken(
      token,
      Effect.gen(function* () {
        const now = yield* nowSeconds
        const candidates = yield* allRows(
          database
            .prepare(
              `SELECT * FROM evidence_uploads WHERE (status = 'pending')
                OR (status = 'failed' AND attempts < ?) OR (status = 'uploading' AND claimed_at < ?)
                ORDER BY created_at LIMIT 10`,
            )
            .bind(MAX_ATTEMPTS, now - RECLAIM_SECONDS),
          EvidenceRow,
        )
        const claimed = yield* Effect.filter(candidates, (row) =>
          changes(
            database
              .prepare(
                `UPDATE evidence_uploads SET status = 'uploading', claimed_at = ?, attempts = COALESCE(attempts, 0) + 1
                  WHERE episode_id = ? AND status = ? AND COALESCE(claimed_at, 0) = ?`,
              )
              .bind(now, row.episode_id, row.status, row.claimed_at ?? 0),
          ).pipe(Effect.map((count) => count === 1)),
        )
        return yield* json({
          episodes: claimed.map((row) => ({
            episodeId: row.episode_id,
            requestIdsHash: row.request_ids_hash,
            payloadJson: row.payload_json,
          })),
        })
      }),
    ),
  )

const Uploaded = Schema.Struct({ rootHash: Bytes32, storageTx: Bytes32, logTx: Bytes32 })
const Failed = Schema.Struct({ error: Schema.String.check(Schema.isMaxLength(500)) })

const reportRoutes = (database: QueryDatabaseClient, token: Option.Option<Redacted.Redacted>) => [
  HttpRouter.route(
    'POST',
    '/api/evidence/:episodeId/uploaded',
    withUploaderToken(
      token,
      Effect.gen(function* () {
        const { episodeId } = yield* HttpRouter.params
        const body = yield* HttpServerRequest.schemaBodyJson(Uploaded).pipe(Effect.option)
        if (Option.isNone(body)) return yield* jsonError(400, 'expected {rootHash, storageTx, logTx}')
        const { rootHash, storageTx, logTx } = body.value
        const updated = yield* changes(
          database
            .prepare(
              `UPDATE evidence_uploads SET status = 'uploaded', root_hash = ?, storage_tx = ?, log_tx = ?, uploaded_at = ?,
                error = NULL WHERE episode_id = ? AND status = 'uploading'`,
            )
            .bind(rootHash, storageTx, logTx, yield* nowSeconds, episodeId ?? ''),
        )
        return yield* updated === 1 ? json({ episodeId, status: 'uploaded' }) : jsonError(409, 'upload is not claimed')
      }),
    ),
  ),
  HttpRouter.route(
    'POST',
    '/api/evidence/:episodeId/failed',
    withUploaderToken(
      token,
      Effect.gen(function* () {
        const { episodeId } = yield* HttpRouter.params
        const body = yield* HttpServerRequest.schemaBodyJson(Failed).pipe(Effect.option)
        if (Option.isNone(body)) return yield* jsonError(400, 'expected {error}')
        yield* database
          .prepare(
            `UPDATE evidence_uploads SET status = 'failed', error = ? WHERE episode_id = ? AND status = 'uploading'`,
          )
          .bind(body.value.error, episodeId ?? '')
          .run()
        return yield* json({ episodeId, status: 'failed' })
      }),
    ),
  ),
]

const publicView = (row: EvidenceRow) => ({
  episodeId: row.episode_id,
  status: row.status,
  requestIdsHash: row.request_ids_hash,
  rootHash: row.root_hash,
  storageTx: row.storage_tx,
  logTx: row.log_tx,
  uploadedAt: row.uploaded_at,
  attempts: row.attempts,
  payload:
    row.payload_json === null
      ? null
      : Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(row.payload_json).pipe(Option.getOrNull),
})

export const readEvidence = (database: QueryDatabaseClient, episodeId: string) =>
  firstRow(database.prepare('SELECT * FROM evidence_uploads WHERE episode_id = ?').bind(episodeId), EvidenceRow).pipe(
    Effect.map(Option.map(publicView)),
  )

/** `GET /api/evidence/:id` is public: the episode log holds request ids and hashes, never keys or prompts. */
export const evidenceRoutes = (database: QueryDatabaseClient, token: Option.Option<Redacted.Redacted>) =>
  HttpRouter.addAll([
    pendingRoute(database, token),
    ...reportRoutes(database, token),
    HttpRouter.route(
      'GET',
      '/api/evidence/:episodeId',
      Effect.gen(function* () {
        const { episodeId } = yield* HttpRouter.params
        const found = yield* readEvidence(database, episodeId ?? '')
        return yield* Option.isNone(found) ? jsonError(404, 'no evidence for this episode') : json(found.value)
      }),
    ),
  ])
