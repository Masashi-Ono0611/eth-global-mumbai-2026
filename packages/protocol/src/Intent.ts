import { Schema } from 'effect'
import { Id } from './Base32.ts'
import { EpisodeState, TeeProof } from './Errand.ts'
import { UnixMs } from './Hex.ts'

// The owner's errand intent: one instruction ("get me a chai") for one robot, created the same way from a Buy chip,
// typed text or voice. A scan by that robot claims the open intent, so the 0G `decide` sees what the owner asked for.
// For a simulator robot the intent is also the navigation session: 0G (glm-5.3) drives the duck with the tools below,
// one Worker-stored turn at a time. The Worker's `decide` stays the only input that leads to a payment.

export const RobotKind = Schema.Literals(['chip', 'sim'])
export type RobotKind = typeof RobotKind.Type

export const INSTRUCTION_MAX = 200
export const NAV_MAX_TURNS = 14

export const IntentState = Schema.Literals(['running', 'scanned', 'finished', 'stopped', 'expired'])
export type IntentState = typeof IntentState.Type

export const isOpenIntent = (state: IntentState): boolean => state === 'running' || state === 'scanned'

/** `POST /api/robots/:robotId/intents` (owner session): the instruction and, from a Buy chip, the catalogue item. */
export const CreateIntentRequest = Schema.Struct({
  instruction: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(INSTRUCTION_MAX)),
  item: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(64))),
})
export type CreateIntentRequest = typeof CreateIntentRequest.Type

/** The places a simulator duck can walk to (the sim maps each to an approach point). */
export const NavPlace = Schema.Literals(['entrance', 'chai_stall', 'samosa_stall', 'thali_stall', 'gate'])
export type NavPlace = typeof NavPlace.Type

export const NavToolName = Schema.Literals(['go_to', 'look', 'scan_qr', 'say', 'wait', 'finish'])
export type NavToolName = typeof NavToolName.Type

/** One tool call the model made, as the Worker validated it (`args` decoded per tool by the sim). */
export const NavCall = Schema.Struct({
  id: Schema.String.check(Schema.isMaxLength(128)),
  name: NavToolName,
  args: Schema.Record(Schema.String, Schema.Unknown),
})
export type NavCall = typeof NavCall.Type

/**
 * What the sim reports for a call it executed. `go_to`, `look` and `say` results come from the sim; for `scan_qr` the
 * sim reports only that it posted the scan (`{posted: invoiceId}` or `{seen: null}`), and the Worker substitutes the
 * errand's real state, so a sim cannot forge a payment outcome into the transcript.
 */
export const NavResult = Schema.Struct({
  callId: Schema.String.check(Schema.isMaxLength(128)),
  result: Schema.Record(Schema.String, Schema.Unknown),
})
export type NavResult = typeof NavResult.Type

/** `POST /api/chips/:robotId/intents/:intentId/turn` (chip token): results of the previous calls and the scene. */
export const NavTurnRequest = Schema.Struct({
  results: Schema.Array(NavResult).check(Schema.isMaxLength(8)),
  scene: Schema.String.check(Schema.isMaxLength(2000)),
})
export type NavTurnRequest = typeof NavTurnRequest.Type

/** One stored turn, as the owner and the sim see it: the model's calls, its short reasoning, its TEE proof. */
export const NavTurnView = Schema.Struct({
  step: Schema.Finite,
  model: Schema.String,
  chatId: Schema.NullOr(Schema.String),
  latencyMs: Schema.NullOr(Schema.Finite),
  calls: Schema.Array(NavCall),
  reasoning: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  tee: Schema.NullOr(TeeProof),
  createdAt: UnixMs,
})
export type NavTurnView = typeof NavTurnView.Type

export const NavTurnResponse = Schema.Struct({
  state: IntentState,
  calls: Schema.Array(NavCall),
  reason: Schema.NullOr(Schema.String),
})
export type NavTurnResponse = typeof NavTurnResponse.Type

export const IntentView = Schema.Struct({
  id: Id,
  robotId: Id,
  state: IntentState,
  instruction: Schema.String,
  item: Schema.NullOr(Schema.String),
  episodeId: Schema.NullOr(Id),
  episodeState: Schema.NullOr(EpisodeState),
  reason: Schema.NullOr(Schema.String),
  turns: Schema.Array(NavTurnView),
  createdAt: UnixMs,
})
export type IntentView = typeof IntentView.Type
