import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { generateId } from '@ethmumbai/protocol/Base32'
import { scanMessage, ScanRequest, type ScanResponse } from '@ethmumbai/protocol/Scan'
import { Clock, Effect, Option, Result } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import { type ErrandDeps, readEpisode, tickRobot } from './Errands.ts'
import {
  frameSha256,
  MAX_SCAN_BYTES,
  observationFor,
  observationKey,
  recentScans,
  scanSignedBy,
  SCANS_PER_MINUTE,
} from './Observations.ts'
import { ErrandRefused, errandSetup, need, runErrand, signedGrant } from './Start.ts'
import type { RobotRow } from '../chip/Lease.ts'
import { authenticateChip } from '../chip/Pairing.ts'
import { findItem } from '../merchant/Catalogue.ts'
import { readInvoice } from '../merchant/Invoices.ts'
import { json, jsonError } from '../Respond.ts'
import { changes } from '../Sql.ts'

// `POST /api/chips/:robotId/scans` (spec rule 4, behind SCANS_ENABLED): the robot's camera read an invoice QR, the chip
// hashed and signed the JPEG crop, and this starts the errand for exactly that invoice, as the owner's console would.
// The crop is stored owner-private in R2 before the 0G decision and never sent to 0G; the evidence carries its hash.

/** How far the chip's `capturedAt` may be from the Worker's clock. */
const CAPTURE_WINDOW_MS = 120_000

const refuse = (status: number, error: string) => Effect.fail(new ErrandRefused({ status, error }))

/** The body, signed by this robot's paired chip over the exact `scanMessage` (else 401: it is not the chip). */
const signedScan = Effect.fnUntraced(function* (robot: RobotRow) {
  const scan = yield* need(
    yield* HttpServerRequest.schemaBodyJson(ScanRequest).pipe(Effect.option),
    400,
    'expected {"invoiceId", "capturedAt" (unix ms), "frame": {"mime", "sha256", "bytes", "b64"}, "sig"}',
  )
  const message = scanMessage(scan.invoiceId, scan.frame.sha256, scan.capturedAt, robot.id)
  if (!(yield* scanSignedBy(message, scan.sig, robot.chip_address)))
    return yield* refuse(401, 'scan is not signed by this robot’s chip')
  return scan
})

const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff

/** The crop's bytes, once they are fresh, small, a JPEG, and exactly what the chip hashed and signed. */
const checkedFrame = Effect.fnUntraced(function* (scan: ScanRequest) {
  const now = yield* Clock.currentTimeMillis
  if (Math.abs(now - scan.capturedAt) > CAPTURE_WINDOW_MS)
    return yield* refuse(400, 'capturedAt is more than 120 s from the server clock')
  if (scan.frame.bytes > MAX_SCAN_BYTES) return yield* refuse(400, 'frame is larger than 64 KB')
  const bytes = yield* need(Result.getSuccess(Base64.decode(scan.frame.b64)), 400, 'frame.b64 is not base64')
  if (bytes.length !== scan.frame.bytes) return yield* refuse(400, 'frame.bytes does not match the decoded frame')
  if (!isJpeg(bytes)) return yield* refuse(400, 'frame is not a JPEG')
  if (frameSha256(bytes) !== scan.frame.sha256) return yield* refuse(400, 'frame.sha256 does not match the frame')
  return bytes
})

/** The scanned invoice must exist (404) and be this merchant's (409); the errand path checks it is open. */
const scanContext = Effect.fnUntraced(function* (deps: ErrandDeps, robot: RobotRow, invoiceId: string) {
  const invoice = yield* need(yield* readInvoice(deps.database, invoiceId), 404, 'unknown invoice')
  const { payees, zeroG, merchant } = yield* errandSetup(deps)
  if (invoice.merchant_id !== merchant.id) return yield* refuse(409, 'invoice is not for this merchant')
  const item = yield* need(findItem(merchant, invoice.item_id), 409, 'invoice item is not sold here')
  const grant = yield* signedGrant(deps, robot)
  return { robot, payees, zeroG, merchant, item, grant, invoiceId }
})

/** Put the crop in R2 (private) and record it, before the decision so the evidence includes it. */
const storeObservation =
  (deps: ErrandDeps, media: ReadWriteBucketClient, input: { robot: RobotRow; scan: ScanRequest; frame: Uint8Array }) =>
  (observationId: string) =>
  (episodeId: string) =>
    Effect.gen(function* () {
      const { robot, scan, frame } = input
      const key = observationKey(robot.id, episodeId, scan.frame.sha256)
      yield* media
        .put(key, frame, { httpMetadata: { contentType: 'image/jpeg' } })
        .pipe(Effect.mapError(() => new ErrandRefused({ status: 502, error: 'R2 did not store the frame' })))
      const createdAt = yield* Clock.currentTimeMillis
      const inserted = yield* changes(
        deps.database
          .prepare(
            `INSERT INTO observations (id, robot_id, episode_id, invoice_id, frame_sha256, bytes, captured_at, chip_sig,
               r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          )
          .bind(
            observationId,
            robot.id,
            episodeId,
            scan.invoiceId,
            scan.frame.sha256,
            frame.length,
            scan.capturedAt,
            scan.sig,
            key,
            createdAt,
          ),
      )
      if (inserted === 0) return yield* refuse(409, 'this invoice was already scanned')
    })

/** A repeat of a stored scan (same robot and invoice) answers 200 with the errand it started. */
const repeated = Effect.fnUntraced(function* (deps: ErrandDeps, robot: RobotRow, invoiceId: string) {
  const stored = yield* observationFor(deps.database, robot.id, invoiceId)
  if (Option.isNone(stored)) return Option.none<ScanResponse>()
  yield* tickRobot(deps.database, robot.id)
  const episode = yield* need(yield* readEpisode(deps.database, stored.value.episode_id), 500, 'scan lost its errand')
  return Option.some<ScanResponse>({ episodeId: episode.id, state: episode.state, observationId: stored.value.id })
})

const scan = (deps: ErrandDeps, media: ReadWriteBucketClient) =>
  Effect.gen(function* () {
    const robot = yield* need(
      yield* authenticateChip(deps.database, (yield* HttpRouter.params).robotId ?? ''),
      401,
      'bad chip token',
    )
    const signed = yield* signedScan(robot)
    const again = yield* repeated(deps, robot, signed.invoiceId)
    if (Option.isSome(again)) return yield* json(again.value, 200)
    const since = (yield* Clock.currentTimeMillis) - 60_000
    if ((yield* recentScans(deps.database, robot.id, since)) >= SCANS_PER_MINUTE)
      return yield* refuse(429, 'too many scans: at most 10 a minute per robot')
    const frame = yield* checkedFrame(signed)
    const context = yield* scanContext(deps, robot, signed.invoiceId)
    const observationId = yield* generateId
    const started = yield* runErrand(
      deps,
      context,
      storeObservation(deps, media, { robot, scan: signed, frame })(observationId),
    )
    const response: ScanResponse = { episodeId: started.episodeId, state: started.state, observationId }
    return yield* json(response, 201)
  }).pipe(Effect.catchTag('ErrandRefused', ({ status, error }) => jsonError(status, error)))

/** The chip's scan route; `RobotAgent` mounts it only while `SCANS_ENABLED` is `true` (else the path is 404). */
export const scanRoutes = (deps: ErrandDeps, media: ReadWriteBucketClient) =>
  HttpRouter.add('POST', '/api/chips/:robotId/scans', scan(deps, media))
