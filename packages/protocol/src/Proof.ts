import { Schema } from 'effect'
import { requestIdsHash } from './Errand.ts'
import type { Hex } from './Hex.ts'
import { keccak256Utf8 } from './Keccak.ts'

// Public proofs (Kris, 7 Nov): every episode the uploader put on 0G, listed for anyone, and one episode's proof
// re-checked in the reader's own browser against 0G Chain and 0G Storage. The Worker only names where to look (the
// root, the EpisodeLog contract, the endpoints); what the page shows is downloaded from 0G by that root.
// Nothing here is beyond what 0G already holds in public: the episode JSON (robot id, never its name; the instruction
// and prompts as hashes only) and the EpisodeLog record.

/** Where a reader checks a proof: the EpisodeLog contract on 0G Chain, its RPC, and the 0G Storage indexer. */
export const ProofAnchors = Schema.Struct({
  chainId: Schema.Number,
  episodeLog: Schema.NullOr(Schema.String),
  rpcUrl: Schema.String,
  indexerUrl: Schema.String,
})
export type ProofAnchors = typeof ProofAnchors.Type

/** One published episode in the list, read from the evidence the uploader stored. */
export const ProofSummary = Schema.Struct({
  episodeId: Schema.String,
  item: Schema.String,
  state: Schema.String,
  /** The last 0G decision's action and model (null when the episode has no decision). */
  action: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  /** Decisions that carry a TEE proof from their 0G provider. */
  teeProofs: Schema.Number,
  /** Chip-signed camera frames named, with their 0G Storage root, in the anchored JSON. */
  frames: Schema.Number,
  rootHash: Schema.String,
  logTx: Schema.NullOr(Schema.String),
  paymentTx: Schema.NullOr(Schema.String),
  /** Unix seconds. */
  uploadedAt: Schema.Number,
})
export type ProofSummary = typeof ProofSummary.Type

/** `GET /api/proofs[?after=<cursor>]`: newest first; `next` is the cursor for older ones, null at the end. */
export const ProofList = Schema.Struct({
  anchors: ProofAnchors,
  proofs: Schema.Array(ProofSummary),
  next: Schema.NullOr(Schema.String),
})
export type ProofList = typeof ProofList.Type

/** `GET /api/proofs/:episodeId`: where the episode is on 0G. The content itself comes from 0G Storage by `rootHash`. */
export const ProofPointer = Schema.Struct({
  anchors: ProofAnchors,
  episodeId: Schema.String,
  rootHash: Schema.String,
  storageTx: Schema.NullOr(Schema.String),
  logTx: Schema.NullOr(Schema.String),
  uploadedAt: Schema.Number,
})
export type ProofPointer = typeof ProofPointer.Type

/** `EpisodeLog.records(bytes32)` calldata for an episode: the selector, then `keccak256(utf8(episodeId))`. */
export const recordsCallData = (episodeId: string): Hex =>
  `0x${keccak256Utf8('records(bytes32)').slice(2, 10)}${keccak256Utf8(episodeId).slice(2)}`

/** What `EpisodeLog.records` returned: null when the episode has no record (`recordedAt` 0). `recordedAt` is unix s. */
export const ChainRecord = Schema.Struct({
  rootHash: Schema.String,
  requestIdsHash: Schema.String,
  recorder: Schema.String,
  recordedAt: Schema.Number,
})
export type ChainRecord = typeof ChainRecord.Type

/** Decodes the four ABI words `records` returns (`bytes32, bytes32, address, uint64`); null for a missing record. */
export const decodeRecord = (result: string): ChainRecord | null => {
  const body = result.replace(/^0x/, '')
  if (!/^[0-9a-fA-F]*$/.test(body) || body.length < 64 * 4) return null
  const word = (index: number) => body.slice(index * 64, (index + 1) * 64)
  const recordedAt = Number(BigInt(`0x${word(3)}`))
  if (recordedAt === 0) return null
  return {
    rootHash: `0x${word(0)}`,
    requestIdsHash: `0x${word(1)}`,
    recorder: `0x${word(2).slice(24)}`,
    recordedAt,
  }
}

const sameHex = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

/**
 * The checks that tie a downloaded episode to its on-chain record: EpisodeLog holds a record at all; its root is the
 * root the episode was downloaded by; `keccak256(requestIds.join(","))` of the downloaded JSON is the record's
 * request-ids hash; and the downloaded JSON names this episode.
 */
export const AnchorChecks = Schema.Struct({
  recorded: Schema.Boolean,
  rootMatches: Schema.Boolean,
  requestIdsMatch: Schema.Boolean,
  sameEpisode: Schema.Boolean,
})
export type AnchorChecks = typeof AnchorChecks.Type

export const anchorChecks = (
  episodeId: string,
  rootHash: string,
  downloaded: { readonly episodeId: string; readonly requestIds: ReadonlyArray<string> },
  record: ChainRecord | null,
): AnchorChecks => ({
  recorded: record !== null,
  rootMatches: record !== null && sameHex(record.rootHash, rootHash),
  requestIdsMatch: record !== null && sameHex(record.requestIdsHash, requestIdsHash(downloaded.requestIds)),
  sameEpisode: downloaded.episodeId === episodeId,
})
