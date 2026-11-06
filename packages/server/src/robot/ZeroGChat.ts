import { Clock, Duration, Effect, Option, Result, Schema } from 'effect'
import { postChat, type Reply, type ZeroGCall, type ZeroGConfig } from './ZeroGClient.ts'
import { sha256Hex } from '../Respond.ts'

// One chat completion against the 0G router for callers other than `decide` (the simulator's navigation turns, the
// voice route): the same bindings, bearer key, `ZG-Res-Key` chat id and `x_0g_trace` as `decide`, with the caller's
// messages and tools. It never fails: every way the call can go wrong is an `ok: false` outcome with a reason that
// names the failure, never the prompt or the reply's text.

/** What a chat call records: `decide`'s fields without its decision input. */
export type ZeroGChatCall = Omit<ZeroGCall, 'inputJson'>

export type ZeroGChatOutcome =
  | { readonly ok: true; readonly call: ZeroGChatCall; readonly message: unknown }
  | { readonly ok: false; readonly call: ZeroGChatCall; readonly error: string }

/** The columns every stored 0G call has (`decisions`, `nav_turns`): step, ids, brain, latency and the prompt's hash. */
export const zeroGCallColumns = {
  step: Schema.Finite,
  model: Schema.String,
  request_id: Schema.NullOr(Schema.String),
  chat_id: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  latency_ms: Schema.NullOr(Schema.Finite),
  prompt_sha256: Schema.String,
}

export interface ZeroGChatOptions {
  readonly timeout: Duration.Input
  /** A `429` (the provider's `model_overloaded`) is retried once after this pause; absent = no retry. */
  readonly retry429After?: Duration.Input
}

const Trace = Schema.Struct({
  request_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  provider: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
const Completion = Schema.Struct({
  id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  choices: Schema.Array(Schema.Struct({ message: Schema.Unknown })),
  x_0g_trace: Schema.optionalKey(Schema.NullOr(Trace)),
})
const ErrorBody = Schema.Struct({ request_id: Schema.optionalKey(Schema.NullOr(Schema.String)) })
const parseJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const Tagged = Schema.Struct({ _tag: Schema.String })

/**
 * `POST {ZG_BASE_URL}/chat/completions` with `body` (the caller's messages, tools and knobs; `ZG_EXTRA_JSON` goes
 * under it and `model` always wins). The prompt is hashed for the record and never logged.
 */
export const zeroGChat = Effect.fn('EthMumbai.Robot.zeroGChat')(function* (
  config: ZeroGConfig,
  body: Readonly<Record<string, unknown>>,
  options: ZeroGChatOptions,
) {
  const bodyJson = JSON.stringify({ ...config.extraBody, ...body, model: config.model })
  const brain = `${new URL(config.baseUrl).host}/${config.model}`
  const promptSha256 = yield* sha256Hex(bodyJson)
  const started = yield* Clock.currentTimeMillis
  const first = yield* postChat(config, bodyJson, options.timeout)
  const retry =
    options.retry429After !== undefined && Result.isSuccess(first) && first.success.status === 429
      ? Option.some(options.retry429After)
      : Option.none()
  const reply = Option.isSome(retry)
    ? yield* Effect.andThen(Effect.sleep(retry.value), postChat(config, bodyJson, options.timeout))
    : first
  const latencyMs = (yield* Clock.currentTimeMillis) - started
  const call = (
    requestId: string | null,
    chatId: string | null,
    routedTo: string | null,
    httpStatus: number | null,
  ): ZeroGChatCall => ({
    model: config.model,
    requestId,
    chatId,
    provider: routedTo === null ? brain : `${brain}@${routedTo}`,
    routedTo,
    latencyMs,
    promptSha256,
    httpStatus,
  })
  const outcome = outcomeOf(reply, call, options.timeout)
  if (!outcome.ok) yield* Effect.logWarning(`0G chat failed: ${outcome.error}`).pipe(Effect.annotateLogs({ brain }))
  return outcome
})

const outcomeOf = (
  reply: Result.Result<Reply, unknown>,
  call: (
    requestId: string | null,
    chatId: string | null,
    routedTo: string | null,
    httpStatus: number | null,
  ) => ZeroGChatCall,
  timeout: Duration.Input,
): ZeroGChatOutcome => {
  if (Result.isFailure(reply)) {
    const tag = Option.match(Schema.decodeUnknownOption(Tagged)(reply.failure), {
      onNone: () => 'unknown',
      onSome: ({ _tag }) => _tag,
    })
    const error =
      tag === 'TimeoutError' ? `0G call timed out (${Duration.toSeconds(timeout)} s)` : `0G call failed: ${tag}`
    return { ok: false, call: call(null, null, null, null), error }
  }
  const { status, text, chatId } = reply.success
  const json = Option.getOrUndefined(parseJson(text))
  if (status < 200 || status >= 300) {
    const failed = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorBody)(json))
    return {
      ok: false,
      call: call(failed?.request_id ?? null, chatId ?? null, null, status),
      error: `0G answered ${status}`,
    }
  }
  const completion = Schema.decodeUnknownOption(Completion)(json)
  if (Option.isNone(completion))
    return { ok: false, call: call(null, chatId ?? null, null, status), error: 'reply is not a chat completion' }
  const trace = completion.value.x_0g_trace
  const chat = chatId ?? completion.value.id ?? null
  const logged = call(trace?.request_id ?? chat, chat, trace?.provider ?? null, status)
  const message = completion.value.choices[0]?.message
  return message === undefined
    ? { ok: false, call: logged, error: 'reply has no choices' }
    : { ok: true, call: logged, message }
}
