import { Schema } from 'effect'
import { EcdsaSignature, Sha256Hex, UnixMs } from './Hex.ts'
import { ScanFrame } from './Scan.ts'

// Live camera frames (Kris, 6 Nov): about once a second the robot's chip signs a full camera frame and posts it, the
// Worker keeps only the latest one per robot, and the owner's conversation shows it. A frame is evidence and a live
// view, never input to the 0G decision. Its signed message has its own prefix, so a frame can never pass as a scan.

/** The version prefix of the signed frame message; a new layout gets a new version. */
export const FRAME_MESSAGE_PREFIX = 'vitaquack-frame:v1'
/** The largest frame the Worker keeps, in decoded bytes (a 320×240 JPEG is ~10-20 KB; a 640×480 one ~30-60 KB). */
export const FRAME_MAX_BYTES = 64 * 1024

/** The EIP-191 message the chip signs: `vitaquack-frame:v1|<robotId>|<0x sha256, lowercase>|<capturedAt, unix ms>`. */
export const frameMessage = (robotId: string, frameSha256: string, capturedAt: number) =>
  `${FRAME_MESSAGE_PREFIX}|${robotId}|${frameSha256.toLowerCase()}|${capturedAt.toFixed(0)}`

/** The chip's frame body (`POST /api/chips/:robotId/frames`, chip token): the JPEG and its `frameMessage` signature. */
export const FrameRequest = Schema.Struct({
  capturedAt: UnixMs,
  frame: ScanFrame,
  sig: EcdsaSignature,
})
export type FrameRequest = typeof FrameRequest.Type

/** What the owner's conversation reads (`GET /api/robots/:id/live`, and on an open intent): the latest frame's digest,
 *  size, capture time and its age when the Worker answered (so the view needs no clock of its own). */
export const LiveFrame = Schema.Struct({
  sha256: Sha256Hex,
  bytes: Schema.Finite,
  capturedAt: UnixMs,
  ageMs: Schema.Finite,
})
export type LiveFrame = typeof LiveFrame.Type
