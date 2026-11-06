import { Schema } from 'effect'
import { getJson, postJson } from './Http.ts'
import { GrantView } from './Wallet.ts'

/** The robot console's view of the Robot Agent API (packages/server/src/robot/routes.ts). */

export const ConsoleRobot = Schema.Struct({
  robot: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    status: Schema.String,
    chipAddress: Schema.NullOr(Schema.String),
  }),
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
export const startErrand = (robotId: string, item: string) =>
  postJson(`/api/robots/${robotId}/errands`, { item }, ErrandCreated)
export const loadErrand = (robotId: string, episodeId: string) =>
  getJson(`/api/robots/${robotId}/errands/${episodeId}`, ErrandDetail)

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
