import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { EvidenceObservation } from '@ethmumbai/protocol/Errand'
import { Bytes32, EcdsaSignature, Sha256Hex } from '@ethmumbai/protocol/Hex'
import { Effect, Option, Schema } from 'effect'
import { isAddressEqual, recoverMessageAddress, sha256 } from 'viem'
import { allRows, firstRow } from '../Sql.ts'

// What the robot's camera saw: one QR crop per scan, hashed and signed on the chip (packages/protocol Scan.ts), kept in
// R2 (the fast copy) and uploaded plain to 0G Storage by the evidence uploader as proof of the robot's work. The
// evidence carries its hash, size, capture time, chip signature and 0G root, never the image itself; the 0G decision
// never receives it. Written by the chip's scan route; read by the evidence, the uploader, the audit verify and the
// owner's wallet view.

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
  zg_root_hash: Schema.NullOr(Bytes32),
  zg_storage_tx: Schema.NullOr(Bytes32),
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

/** The evidence's view of a scan: its hash, size, capture time, the chip's signature and (once uploaded) its 0G root,
 *  never the image. A frame not yet on 0G has no `rootHash` key, so older evidence encodes byte-identically. */
export const evidenceObservation = (row: ObservationRow): EvidenceObservation => ({
  sha256: row.frame_sha256,
  bytes: row.bytes,
  capturedAt: row.captured_at,
  chipSig: row.chip_sig,
  ...(row.zg_root_hash === null ? {} : { rootHash: row.zg_root_hash }),
})

/** Where a frame is on 0G Storage, for the owner's views: both null until the uploader has put it there. */
export const frameOnZeroG = (row: { readonly zg_root_hash: string | null; readonly zg_storage_tx: string | null }) => ({
  rootHash: row.zg_root_hash,
  storageTx: row.zg_storage_tx,
})

const FirstObservation = Schema.Struct({
  frame_sha256: Sha256Hex,
  captured_at: Schema.Finite,
  zg_root_hash: Schema.NullOr(Bytes32),
  zg_storage_tx: Schema.NullOr(Bytes32),
})

/** The errand's first chip-signed crop, as the owner's conversation shows it (the R2 copy stays behind the owner-only
 *  route `GET /api/wallet/episodes/:id/observations/:sha256`; the 0G copy is public by its root). */
export const firstObservation = (database: QueryDatabaseClient, episodeId: string) =>
  Effect.map(
    firstRow(
      database
        .prepare(
          `SELECT frame_sha256, captured_at, zg_root_hash, zg_storage_tx FROM observations WHERE episode_id = ?
            ORDER BY captured_at LIMIT 1`,
        )
        .bind(episodeId),
      FirstObservation,
    ),
    Option.map((row) => ({ sha256: row.frame_sha256, capturedAt: row.captured_at, ...frameOnZeroG(row) })),
  )

/** Frames not yet on 0G Storage, oldest first (the uploader's backfill, including errands from before the upload). */
export const framesWithoutRoot = (database: QueryDatabaseClient, limit: number) =>
  allRows(
    database
      .prepare('SELECT * FROM observations WHERE zg_root_hash IS NULL ORDER BY created_at, id LIMIT ?')
      .bind(limit),
    ObservationRow,
  )
