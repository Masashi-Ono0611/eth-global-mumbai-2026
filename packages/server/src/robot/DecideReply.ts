import type { DecideToolResult } from '@ethmumbai/protocol/Errand'
import { Option, Predicate, Schema } from 'effect'

// Reading the brain's `decide` call tolerantly (6 Nov: rehearsal models returned arguments as objects, upper-case
// actions, missing reasons). Only the form is forgiven, never the substance: a reply without a `decide` tool call, or
// with an action outside pay / ask_human / walk_away, is still a failure, and the errand ends in safe_stop.

/** A chat message as routers send it: tool calls, the legacy `function_call`, or only text. */
export const ReplyMessage = Schema.Struct({
  tool_calls: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
  function_call: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
  content: Schema.optionalKey(Schema.NullOr(Schema.Unknown)),
})
export type ReplyMessage = typeof ReplyMessage.Type

const FunctionCall = Schema.Struct({ name: Schema.String, arguments: Schema.optionalKey(Schema.Unknown) })
const ToolCall = Schema.Struct({ function: FunctionCall })
const RawDecision = Schema.Struct({ action: Schema.String, reason: Schema.optionalKey(Schema.Unknown) })
const parseJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

const ACTIONS = ['pay', 'ask_human', 'walk_away'] as const

export type ParsedDecision =
  | { readonly ok: true; readonly result: DecideToolResult }
  | { readonly ok: false; readonly error: string }

const fail = (error: string): ParsedDecision => ({ ok: false, error })

/** What the reply looked like, without its text: enough to tell why a decision failed. */
const shapeOf = (message: ReplyMessage) => {
  const calls = message.tool_calls ?? []
  const names = calls.flatMap((call) =>
    Option.match(Schema.decodeUnknownOption(ToolCall)(call), { onNone: () => ['?'], onSome: (c) => [c.function.name] }),
  )
  const content = message.content
  const text = typeof content === 'string' ? `text ${content.length} chars` : content == null ? 'no text' : 'non-text'
  return `${calls.length} tool call(s)${names.length > 0 ? ` [${names.join(', ')}]` : ''}, ${message.function_call == null ? 'no' : 'a'} function_call, ${text}`
}

const decideArgumentsOf = (message: ReplyMessage) => {
  const legacy = message.function_call == null ? [] : [{ function: message.function_call }]
  for (const call of [...(message.tool_calls ?? []), ...legacy]) {
    const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(ToolCall)(call))
    if (decoded?.function.name.trim().toLowerCase() === 'decide') return Option.some(decoded.function.arguments)
  }
  return Option.none<unknown>()
}

/** `ask-human`, `Ask Human`, `ASK_HUMAN` → `ask_human`; anything else is not an action. */
const actionOf = (raw: string) => {
  const normalised = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return ACTIONS.find((action) => action === normalised)
}

/**
 * The decision in a reply message: the first `decide` call (tool call or legacy function call) whose arguments are a
 * JSON string or an object with an action; extra fields are ignored, a missing reason is "", a long one is cut to 200.
 */
export const parseDecision = (message: ReplyMessage): ParsedDecision => {
  const found = decideArgumentsOf(message)
  if (Option.isNone(found)) return fail(`no decide tool call in the reply (${shapeOf(message)})`)
  const raw = found.value
  const object = typeof raw === 'string' ? Option.getOrUndefined(parseJson(raw)) : raw
  if (!Predicate.isObject(object))
    return fail(
      `decide arguments are not a JSON object (${typeof raw === 'string' ? `string ${raw.length} chars` : typeof raw})`,
    )
  const decision = Option.getOrUndefined(Schema.decodeUnknownOption(RawDecision)(object))
  if (decision === undefined)
    return fail(`decide arguments have no action (keys: ${Object.keys(object).join(', ') || 'none'})`)
  const action = actionOf(decision.action)
  if (action === undefined)
    return fail(`decide action "${decision.action.slice(0, 24)}" is not pay, ask_human or walk_away`)
  const reason = typeof decision.reason === 'string' ? decision.reason.slice(0, 200) : ''
  return { ok: true, result: { action, reason } }
}
