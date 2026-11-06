import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { EvidenceObservation } from '@ethmumbai/protocol/Errand'
import { EcdsaSignature, Sha256Hex } from '@ethmumbai/protocol/Hex'
import { Effect, Option, Schema } from 'effect'
import { isAddressEqual, recoverMessageAddress, sha256 } from 'viem'
import { allRows, firstRow } from '../Sql.ts'

// What the robot's camera saw: one QR crop per scan, hashed and signed on the chip (packages/protocol Scan.ts), kept
// owner-private in R2. The image never leaves R2 (not to 0G, not into the evidence); the evidence carries its hash,
// size, capture time and chip signature. Written by the chip's scan route; read by the evidence, the audit verify and
// the owner's wallet view.

/** The policy limit on a crop (spec rule 4: one small QR crop, never a scene); the wire schema allows up to 512 KiB. */
export const MAX_SCAN_BYTES = 64 * 1024
/** Stored scans per robot per minute before the route answers 429. */
export const SCANS_PER_MINUTE = 10

/** One `observations` row (spec §3): `captured_at` is unix ms as the chip signed it, `frame_sha256` 0x + 64 hex. */
export const ObservationRow = Schema.Struct({
  id: Schema.String,
  robot_id: Schema.String,
  episode_id: Schema.String,
  invoice_id: Schema.String,
  frame_sha256: Sha256Hex,
  bytes: Schema.Finite,
  captured_at: Schema.Finite,
  chip_sig: EcdsaSignature,
  r2_key: Schema.String,
  created_at: Schema.Finite,
})
export type ObservationRow = typeof ObservationRow.Type

/** The private R2 object of a scan: `observations/<robotId>/<episodeId>/<0x sha256>.jpg`. */
export const observationKey = (robotId: string, episodeId: string, sha256Hex: string) =>
  `observations/${robotId}/${episodeId}/${sha256Hex}.jpg`

/** The crop's digest as signed and stored: `0x` + 64 lowercase hex. */
export const frameSha256 = (bytes: Uint8Array) => sha256(bytes)

/** Does the EIP-191 `sig` over `message` recover to the robot's chip? A malformed signature is simply `false`. */
export const scanSignedBy = (message: string, sig: `0x${string}`, chipAddress: `0x${string}` | null) =>
  Effect.tryPromise(() => recoverMessageAddress({ message, signature: sig })).pipe(
    Effect.option,
    Effect.map((signer) =>
      Option.exists(signer, (address) => chipAddress !== null && isAddressEqual(address, chipAddress)),
    ),
  )

/** The scan this robot already stored for this invoice (unique per robot and invoice). */
export const observationFor = (database: QueryDatabaseClient, robotId: string, invoiceId: string) =>
  firstRow(
    database.prepare('SELECT * FROM observations WHERE robot_id = ? AND invoice_id = ?').bind(robotId, invoiceId),
    ObservationRow,
  )

const Count = Schema.Struct({ count: Schema.Finite })

/** Scans this robot stored since `sinceMillis` (the per-robot rate limit). */
export const recentScans = (database: QueryDatabaseClient, robotId: string, sinceMillis: number) =>
  firstRow(
    database
      .prepare('SELECT count(*) AS count FROM observations WHERE robot_id = ? AND created_at >= ?')
      .bind(robotId, sinceMillis),
    Count,
  ).pipe(Effect.map((row) => Option.match(row, { onNone: () => 0, onSome: ({ count }) => count })))

/** The errand's observations, oldest capture first. */
export const observationsOf = (database: QueryDatabaseClient, episodeId: string) =>
  allRows(
    database.prepare('SELECT * FROM observations WHERE episode_id = ? ORDER BY captured_at, id').bind(episodeId),
    ObservationRow,
  )

/** The evidence's view of a scan: its hash, size, capture time and the chip's signature, never the image. */
export const evidenceObservation = (row: ObservationRow): EvidenceObservation => ({
  sha256: row.frame_sha256,
  bytes: row.bytes,
  capturedAt: row.captured_at,
  chipSig: row.chip_sig,
})
