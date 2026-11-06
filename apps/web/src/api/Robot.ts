import { IntentView, RobotKind } from '@ethmumbai/protocol/Intent'
import { Schema } from 'effect'
import { getJson, postJson } from './Http.ts'
import { GrantView } from './Wallet.ts'

/** The robot console's view of the Robot Agent API (packages/server/src/robot/routes.ts). */

export const ConsoleRobot = Schema.Struct({
  robot: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    /** `sim`: a simulator duck in the browser (/sim/); absent on Workers before the sim. */
    kind: Schema.optionalKey(RobotKind),
    status: Schema.String,
    chipAddress: Schema.NullOr(Schema.String),
  }),
  /** The errand intent still running for this robot, to resume after a reload. */
  openIntentId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  lease: Schema.Struct({ until: Schema.NullOr(Schema.Number), online: Schema.Boolean }),
  grant: Schema.NullOr(GrantView),
})
export type ConsoleRobot = typeof ConsoleRobot.Type

const ErrandCreated = Schema.Struct({
  episodeId: Schema.String,
  state: Schema.String,
  decision: Schema.Struct({
    action: Schema.String,
    reason: Schema.NullOr(Schema.String),
    requestId: Schema.NullOr(Schema.String),
  }),
  approvalUrl: Schema.optionalKey(Schema.String),
})

export const Decision = Schema.Struct({
  id: Schema.String,
  step: Schema.Number,
  model: Schema.String,
  request_id: Schema.NullOr(Schema.String),
  chat_id: Schema.NullOr(Schema.String),
  latency_ms: Schema.NullOr(Schema.Number),
  provider: Schema.NullOr(Schema.String),
  action: Schema.String,
  reason: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
})
export type Decision = typeof Decision.Type

export const ErrandDetail = Schema.Struct({
  episode: Schema.Struct({
    id: Schema.String,
    item: Schema.String,
    state: Schema.String,
    result: Schema.NullOr(Schema.String),
    invoice_id: Schema.NullOr(Schema.String),
  }),
  decisions: Schema.Array(Decision),
  chipRequest: Schema.NullOr(
    Schema.Struct({ id: Schema.String, status: Schema.String, refusal_code: Schema.NullOr(Schema.String) }),
  ),
  payment: Schema.NullOr(
    Schema.Struct({
      status: Schema.String,
      txHash: Schema.NullOr(Schema.String),
      invoice: Schema.Struct({ id: Schema.String, amount: Schema.String, payTo: Schema.String }),
    }),
  ),
  evidence: Schema.NullOr(
    Schema.Struct({
      status: Schema.String,
      rootHash: Schema.NullOr(Schema.String),
      storageTx: Schema.NullOr(Schema.String),
      logTx: Schema.NullOr(Schema.String),
    }),
  ),
})
export type ErrandDetail = typeof ErrandDetail.Type

export const loadConsoleRobot = (robotId: string) => getJson(`/api/robots/${robotId}`, ConsoleRobot)
/** Starts an errand; `invoiceId` pays that pending invoice (the one the gate shows) instead of the counter's default. */
export const startErrand = (robotId: string, item: string, invoiceId: string | null) =>
  postJson(`/api/robots/${robotId}/errands`, invoiceId === null ? { item } : { item, invoiceId }, ErrandCreated)

/** A 26-character invoice id, typed or pasted as the gate's payment URL (`…/api/i/<id>`). */
export const invoiceIdFrom = (text: string): string | null => {
  const match = /^(?:\S*\/i\/)?([a-z2-7]{26})$/.exec(text.trim())
  return match?.[1] ?? null
}
export const loadErrand = (robotId: string, episodeId: string) =>
  getJson(`/api/robots/${robotId}/errands/${episodeId}`, ErrandDetail)

export const loadEpisodeApproval = (episodeId: string) =>
  getJson(
    `/api/episodes/${episodeId}/approval`,
    Schema.Struct({ id: Schema.String, status: Schema.String, approvalUrl: Schema.String }),
  )

/**
 * Which brain answered a decision, from `decisions.provider` (`<host>/<model>`, plus `@<0G provider>` when the 0G
 * router names one): only a 0G host or a named 0G provider counts as 0G; anything else is the rehearsal brain.
 */
export const isZeroGDecision = (provider: string | null) =>
  provider !== null && (/(^|\.)0g\.ai(\/|$)/.test(provider.split('/')[0] ?? '') || provider.includes('@0x'))

/** Spec §6 terminal states: the console stops polling and enables "Start" again. */
export const terminalStates: ReadonlySet<string> = new Set([
  'paid',
  'walked_away',
  'safe_stop',
  'denied',
  'refused',
  'failed',
  'expired',
])

/** World IdP's sign-in for one approval: a full navigation, so the browser follows the 302 to World (spec §9). */
export const worldAuthorizeUrl = (approvalId: string) =>
  `/api/world/authorize?${new URLSearchParams({ approval: approvalId }).toString()}`

/** An owner's instruction for a robot ("get me a chai"); a simulator duck walks, scans and pays it (sim-plan.md S3). */
export const createIntent = (robotId: string, instruction: string, item: string | null) =>
  postJson(
    `/api/robots/${encodeURIComponent(robotId)}/intents`,
    item === null ? { instruction } : { instruction, item },
    IntentView,
  )
export const loadIntent = (robotId: string, intentId: string) =>
  getJson(`/api/robots/${encodeURIComponent(robotId)}/intents/${encodeURIComponent(intentId)}`, IntentView)
export const stopIntent = (robotId: string, intentId: string) =>
  postJson(`/api/robots/${encodeURIComponent(robotId)}/intents/${encodeURIComponent(intentId)}/stop`, {}, IntentView)

/** The simulator page for a robot; with a pairing code its software chip pairs itself (the code stays in the fragment,
 *  so it never reaches a server log). */
export const simulatorUrl = (robotId: string, pairingCode: string | null) =>
  `/sim/?${new URLSearchParams({ robot: robotId }).toString()}${pairingCode === null ? '' : `#pair=${encodeURIComponent(pairingCode)}`}`
