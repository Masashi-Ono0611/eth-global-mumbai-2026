import { DecideInput, DecideToolResult } from '@ethmumbai/protocol/Errand'
import { Clock, Effect, Option, Redacted, Result, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { sha256Hex } from '../Respond.ts'

/** `ZG_BASE_URL`, `ZG_API_KEY`, `ZG_MODEL`: the 0G router (OpenAI-compatible, `…/v1`). */
export interface ZeroGConfig {
  readonly baseUrl: string
  readonly apiKey: Redacted.Redacted
  readonly model: string
}

export const ZEROG_TIMEOUT = '10 seconds'

const SYSTEM_PROMPT =
  'You are the purchasing brain of a robot with a USDC budget. Decide only with the decide tool. Never pay when approvalRequired is true or merchant trust is untrusted.'

const DECIDE_TOOL = {
  type: 'function',
  function: {
    name: 'decide',
    parameters: {
      type: 'object',
      required: ['action', 'reason'],
      properties: {
        action: { type: 'string', enum: ['pay', 'ask_human', 'walk_away'] },
        reason: { type: 'string', maxLength: 200 },
      },
    },
  },
} as const

/** The exact `decide` call of spec §6: one forced tool call, temperature 0, structured input only (no frames). */
export const decideRequestBody = (model: string, input: DecideInput) => ({
  model,
  temperature: 0,
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(input) },
  ],
  tools: [DECIDE_TOOL],
  tool_choice: { type: 'function', function: { name: 'decide' } },
})

const Trace = Schema.Struct({
  request_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  provider: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
const ToolCall = Schema.Struct({ function: Schema.Struct({ name: Schema.String, arguments: Schema.String }) })
const Completion = Schema.Struct({
  id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  model: Schema.optionalKey(Schema.NullOr(Schema.String)),
  choices: Schema.Array(
    Schema.Struct({ message: Schema.Struct({ tool_calls: Schema.optionalKey(Schema.Array(ToolCall)) }) }),
  ),
  x_0g_trace: Schema.optionalKey(Schema.NullOr(Trace)),
})
/** Error bodies carry a top-level `request_id`. */
const ErrorBody = Schema.Struct({ request_id: Schema.optionalKey(Schema.NullOr(Schema.String)) })
const decideArguments = Schema.decodeUnknownOption(Schema.fromJsonString(DecideToolResult))

/** What is logged per call (spec §6 `decisions`): never the key, never the prompt itself, only its hash. */
export interface ZeroGCall {
  readonly model: string
  readonly requestId: string | null
  readonly chatId: string | null
  readonly provider: string | null
  readonly latencyMs: number
  readonly promptSha256: string
  readonly inputJson: string
}

export type ZeroGOutcome =
  | { readonly ok: true; readonly call: ZeroGCall; readonly result: DecideToolResult }
  | { readonly ok: false; readonly call: ZeroGCall; readonly error: string }

const toolResult = (completion: typeof Completion.Type) =>
  Option.flatMap(
    Option.fromNullishOr(completion.choices[0]?.message.tool_calls?.find((tool) => tool.function.name === 'decide')),
    (call) => decideArguments(call.function.arguments),
  )

/**
 * One 0G decision. It never fails: a transport error, a non-2xx, a timeout (10 s) or arguments that do not decode are
 * an `ok: false` outcome, which the errand turns into `safe_stop` (never a local fallback decision).
 */
export const decide = Effect.fn('EthMumbai.Robot.decide')(function* (config: ZeroGConfig, input: DecideInput) {
  const client = yield* HttpClient.HttpClient
  const body = decideRequestBody(config.model, input)
  const bodyJson = JSON.stringify(body)
  const started = yield* Clock.currentTimeMillis
  const base = {
    model: config.model,
    promptSha256: yield* sha256Hex(bodyJson),
    inputJson: JSON.stringify(input),
  }
  const exchange = client
    .execute(
      HttpClientRequest.post(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`).pipe(
        HttpClientRequest.bearerToken(Redacted.value(config.apiKey)),
        HttpClientRequest.bodyText(bodyJson, 'application/json'),
      ),
    )
    .pipe(
      Effect.flatMap((response) =>
        Effect.map(response.json, (json) => ({
          status: response.status,
          json,
          chatId: response.headers['zg-res-key'],
        })),
      ),
      Effect.timeout(ZEROG_TIMEOUT),
      Effect.result,
    )
  const reply = yield* exchange
  const latencyMs = (yield* Clock.currentTimeMillis) - started
  const call = (requestId: string | null, chatId: string | null, provider: string | null): ZeroGCall => ({
    ...base,
    requestId,
    chatId,
    provider,
    latencyMs,
  })
  if (Result.isFailure(reply))
    return { ok: false, call: call(null, null, null), error: errorText(reply.failure) } as const
  const { status, json, chatId } = reply.success
  if (status < 200 || status >= 300) {
    const failed = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorBody)(json))
    return {
      ok: false,
      call: call(failed?.request_id ?? null, chatId ?? null, null),
      error: `0G answered ${status}`,
    } as const
  }
  const completion = Schema.decodeUnknownOption(Completion)(json)
  if (Option.isNone(completion))
    return { ok: false, call: call(null, chatId ?? null, null), error: 'reply is not a chat completion' } as const
  const trace = completion.value.x_0g_trace
  const logged = call(trace?.request_id ?? null, chatId ?? completion.value.id ?? null, trace?.provider ?? null)
  const result = toolResult(completion.value)
  return Option.isSome(result)
    ? ({ ok: true, call: logged, result: result.value } as const)
    : ({ ok: false, call: logged, error: 'decide arguments are not {action, reason}' } as const)
})

const Tagged = Schema.Struct({ _tag: Schema.String })
const errorText = (error: unknown) =>
  Option.match(Schema.decodeUnknownOption(Tagged)(error), {
    onNone: () => '0G call failed',
    onSome: ({ _tag }) => (_tag === 'TimeoutError' ? '0G call timed out (10 s)' : `0G call failed: ${_tag}`),
  })

/** Optional bindings: without all three, errands answer 503 "not configured" instead of deciding. */
export const ZeroGBindings = {
  baseUrl: Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/)),
  apiKey: Schema.String.check(Schema.isMinLength(8)),
  model: Schema.String.check(Schema.isMinLength(1)),
}
