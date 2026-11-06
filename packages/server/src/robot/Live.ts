import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { FRAME_MAX_BYTES, frameMessage, FrameRequest, type LiveFrame } from '@ethmumbai/protocol/Frame'
import { Sha256Hex } from '@ethmumbai/protocol/Hex'
import { Clock, Effect, Option, Result, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import type { ErrandDeps } from './Errands.ts'
import { frameSha256, scanSignedBy } from './Observations.ts'
import { CurrentSession, requireSession } from '../auth/Session.ts'
import { readRobot } from '../chip/Lease.ts'
import { authenticateChip } from '../chip/Pairing.ts'
import { json, jsonError } from '../Respond.ts'
import { changes, firstRow } from '../Sql.ts'

// The robot's live camera view (Kris, 6 Nov; behind LIVE_ENABLED). About once a second the chip signs a full camera
// frame (`frameMessage`, its own prefix, so it can never pass as a scan) and posts it here; the Worker keeps only the
// latest frame per robot (R2 `live/<robotId>.jpg`, its digest and times in `live_frames`) and the owner's conversation
// polls it. A live frame is never 0G decision input and never evidence by itself.

/** How far the chip's `capturedAt` may be from the Worker's clock. */
const CAPTURE_WINDOW_MS = 120_000
/** The fastest a robot may post frames: one per 400 ms (2.5/s); a faster frame is 429 and not stored. */
export const MIN_FRAME_INTERVAL_MS = 400
/** A frame older than this is not "live" any more: the owner's view answers 404 and stops showing it. */
export const LIVE_FOR_MS = 30_000

const liveKey = (robotId: string) => `live/${robotId}.jpg`

const LiveRow = Schema.Struct({
  robot_id: Schema.String,
  frame_sha256: Sha256Hex,
  bytes: Schema.Finite,
  captured_at: Schema.Finite,
  received_at: Schema.Finite,
})

const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff

/** The frame's bytes once it is fresh, small, a JPEG and exactly what the chip hashed; otherwise why not (400). */
const checkedFrame = (body: FrameRequest, now: number): Result.Result<Uint8Array, string> => {
  if (Math.abs(now - body.capturedAt) > CAPTURE_WINDOW_MS)
    return Result.fail('capturedAt is more than 120 s from the server clock')
  if (body.frame.bytes > FRAME_MAX_BYTES) return Result.fail('frame is larger than 64 KB')
  const bytes = Result.getSuccess(Base64.decode(body.frame.b64))
  if (Option.isNone(bytes)) return Result.fail('frame.b64 is not base64')
  if (bytes.value.length !== body.frame.bytes) return Result.fail('frame.bytes does not match the decoded frame')
  if (!isJpeg(bytes.value)) return Result.fail('frame is not a JPEG')
  if (frameSha256(bytes.value) !== body.frame.sha256) return Result.fail('frame.sha256 does not match the frame')
  return Result.succeed(bytes.value)
}

/**
 * `POST /api/chips/:robotId/frames` (chip token): the frame signed by this robot's chip becomes its latest frame. The
 * rate cap is one write: the row only moves when the previous frame arrived at least 400 ms ago (else 429).
 */
const postFrame = (deps: ErrandDeps, media: ReadWriteBucketClient) =>
  Effect.gen(function* () {
    const robot = yield* authenticateChip(deps.database, (yield* HttpRouter.params).robotId ?? '')
    if (Option.isNone(robot)) return yield* jsonError(401, 'bad chip token')
    const body = yield* HttpServerRequest.schemaBodyJson(FrameRequest).pipe(Effect.option)
    if (Option.isNone(body))
      return yield* jsonError(
        400,
        'expected {"capturedAt" (unix ms), "frame": {"mime", "sha256", "bytes", "b64"}, "sig"}',
      )
    const message = frameMessage(robot.value.id, body.value.frame.sha256, body.value.capturedAt)
    if (!(yield* scanSignedBy(message, body.value.sig, robot.value.chip_address)))
      return yield* jsonError(401, 'frame is not signed by this robot’s chip')
    const now = yield* Clock.currentTimeMillis
    const frame = checkedFrame(body.value, now)
    if (Result.isFailure(frame)) return yield* jsonError(400, frame.failure)
    const moved = yield* changes(
      deps.database
        .prepare(
          `INSERT INTO live_frames (robot_id, frame_sha256, bytes, captured_at, received_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(robot_id) DO UPDATE SET frame_sha256 = excluded.frame_sha256, bytes = excluded.bytes,
              captured_at = excluded.captured_at, received_at = excluded.received_at
            WHERE live_frames.received_at <= ?`,
        )
        .bind(
          robot.value.id,
          body.value.frame.sha256,
          frame.success.length,
          body.value.capturedAt,
          now,
          now - MIN_FRAME_INTERVAL_MS,
        ),
    )
    if (moved === 0) return yield* jsonError(429, 'too many frames: at most one per 400 ms per robot')
    const stored = yield* media
      .put(liveKey(robot.value.id), frame.success, { httpMetadata: { contentType: 'image/jpeg' } })
      .pipe(Effect.option)
    if (Option.isNone(stored)) return yield* jsonError(502, 'R2 did not store the frame')
    return yield* json({ sha256: body.value.frame.sha256, capturedAt: body.value.capturedAt }, 201)
  })

/** The robot's latest frame while it is live (captured in the last 30 s); the caller has checked the owner. */
const freshRow = Effect.fnUntraced(function* (database: QueryDatabaseClient, robotId: string) {
  const row = yield* firstRow(database.prepare('SELECT * FROM live_frames WHERE robot_id = ?').bind(robotId), LiveRow)
  const now = yield* Clock.currentTimeMillis
  return Option.filter(row, (live) => now - live.captured_at <= LIVE_FOR_MS)
})

/** The owner's view of the robot's live frame, with its age now; `None` while there is no fresh frame. */
export const liveFrameOf = Effect.fnUntraced(function* (database: QueryDatabaseClient, robotId: string) {
  const row = yield* freshRow(database, robotId)
  const now = yield* Clock.currentTimeMillis
  return Option.map(row, (live): LiveFrame => ({
    sha256: live.frame_sha256,
    bytes: live.bytes,
    capturedAt: live.captured_at,
    ageMs: Math.max(0, now - live.captured_at),
  }))
})

/** The session's own robot id, or `None` for another owner's robot (indistinguishable from a missing one). */
const ownRobotId = Effect.fnUntraced(function* (deps: ErrandDeps) {
  const session = yield* CurrentSession
  const robotId = (yield* HttpRouter.params).robotId ?? ''
  const robot = Option.filter(yield* readRobot(deps.database, robotId), (row) => row.account_id === session.accountId)
  return Option.map(robot, (row) => row.id)
})

/** `GET /api/robots/:robotId/live` → `{sha256, bytes, capturedAt, ageMs}` of the latest frame, or 404 without one. */
const liveMeta = (deps: ErrandDeps) =>
  Effect.gen(function* () {
    const robotId = yield* ownRobotId(deps)
    const live = Option.isNone(robotId) ? Option.none() : yield* liveFrameOf(deps.database, robotId.value)
    return yield* Option.isNone(live) ? jsonError(404, 'no live frame') : json(live.value)
  })

/** `GET /api/robots/:robotId/live/frame` → the latest JPEG itself, to the owner only, never cached. */
const liveImage = (deps: ErrandDeps, media: ReadWriteBucketClient) =>
  Effect.gen(function* () {
    const robotId = yield* ownRobotId(deps)
    const live = Option.isNone(robotId) ? Option.none() : yield* freshRow(deps.database, robotId.value)
    if (Option.isNone(live)) return yield* jsonError(404, 'no live frame')
    const object = yield* media.get(liveKey(live.value.robot_id)).pipe(Effect.option)
    if (Option.isNone(object)) return yield* jsonError(502, 'R2 did not answer')
    if (object.value === null) return yield* jsonError(404, 'no live frame')
    return HttpServerResponse.stream(object.value.body, {
      contentType: 'image/jpeg',
      headers: {
        'cache-control': 'private, no-store',
        'content-length': String(object.value.size),
        'x-content-type-options': 'nosniff',
      },
    })
  })

/** The live view's routes; `RobotAgent` mounts them only while `LIVE_ENABLED` is `true` (else the paths are 404). */
export const liveRoutes = (deps: ErrandDeps, media: ReadWriteBucketClient) =>
  HttpRouter.addAll([
    HttpRouter.route('POST', '/api/chips/:robotId/frames', postFrame(deps, media)),
    HttpRouter.route('GET', '/api/robots/:robotId/live', requireSession(liveMeta(deps))),
    HttpRouter.route('GET', '/api/robots/:robotId/live/frame', requireSession(liveImage(deps, media))),
  ])
