import { Schema } from 'effect'
import { Id } from './Base32.ts'
import { EpisodeState } from './Errand.ts'
import { EcdsaSignature, Sha256Hex, UnixMs } from './Hex.ts'

// Scan-initiated errands: the robot's camera reads a merchant's invoice QR, and the chip signs the JPEG crop it read
// so the episode can carry it as evidence. Only the crop the chip signed leaves the chip, never a camera frame.

/** The version prefix of the signed scan message; a new layout gets a new version. */
export const SCAN_MESSAGE_PREFIX = 'vitaquack-scan:v1'
/** The largest crop the Worker accepts, in decoded bytes. */
export const SCAN_MAX_BYTES = 512 * 1024

/**
 * The EIP-191 message the chip `personal_sign`s for a scan:
 * `vitaquack-scan:v1|<invoiceId>|<0x frame sha256, lowercase>|<capturedAt, unix ms>|<robotId>`.
 */
export const scanMessage = (invoiceId: string, frameSha256: string, capturedAt: number, robotId: string) =>
  `${SCAN_MESSAGE_PREFIX}|${invoiceId}|${frameSha256.toLowerCase()}|${capturedAt.toFixed(0)}|${robotId}`

/** The crop as the chip sends it: base64 of exactly `bytes` bytes whose SHA-256 is `sha256`. */
export const ScanFrame = Schema.Struct({
  mime: Schema.Literal('image/jpeg'),
  sha256: Sha256Hex,
  bytes: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: SCAN_MAX_BYTES })),
  b64: Schema.String.check(
    Schema.isMaxLength(Math.ceil(SCAN_MAX_BYTES / 3) * 4),
    Schema.isPattern(/^[A-Za-z0-9+/]*={0,2}$/),
  ),
})
export type ScanFrame = typeof ScanFrame.Type

/** The chip's scan body (`…/scans`, chip token): the invoice the robot read, the crop, and its `scanMessage` signature. */
export const ScanRequest = Schema.Struct({
  invoiceId: Id,
  capturedAt: UnixMs,
  frame: ScanFrame,
  sig: EcdsaSignature,
})
export type ScanRequest = typeof ScanRequest.Type

/** The errand the scan started (or joined) and the stored observation. */
export const ScanResponse = Schema.Struct({ episodeId: Id, state: EpisodeState, observationId: Id })
export type ScanResponse = typeof ScanResponse.Type
