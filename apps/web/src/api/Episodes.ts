import { AuditDecision } from '@ethmumbai/protocol/Audit'
import { Schema } from 'effect'
import { getJson, postJson } from './Http.ts'

/** The errand audit view (packages/server/src/wallet/Episodes.ts) and M+R's verify and replay routes. */

export type { AuditDecision } from '@ethmumbai/protocol/Audit'

const Text = Schema.NullOr(Schema.String)
const Time = Schema.NullOr(Schema.Number)

/** What World asserted about the approving sign-in (`acr`, `amr`); never the token itself. */
const WorldClaims = Schema.NullOr(Schema.Struct({ acr: Text, amr: Schema.Array(Schema.String) }))

export const EpisodeSummary = Schema.Struct({
  id: Schema.String,
  robotId: Schema.String,
  robotName: Schema.String,
  item: Schema.String,
  state: Schema.String,
  result: Text,
  createdAt: Schema.Number,
  endedAt: Time,
  decision: Schema.NullOr(
    Schema.Struct({ action: Schema.String, reason: Text, requestId: Text, provider: Text, latencyMs: Time }),
  ),
  payment: Schema.NullOr(Schema.Struct({ status: Schema.String, txHash: Text })),
  approval: Schema.NullOr(Schema.Struct({ status: Schema.String, world: WorldClaims })),
  evidence: Schema.NullOr(Schema.Struct({ status: Schema.String, rootHash: Text, logTx: Text })),
})
export type EpisodeSummary = typeof EpisodeSummary.Type

const Observation = Schema.Struct({
  kind: Schema.String,
  sha256: Schema.String,
  bytes: Schema.Number,
  capturedAt: Schema.Number,
  chipSig: Schema.String,
})
export type Observation = typeof Observation.Type

export const EpisodeAudit = Schema.Struct({
  episode: Schema.Struct({
    id: Schema.String,
    robotId: Schema.String,
    robotName: Schema.String,
    /** The robot's chip, the key that signs its payments and its scanned QR crops. */
    chipAddress: Text,
    item: Schema.String,
    state: Schema.String,
    result: Text,
    requestIdsHash: Text,
    createdAt: Schema.Number,
    endedAt: Time,
  }),
  invoice: Schema.NullOr(
    Schema.Struct({ id: Schema.String, pay_to: Text, amount: Text, restricted: Schema.Boolean, status: Schema.String }),
  ),
  decisions: Schema.Array(AuditDecision),
  chipRequests: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.String,
      status: Schema.String,
      refusal_code: Text,
      leaf_hash: Text,
    }),
  ),
  payments: Schema.Array(
    Schema.Struct({ status: Schema.String, tx_hash: Text, gas_used: Text, fail_reason: Text, payer: Text }),
  ),
  approvals: Schema.Array(
    Schema.Struct({ id: Schema.String, status: Schema.String, error: Text, auth_time: Time, world: WorldClaims }),
  ),
  evidence: Schema.NullOr(
    Schema.Struct({
      status: Schema.String,
      root_hash: Text,
      storage_tx: Text,
      log_tx: Text,
      request_ids_hash: Text,
      error: Text,
    }),
  ),
  /** What the robot saw: chip-signed QR crops; the image is owner-only (`observationImage`), only its hash is evidence. */
  observations: Schema.Array(Observation),
  timeline: Schema.Array(Schema.Struct({ at: Schema.Number, kind: Schema.String, detail: Text })),
})
export type EpisodeAudit = typeof EpisodeAudit.Type

/** `POST /api/wallet/episodes/:id/verify` (M+R): the stored evidence against its `EpisodeLog` record on 0G Chain. */
export const VerifyResult = Schema.Struct({
  episodeId: Schema.String,
  stored: Schema.Struct({
    rootHash: Text,
    requestIdsHash: Text,
    storageTx: Text,
    logTx: Text,
    uploadStatus: Text,
  }),
  onChain: Schema.NullOr(
    Schema.Struct({
      rootHash: Schema.String,
      requestIdsHash: Schema.String,
      recorder: Schema.String,
      recordedAt: Schema.Union([Schema.Number, Schema.String]),
    }),
  ),
  matches: Schema.Struct({ rootHash: Schema.Boolean, requestIdsHash: Schema.Boolean }),
  links: Schema.Struct({ storagescan: Text, chainscan: Text, arcTx: Schema.optionalKey(Schema.String) }),
  /** Each observation's bytes against its hash, and its signature against the robot's chip (absent before M+R's change). */
  observations: Schema.optionalKey(
    Schema.Array(Schema.Struct({ sha256: Schema.String, hashMatches: Schema.Boolean, signerMatches: Schema.Boolean })),
  ),
  downloadCheckedBy: Schema.String,
})
export type VerifyResult = typeof VerifyResult.Type

/** `POST /api/wallet/episodes/:id/replay` (M+R): the same input sent to the brain again; it decides nothing. */
export const ReplayResult = Schema.Struct({
  episodeId: Schema.String,
  binding: Schema.Boolean,
  original: Schema.Struct({ action: Schema.String, reason: Text, requestId: Text, provider: Text }),
  replay: Schema.Union([
    Schema.Struct({
      ok: Schema.Literal(true),
      action: Schema.String,
      reason: Schema.String,
      requestId: Text,
      provider: Schema.String,
      latencyMs: Schema.Number,
    }),
    Schema.Struct({
      ok: Schema.Literal(false),
      error: Schema.String,
      provider: Schema.String,
      latencyMs: Schema.Number,
    }),
  ]),
  same: Schema.Boolean,
})
export type ReplayResult = typeof ReplayResult.Type

export const listEpisodes = (robotId: string | null) =>
  getJson(
    robotId === null ? '/api/wallet/episodes' : `/api/wallet/episodes?robotId=${encodeURIComponent(robotId)}`,
    Schema.Struct({ episodes: Schema.Array(EpisodeSummary) }),
  )
export const loadEpisodeAudit = (episodeId: string) =>
  getJson(`/api/wallet/episodes/${encodeURIComponent(episodeId)}`, EpisodeAudit)
export const verifyEpisode = (episodeId: string) =>
  postJson(`/api/wallet/episodes/${encodeURIComponent(episodeId)}/verify`, {}, VerifyResult)
export const replayDecision = (episodeId: string) =>
  postJson(`/api/wallet/episodes/${encodeURIComponent(episodeId)}/replay`, {}, ReplayResult)

/** The owner-only JPEG of one observation (session cookie; never cached). */
export const observationImage = (episodeId: string, sha256: string) =>
  `/api/wallet/episodes/${encodeURIComponent(episodeId)}/observations/${encodeURIComponent(sha256)}`

export const storageScan = (rootHash: string) => `https://storagescan-galileo.0g.ai/file/${rootHash}`
export const chainScan = (hash: string) => `https://chainscan-galileo.0g.ai/tx/${hash}`

/** A clock time in the page's time zone (the server renders in UTC and the browser hydrates with the same flags). */
export const clockTime = (at: number, locale: string, timeZone: string) =>
  new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).format(at)
