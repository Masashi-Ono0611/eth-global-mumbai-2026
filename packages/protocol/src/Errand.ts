import { Schema } from 'effect'
import { Id } from './Base32.ts'
import {
  Address,
  Bytes32,
  EcdsaSignature,
  type Hex,
  HexBytes,
  Sha256Hex,
  UintString,
  UnixMs,
  UnixSeconds,
} from './Hex.ts'
import { keccak256Utf8 } from './Keccak.ts'

// The Robot Agent's errand (= episode) state machine and its 0G decision (§6).
export const TerminalEpisodeState = Schema.Literals([
  'paid',
  'walked_away',
  'safe_stop',
  'denied',
  'refused',
  'failed',
  'expired',
])
export const EpisodeState = Schema.Literals([
  'queued',
  'deciding',
  'awaiting_approval',
  'signing',
  'settling',
  ...TerminalEpisodeState.literals,
])
export type EpisodeState = typeof EpisodeState.Type

export const isTerminalState = (state: EpisodeState): boolean =>
  TerminalEpisodeState.literals.some((terminal) => terminal === state)

export const DecisionAction = Schema.Literals(['pay', 'ask_human', 'walk_away', 'safe_stop'])
export type DecisionAction = typeof DecisionAction.Type
export const DecisionOutcome = Schema.Literals([
  'paid',
  'approved',
  'denied',
  'refused',
  'failed',
  'walked_away',
  'safe_stop',
])
export type DecisionOutcome = typeof DecisionOutcome.Type

/** What the model may answer through the `decide` tool (`safe_stop` is ours, never the model's). */
export const DecideToolResult = Schema.Struct({
  action: Schema.Literals(['pay', 'ask_human', 'walk_away']),
  reason: Schema.String.check(Schema.isMaxLength(200)),
})
export type DecideToolResult = typeof DecideToolResult.Type

export const DecideInput = Schema.Struct({
  requested: Schema.String,
  catalogue: Schema.Struct({
    itemId: Schema.String,
    name: Schema.String,
    amount: UintString,
    restricted: Schema.Boolean,
  }),
  invoice: Schema.Struct({ id: Id, payTo: Address, amount: UintString, expiresAt: UnixSeconds }),
  budget: Schema.Struct({
    dailyCap: UintString,
    spentToday: UintString,
    remainingToday: UintString,
    perPaymentCap: UintString,
  }),
  policy: Schema.Struct({
    payeeAllowlisted: Schema.Boolean,
    restricted: Schema.Boolean,
    approvalRequired: Schema.Boolean,
  }),
  merchant: Schema.Struct({ id: Schema.String, trust: Schema.Literals(['known', 'untrusted']) }),
})
export type DecideInput = typeof DecideInput.Type

export const CreateErrandRequest = Schema.Struct({ item: Schema.String.check(Schema.isMaxLength(64)) })
export const CreateErrandResponse = Schema.Struct({
  episodeId: Id,
  state: EpisodeState,
  decision: Schema.Struct({ action: DecisionAction, reason: Schema.String, requestId: Schema.NullOr(Schema.String) }),
  approvalUrl: Schema.optionalKey(Schema.String),
})
export type CreateErrandResponse = typeof CreateErrandResponse.Type

/**
 * A 0G TeeML proof of one decision, as fetched from the provider after the call: the TEE signer's address, the exact
 * text it signed, its signature, the `signing_address` the signature endpoint answered, the registry `url` of the
 * service that served the proof, when we fetched it (unix ms) and whether our check of signature against signer
 * passed. Stored as `decisions.tee_json`.
 */
export const TeeProof = Schema.Struct({
  signer: Address,
  text: Schema.String,
  signature: HexBytes,
  signingAddress: Address,
  serviceUrl: Schema.String,
  fetchedAt: UnixMs,
  verified: Schema.Boolean,
})
export type TeeProof = typeof TeeProof.Type

/** One decision in the evidence. `tee` is absent for decisions without a TEE proof, so older evidence is unchanged. */
export const EvidenceDecision = Schema.Struct({
  step: Schema.Finite,
  model: Schema.String,
  requestId: Schema.NullOr(Schema.String),
  chatId: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  latencyMs: Schema.NullOr(Schema.Finite),
  promptSha256: Schema.String,
  action: DecisionAction,
  reason: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(DecisionOutcome),
  tee: Schema.optionalKey(TeeProof),
})

/** A chip-signed scan the episode carries: the crop's digest and size, when it was taken, the chip's signature. */
export const EvidenceObservation = Schema.Struct({
  sha256: Sha256Hex,
  bytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  capturedAt: UnixMs,
  chipSig: EcdsaSignature,
})
export type EvidenceObservation = typeof EvidenceObservation.Type

/**
 * The episode evidence uploaded to 0G Storage. `observations` is absent on episodes without a scan (read it as `[]`),
 * so older evidence encodes byte-identically; it is not part of `requestIdsHash`.
 */
export const EpisodeEvidence = Schema.Struct({
  episodeId: Id,
  robotId: Id,
  item: Schema.String,
  decisions: Schema.Array(EvidenceDecision),
  outcome: Schema.Struct({
    state: EpisodeState,
    txHash: Schema.optionalKey(Bytes32),
    approvalId: Schema.optionalKey(Id),
  }),
  requestIds: Schema.Array(Schema.String),
  observations: Schema.optionalKey(Schema.Array(EvidenceObservation)),
})
export type EpisodeEvidence = typeof EpisodeEvidence.Type

/** `keccak256(utf8(requestIds.join(",")))`, the `EpisodeLog.record` argument. */
export const requestIdsHash = (requestIds: readonly string[]): Hex => keccak256Utf8(requestIds.join(','))
