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
  /**
   * The brain that answered, `<host>/<model>` (plus `@<0G provider>` when the router names one), so the evidence tells
   * a 0G decision from a rehearsal brain. Stored in `decisions.provider`.
   */
  readonly provider: string
  readonly latencyMs: number
  readonly promptSha256: string
  readonly inputJson: string
  /** The router's HTTP status; null when no answer arrived (transport error, timeout). */
  readonly httpStatus: number | null
}

export type ZeroGOutcome =
  | { readonly ok: true; readonly call: ZeroGCall; readonly result: DecideToolResult }
  | {
      readonly ok: false
      readonly call: ZeroGCall
      readonly error: string
      /** At most 300 characters of what the router answered (never the request), for diagnosis. */
      readonly detail: string | null
    }

const decideCall = (completion: typeof Completion.Type) =>
  Option.fromNullishOr(completion.choices[0]?.message.tool_calls?.find((tool) => tool.function.name === 'decide'))

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
    brain: `${new URL(config.baseUrl).host}/${config.model}`,
  }
  const reply = yield* client
    .execute(
      HttpClientRequest.post(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`).pipe(
        HttpClientRequest.bearerToken(Redacted.value(config.apiKey)),
        HttpClientRequest.bodyText(bodyJson, 'application/json'),
      ),
    )
    .pipe(
      Effect.flatMap((response) =>
        Effect.map(response.text, (text) => ({
          status: response.status,
          text,
          chatId: response.headers['zg-res-key'],
        })),
      ),
      Effect.timeout(ZEROG_TIMEOUT),
      Effect.result,
    )
  const latencyMs = (yield* Clock.currentTimeMillis) - started
  return outcomeOf({ ...base, latencyMs }, reply)
})

type Reply = { readonly status: number; readonly text: string; readonly chatId: string | undefined }
const parseJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

/** Classify the router's answer; every way it can be wrong is a failure with a reason, never a guessed decision. */
const outcomeOf = (
  base: Omit<ZeroGCall, 'requestId' | 'chatId' | 'provider' | 'httpStatus'> & { readonly brain: string },
  reply: Result.Result<Reply, unknown>,
): ZeroGOutcome => {
  const { brain, ...fields } = base
  const call = (
    requestId: string | null,
    chatId: string | null,
    routedTo: string | null,
    httpStatus: number | null,
  ): ZeroGCall => ({
    ...fields,
    requestId,
    chatId,
    provider: routedTo === null ? brain : `${brain}@${routedTo}`,
    httpStatus,
  })
  if (Result.isFailure(reply))
    return { ok: false, call: call(null, null, null, null), error: errorText(reply.failure), detail: null }
  const { status, text, chatId } = reply.success
  const detail = text.slice(0, 300)
  const json = Option.getOrUndefined(parseJson(text))
  if (status < 200 || status >= 300) {
    const failed = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorBody)(json))
    return {
      ok: false,
      call: call(failed?.request_id ?? null, chatId ?? null, null, status),
      error: `0G answered ${status}`,
      detail,
    }
  }
  const completion = Schema.decodeUnknownOption(Completion)(json)
  if (Option.isNone(completion))
    return {
      ok: false,
      call: call(null, chatId ?? null, null, status),
      error: 'reply is not a chat completion',
      detail,
    }
  const trace = completion.value.x_0g_trace
  // The router puts its request id in x_0g_trace; a provider called directly only returns its TEE-signed chat id
  // (ZG-Res-Key, else the body id), which then is the per-decision request id.
  const chat = chatId ?? completion.value.id ?? null
  const logged = call(trace?.request_id ?? chat, chat, trace?.provider ?? null, status)
  const tool = decideCall(completion.value)
  if (Option.isNone(tool)) return { ok: false, call: logged, error: 'no decide tool call in the reply', detail }
  const result = decideArguments(tool.value.function.arguments)
  return Option.isSome(result)
    ? { ok: true, call: logged, result: result.value }
    : { ok: false, call: logged, error: 'decide arguments are not {action, reason}', detail }
}

const Tagged = Schema.Struct({
  _tag: Schema.String,
  reason: Schema.optionalKey(Schema.Struct({ _tag: Schema.String })),
})
const tagOf = ({ _tag }: { readonly _tag: string }) => _tag
const errorText = (error: unknown) =>
  Option.match(Schema.decodeUnknownOption(Tagged)(error), {
    onNone: () => '0G call failed',
    onSome: ({ _tag, reason }) =>
      _tag === 'TimeoutError'
        ? '0G call timed out (10 s)'
        : `0G call failed: ${reason === undefined ? _tag : `${_tag}/${tagOf(reason)}`}`,
  })

/** Optional bindings: without all three, errands answer 503 "not configured" instead of deciding. */
export const ZeroGBindings = {
  baseUrl: Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/)),
  apiKey: Schema.String.check(Schema.isMinLength(8)),
  model: Schema.String.check(Schema.isMinLength(1)),
}
