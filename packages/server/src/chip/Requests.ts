import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { generateId } from '@ethmumbai/protocol/Base32'
import { SignRequest } from '@ethmumbai/protocol/Chip'
import { Clock, Effect, Schema } from 'effect'
import { allRows, changes, firstRow } from '../Sql.ts'

/** A chip that stays silent this long after its request was queued ends the errand `expired` (spec §6). */
export const SIGNING_TIMEOUT_SECONDS = 60

export const ChipRequestStatus = Schema.Literals(['queued', 'delivered', 'signed', 'refused', 'expired'])

export const ChipRequestRow = Schema.Struct({
  id: Schema.String,
  robot_id: Schema.String,
  episode_id: Schema.String,
  kind: Schema.Literal('sign-invoice'),
  payload_json: Schema.String,
  status: ChipRequestStatus,
  expires_at: Schema.Finite,
  delivered_at: Schema.NullOr(Schema.Finite),
  responded_at: Schema.NullOr(Schema.Finite),
  signature: Schema.NullOr(Schema.String),
  leaf_hash: Schema.NullOr(Schema.String),
  refusal_code: Schema.NullOr(Schema.String),
  created_at: Schema.Finite,
})
export type ChipRequestRow = typeof ChipRequestRow.Type

export const decodePayload = (row: ChipRequestRow) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(SignRequest))(row.payload_json).pipe(Effect.orDie)

/**
 * Queue one sign request for an errand. `chip_requests.episode_id` is unique, so a retried errand step cannot queue a
 * second request: the insert is skipped and the existing row is returned.
 */
export const enqueueSignRequest = Effect.fn('EthMumbai.Chip.enqueue')(function* (
  database: QueryDatabaseClient,
  input: {
    readonly robotId: string
    readonly episodeId: string
    readonly build: (id: string, expiresAt: number) => SignRequest
  },
) {
  const id = yield* generateId
  const createdAt = yield* Clock.currentTimeMillis
  const expiresAt = Math.floor(createdAt / 1000) + SIGNING_TIMEOUT_SECONDS
  const payload = yield* Schema.encodeEffect(Schema.fromJsonString(SignRequest))(input.build(id, expiresAt)).pipe(
    Effect.orDie,
  )
  yield* database
    .prepare(
      `INSERT INTO chip_requests (id, robot_id, episode_id, kind, payload_json, status, expires_at, created_at)
        VALUES (?, ?, ?, 'sign-invoice', ?, 'queued', ?, ?) ON CONFLICT(episode_id) DO NOTHING`,
    )
    .bind(id, input.robotId, input.episodeId, payload, expiresAt, createdAt)
    .run()
  return yield* readRequestForEpisode(database, input.episodeId).pipe(Effect.flatMap(Effect.fromOption), Effect.orDie)
})

export const readRequestForEpisode = (database: QueryDatabaseClient, episodeId: string) =>
  firstRow(database.prepare('SELECT * FROM chip_requests WHERE episode_id = ?').bind(episodeId), ChipRequestRow)

export const readRequest = (database: QueryDatabaseClient, robotId: string, requestId: string) =>
  firstRow(
    database.prepare('SELECT * FROM chip_requests WHERE id = ? AND robot_id = ?').bind(requestId, robotId),
    ChipRequestRow,
  )

/** Requests past their deadline that the chip never answered. */
export const expireRequests = (database: QueryDatabaseClient, robotId: string, nowSeconds: number) =>
  changes(
    database
      .prepare(
        `UPDATE chip_requests SET status = 'expired'
          WHERE robot_id = ? AND status IN ('queued', 'delivered') AND expires_at <= ?`,
      )
      .bind(robotId, nowSeconds),
  )

/** Claim every live queued request for delivery; the conditional update makes concurrent polls deliver each once. */
export const takeQueued = Effect.fnUntraced(function* (
  database: QueryDatabaseClient,
  robotId: string,
  nowSeconds: number,
) {
  const queued = yield* allRows(
    database
      .prepare(
        `SELECT * FROM chip_requests WHERE robot_id = ? AND status = 'queued' AND expires_at > ? ORDER BY created_at`,
      )
      .bind(robotId, nowSeconds),
    ChipRequestRow,
  )
  const delivered = yield* Effect.filter(queued, (row) =>
    changes(
      database
        .prepare(`UPDATE chip_requests SET status = 'delivered', delivered_at = ? WHERE id = ? AND status = 'queued'`)
        .bind(nowSeconds, row.id),
    ).pipe(Effect.map((count) => count === 1)),
  )
  return yield* Effect.forEach(delivered, decodePayload)
})

/** `delivered` → `signed` / `refused`, once. */
export const markResponded = (
  database: QueryDatabaseClient,
  requestId: string,
  nowSeconds: number,
  outcome: { readonly signature: string; readonly leafHash: string } | { readonly refusalCode: string },
) =>
  changes(
    'refusalCode' in outcome
      ? database
          .prepare(
            `UPDATE chip_requests SET status = 'refused', refusal_code = ?, responded_at = ? WHERE id = ? AND status = 'delivered'`,
          )
          .bind(outcome.refusalCode, nowSeconds, requestId)
      : database
          .prepare(
            `UPDATE chip_requests SET status = 'signed', signature = ?, leaf_hash = ?, responded_at = ?
              WHERE id = ? AND status = 'delivered'`,
          )
          .bind(outcome.signature, outcome.leafHash, nowSeconds, requestId),
  ).pipe(Effect.map((count) => count === 1))
