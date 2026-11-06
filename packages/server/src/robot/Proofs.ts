import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { EpisodeEvidence } from '@ethmumbai/protocol/Errand'
import type { ProofAnchors, ProofSummary } from '@ethmumbai/protocol/Proof'
import { Effect, Option, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import { json, jsonError } from '../Respond.ts'
import { allRows, firstRow } from '../Sql.ts'

// Public proofs (Kris, 7 Nov): every episode the evidence uploader put on 0G, for anyone, without a session. Only
// what 0G already holds in public is answered: the anchored episode JSON's own fields and where it is anchored. Never
// the robot's name, the owner, the decision input (budget, the owner's words) or World claims; those stay owner-only.

const PAGE_SIZE = 50
/** Proofs change only when the uploader finishes one; a short shared cache keeps a judge's reloads cheap. */
const CACHE = { 'cache-control': 'public, max-age=15' }

const UploadedRow = Schema.Struct({
  episode_id: Schema.String,
  payload_json: Schema.NullOr(Schema.String),
  root_hash: Schema.String,
  storage_tx: Schema.NullOr(Schema.String),
  log_tx: Schema.NullOr(Schema.String),
  uploaded_at: Schema.Finite,
})
type UploadedRow = typeof UploadedRow.Type

const decodeEvidence = Schema.decodeUnknownOption(Schema.fromJsonString(EpisodeEvidence))

const summary = (row: UploadedRow): ProofSummary => {
  const evidence = Option.getOrUndefined(decodeEvidence(row.payload_json ?? ''))
  const last = evidence?.decisions.at(-1)
  return {
    episodeId: row.episode_id,
    item: evidence?.item ?? '',
    state: evidence?.outcome.state ?? 'unknown',
    action: last?.action ?? null,
    model: last?.model ?? null,
    teeProofs: evidence?.decisions.filter((decision) => decision.tee !== undefined).length ?? 0,
    frames: evidence?.observations?.filter((frame) => frame.rootHash !== undefined).length ?? 0,
    rootHash: row.root_hash,
    logTx: row.log_tx,
    paymentTx: evidence?.outcome.txHash ?? null,
    uploadedAt: row.uploaded_at,
  }
}

/** `<uploadedAt>.<episodeId>` of the last row of a page: the next page starts strictly after it. */
const decodeCursor = (cursor: string): Option.Option<readonly [number, string]> => {
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{1,64})$/.exec(cursor)
  return match?.[1] === undefined || match[2] === undefined ? Option.none() : Option.some([Number(match[1]), match[2]])
}

const UPLOADED = `SELECT episode_id, payload_json, root_hash, storage_tx, log_tx, uploaded_at FROM evidence_uploads
  WHERE status = 'uploaded' AND root_hash IS NOT NULL AND uploaded_at IS NOT NULL`

const listRoute = (database: QueryDatabaseClient, anchors: ProofAnchors) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const after = new URL(request.url, 'https://proofs.invalid').searchParams.get('after')
    const cursor = after === null ? Option.none() : decodeCursor(after)
    if (after !== null && Option.isNone(cursor)) return yield* jsonError(400, 'bad cursor')
    const statement = Option.match(cursor, {
      onNone: () => database.prepare(`${UPLOADED} ORDER BY uploaded_at DESC, episode_id DESC LIMIT ?`).bind(PAGE_SIZE),
      onSome: ([uploadedAt, episodeId]) =>
        database
          .prepare(
            `${UPLOADED} AND (uploaded_at < ? OR (uploaded_at = ? AND episode_id < ?))
              ORDER BY uploaded_at DESC, episode_id DESC LIMIT ?`,
          )
          .bind(uploadedAt, uploadedAt, episodeId, PAGE_SIZE),
    })
    const rows = yield* allRows(statement, UploadedRow)
    const last = rows.at(-1)
    const next = rows.length === PAGE_SIZE && last !== undefined ? `${last.uploaded_at}.${last.episode_id}` : null
    return yield* json({ anchors, proofs: rows.map(summary), next }, 200, CACHE)
  })

const pointerRoute = (database: QueryDatabaseClient, anchors: ProofAnchors) =>
  Effect.gen(function* () {
    const { episodeId } = yield* HttpRouter.params
    const row = yield* firstRow(database.prepare(`${UPLOADED} AND episode_id = ?`).bind(episodeId ?? ''), UploadedRow)
    if (Option.isNone(row)) return yield* jsonError(404, 'no proof on 0G for this episode')
    return yield* json(
      {
        anchors,
        episodeId: row.value.episode_id,
        rootHash: row.value.root_hash,
        storageTx: row.value.storage_tx,
        logTx: row.value.log_tx,
        uploadedAt: row.value.uploaded_at,
      },
      200,
      CACHE,
    )
  })

/** `GET /api/proofs` and `GET /api/proofs/:episodeId`: public, read-only, no session and no Origin check. */
export const proofRoutes = (database: QueryDatabaseClient, anchors: ProofAnchors) =>
  HttpRouter.addAll([
    HttpRouter.route('GET', '/api/proofs', listRoute(database, anchors)),
    HttpRouter.route('GET', '/api/proofs/:episodeId', pointerRoute(database, anchors)),
  ])
