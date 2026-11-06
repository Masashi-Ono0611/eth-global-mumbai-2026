import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { IntentState, type NavCall, NavToolName } from '@ethmumbai/protocol/Intent'
import { Option, Schema } from 'effect'
import { zeroGCallColumns } from './ZeroGChat.ts'
import { allRows, firstRow } from '../Sql.ts'

// The `intents` and `nav_turns` rows (packages/db schema.ts), shared by the intent routes, the navigation turns and the
// episode evidence. No prompt text is stored with a turn: its hash, the model's calls and the results only.

export const IntentRow = Schema.Struct({
  id: Schema.String,
  robot_id: Schema.String,
  account_id: Schema.String,
  instruction: Schema.String,
  instruction_sha256: Schema.String,
  item: Schema.NullOr(Schema.String),
  state: IntentState,
  turn: Schema.Finite,
  busy_until: Schema.NullOr(Schema.Finite),
  episode_id: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
  created_at: Schema.Finite,
  ended_at: Schema.NullOr(Schema.Finite),
})
export type IntentRow = typeof IntentRow.Type

export const NavTurnRow = Schema.Struct({
  id: Schema.String,
  intent_id: Schema.String,
  ...zeroGCallColumns,
  calls_json: Schema.String,
  reasoning: Schema.NullOr(Schema.String),
  results_json: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  tee_json: Schema.NullOr(Schema.String),
  created_at: Schema.Finite,
})
export type NavTurnRow = typeof NavTurnRow.Type

/** `nav_turns.calls_json`: the assistant message's tool calls as 0G returned them (arguments as JSON text). */
export const StoredToolCall = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal('function'),
  function: Schema.Struct({ name: Schema.String, arguments: Schema.String }),
})
export type StoredToolCall = typeof StoredToolCall.Type
export const StoredToolCalls = Schema.fromJsonString(Schema.Array(StoredToolCall))

const ArgsJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))

/** The stored calls as the owner and the sim see them; a call this code did not write is left out. */
export const navCallsOf = (callsJson: string): ReadonlyArray<NavCall> =>
  Option.match(Schema.decodeUnknownOption(StoredToolCalls)(callsJson), {
    onNone: () => [],
    onSome: (calls) =>
      calls.flatMap((call) => {
        const name = Schema.decodeUnknownOption(NavToolName)(call.function.name)
        const args = Schema.decodeUnknownOption(ArgsJson)(call.function.arguments)
        return Option.isSome(name) && Option.isSome(args) ? [{ id: call.id, name: name.value, args: args.value }] : []
      }),
  })

export const readIntent = (database: QueryDatabaseClient, intentId: string) =>
  firstRow(database.prepare('SELECT * FROM intents WHERE id = ?').bind(intentId), IntentRow)

export const navTurnsOf = (database: QueryDatabaseClient, intentId: string) =>
  allRows(database.prepare('SELECT * FROM nav_turns WHERE intent_id = ? ORDER BY step').bind(intentId), NavTurnRow)
