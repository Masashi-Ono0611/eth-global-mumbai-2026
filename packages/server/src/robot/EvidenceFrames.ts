import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { EpisodeEvidence } from '@ethmumbai/protocol/Errand'
import { Bytes32, Sha256Hex } from '@ethmumbai/protocol/Hex'
import { Effect, Option, type Redacted, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { withUploaderToken } from './Evidence.ts'
import { framesWithoutRoot, type ObservationRow, observationsOf } from './Observations.ts'
import { json, jsonError } from '../Respond.ts'
import { changes, firstRow } from '../Sql.ts'

// The robot's camera frames on 0G Storage (proof of the robot's work, public by root; Kris, 6 Nov). The uploader reads
// each chip-signed frame from R2 through the evidence token, uploads the exact bytes, and reports the root here. The
// root goes onto the observation and, while the episode's evidence is not yet on 0G, into that evidence JSON too, so
// EpisodeLog anchors the link from the episode to its frame. The 0G decision never receives a frame.

const FramePath = Schema.Struct({ episodeId: Schema.String.check(Schema.isMaxLength(64)), sha256: Sha256Hex })
const FrameUploaded = Schema.Struct({ rootHash: Bytes32, storageTx: Bytes32 })
const PendingPayload = Schema.Struct({ payload_json: Schema.NullOr(Schema.String) })

/** Frames handed out per backfill call. */
const FRAMES_PER_CALL = 20

const frameOf = Effect.fnUntraced(function* (database: QueryDatabaseClient, episodeId: string, sha256: string) {
  const rows = yield* observationsOf(database, episodeId)
  return Option.fromNullishOr(rows.find((row) => row.frame_sha256 === sha256))
})

const decodeEvidence = Schema.decodeUnknownOption(Schema.fromJsonString(EpisodeEvidence))
const encodeEvidence = Schema.encodeEffect(Schema.fromJsonString(EpisodeEvidence))

/**
 * The episode's evidence JSON with this frame's root, while it is not yet on 0G Storage (`pending`, `uploading` or
 * `failed`); an uploaded episode is anchored as it was and keeps its bytes. Returns the JSON the uploader must store.
 */
const patchEvidence = Effect.fnUntraced(function* (
  database: QueryDatabaseClient,
  episodeId: string,
  sha256: string,
  rootHash: `0x${string}`,
) {
  const row = yield* firstRow(
    database
      .prepare(`SELECT payload_json FROM evidence_uploads WHERE episode_id = ? AND status != 'uploaded'`)
      .bind(episodeId),
    PendingPayload,
  )
  const evidence = Option.flatMap(row, ({ payload_json }) =>
    payload_json === null ? Option.none() : decodeEvidence(payload_json),
  )
  if (Option.isNone(evidence)) return null
  const patched = yield* encodeEvidence({
    ...evidence.value,
    ...(evidence.value.observations === undefined
      ? {}
      : {
          observations: evidence.value.observations.map((entry) =>
            entry.sha256 === sha256 ? { ...entry, rootHash } : entry,
          ),
        }),
  }).pipe(Effect.orDie)
  yield* database
    .prepare(`UPDATE evidence_uploads SET payload_json = ? WHERE episode_id = ? AND status != 'uploaded'`)
    .bind(patched, episodeId)
    .run()
  return patched
})

/** `GET /api/evidence/:episodeId/frames/:sha256` → the frame's exact bytes from R2, for the uploader only. */
const readFrame = (database: QueryDatabaseClient, media: ReadWriteBucketClient) =>
  Effect.gen(function* () {
    const path = yield* HttpRouter.schemaPathParams(FramePath).pipe(Effect.option)
    if (Option.isNone(path)) return yield* jsonError(404, 'unknown frame')
    const row = yield* frameOf(database, path.value.episodeId, path.value.sha256)
    if (Option.isNone(row)) return yield* jsonError(404, 'unknown frame')
    const object = yield* media.get(row.value.r2_key).pipe(Effect.option)
    if (Option.isNone(object)) return yield* jsonError(502, 'R2 did not answer')
    if (object.value === null) return yield* jsonError(404, 'frame is missing from R2')
    return HttpServerResponse.stream(object.value.body, {
      contentType: 'image/jpeg',
      headers: { 'cache-control': 'no-store', 'content-length': String(object.value.size) },
    })
  })

/** `POST /api/evidence/:episodeId/frames/:sha256` `{rootHash, storageTx}`: once per frame; the same root again is a
 *  no-op, another root is 409. Answers the evidence JSON to store when the episode is not on 0G yet, else null. */
const frameUploaded = (database: QueryDatabaseClient) =>
  Effect.gen(function* () {
    const path = yield* HttpRouter.schemaPathParams(FramePath).pipe(Effect.option)
    if (Option.isNone(path)) return yield* jsonError(404, 'unknown frame')
    const body = yield* HttpServerRequest.schemaBodyJson(FrameUploaded).pipe(Effect.option)
    if (Option.isNone(body)) return yield* jsonError(400, 'expected {rootHash, storageTx}')
    const { episodeId, sha256 } = path.value
    const { rootHash, storageTx } = body.value
    const row = yield* frameOf(database, episodeId, sha256)
    if (Option.isNone(row)) return yield* jsonError(404, 'unknown frame')
    if (row.value.zg_root_hash !== null && row.value.zg_root_hash.toLowerCase() !== rootHash.toLowerCase())
      return yield* jsonError(409, 'frame already has another 0G root')
    if (row.value.zg_root_hash === null) {
      const updated = yield* changes(
        database
          .prepare('UPDATE observations SET zg_root_hash = ?, zg_storage_tx = ? WHERE id = ? AND zg_root_hash IS NULL')
          .bind(rootHash, storageTx, row.value.id),
      )
      if (updated !== 1) return yield* jsonError(409, 'frame already has a 0G root')
    }
    const payloadJson = yield* patchEvidence(database, episodeId, sha256, rootHash)
    return yield* json({ episodeId, sha256, rootHash, payloadJson })
  })

const pendingView = (row: ObservationRow) => ({ episodeId: row.episode_id, sha256: row.frame_sha256, bytes: row.bytes })

/** `GET /api/evidence/frames/pending` → frames not on 0G yet (the backfill; never claims, a root is set once). */
const pendingFrames = (database: QueryDatabaseClient) =>
  Effect.map(framesWithoutRoot(database, FRAMES_PER_CALL), (rows) => rows.map(pendingView)).pipe(
    Effect.flatMap((frames) => json({ frames })),
  )

export const evidenceFrameRoutes = (
  database: QueryDatabaseClient,
  media: ReadWriteBucketClient,
  token: Option.Option<Redacted.Redacted>,
) =>
  HttpRouter.addAll([
    HttpRouter.route('GET', '/api/evidence/frames/pending', withUploaderToken(token, pendingFrames(database))),
    HttpRouter.route(
      'GET',
      '/api/evidence/:episodeId/frames/:sha256',
      withUploaderToken(token, readFrame(database, media)),
    ),
    HttpRouter.route(
      'POST',
      '/api/evidence/:episodeId/frames/:sha256',
      withUploaderToken(token, frameUploaded(database)),
    ),
  ])
