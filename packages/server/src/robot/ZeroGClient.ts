import { DecideInput, DecideToolResult } from '@ethmumbai/protocol/Errand'
import { Clock, Effect, Option, Redacted, Result, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { parseDecision, ReplyMessage } from './DecideReply.ts'
import { sha256Hex } from '../Respond.ts'

/** `ZG_BASE_URL`, `ZG_API_KEY`, `ZG_MODEL`: the 0G router (OpenAI-compatible, `…/v1`). */
export interface ZeroGConfig {
  readonly baseUrl: string
  readonly apiKey: Redacted.Redacted
  readonly model: string
  /** `ZG_EXTRA_JSON`: per-model request fields (e.g. `{"chat_template_kwargs":{"enable_thinking":false}}`). */
  readonly extraBody?: Readonly<Record<string, unknown>>
}

export const ZEROG_TIMEOUT = '10 seconds'

/**
 * Spec §6's prompt with the approval rule spelled out (6 Nov): a restricted or over-limit item the owner asked for goes
 * to the owner (`ask_human` → World approval), it is not dropped (`walk_away`).
 */
export const APPROVAL_RULE =
  'Never pay when approvalRequired is true. When approvalRequired is true and the owner asked for this item, answer ask_human so the owner can approve it in World App; answer walk_away only when the item is not what the owner asked for, the price is wrong, or the merchant is unknown.'

/** The rule as a table first (models read "over the cap" as "unpayable" from prose alone), then one example per row. */
const SYSTEM_PROMPT = [
  'You are the purchasing brain of a robot with a USDC budget. Decide only with the decide tool: call it once with {"action": "pay" | "ask_human" | "walk_away", "reason": one short sentence}.',
  'Decision table, apply the first row that matches:',
  '1. The item, the price or the merchant does not match (requested differs from catalogue.itemId, invoice.amount differs from catalogue.amount, or merchant.trust is untrusted) → walk_away.',
  "2. policy.approvalRequired=true and the item is what the owner asked for → ask_human. The per-payment cap and the allowlist never justify walk_away: the owner's approval in World App lifts them (see the approval field).",
  '3. policy.approvalRequired=false and invoice.amount is within budget.remainingToday → pay.',
  '4. Otherwise → walk_away.',
  'Examples:',
  '- requested chai, catalogue chai 100000, invoice 100000, approvalRequired false, remainingToday 1000000 → {"action":"pay","reason":"Chai as asked, within budget."}',
  '- requested cigarettes, catalogue cigarettes 500000 restricted, invoice 500000, approvalRequired true → {"action":"ask_human","reason":"Restricted item the owner asked for; the owner approves it in World App."}',
  '- requested chai, catalogue samosa → {"action":"walk_away","reason":"Not the item the owner asked for."}',
  APPROVAL_RULE,
].join('\n')

/** When approval is required the input says so as structure, not only as a flag the model may read as a refusal. */
export const promptInput = (input: DecideInput) =>
  input.policy.approvalRequired
    ? { ...input, approval: { required: true, canBeGrantedBy: 'the owner in World App', capsDoNotBlock: true } }
    : input

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
export const decideRequestBody = (
  model: string,
  input: DecideInput,
  extraBody: Readonly<Record<string, unknown>> = {},
) => ({
  // Model-specific extras first: the spec's fields below always win over them.
  ...extraBody,
  model,
  temperature: 0,
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(promptInput(input)) },
  ],
  tools: [DECIDE_TOOL],
  tool_choice: { type: 'function', function: { name: 'decide' } },
})

const Trace = Schema.Struct({
  request_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  provider: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
const Completion = Schema.Struct({
  id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  model: Schema.optionalKey(Schema.NullOr(Schema.String)),
  choices: Schema.Array(Schema.Struct({ message: ReplyMessage })),
  x_0g_trace: Schema.optionalKey(Schema.NullOr(Trace)),
})
/** Error bodies carry a top-level `request_id`. */
const ErrorBody = Schema.Struct({ request_id: Schema.optionalKey(Schema.NullOr(Schema.String)) })

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
  /** The 0G provider address the router routed to (`x_0g_trace.provider`), for its TEE proof; null otherwise. */
  readonly routedTo: string | null
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

/**
 * One 0G decision. It never fails: a transport error, a non-2xx, a timeout (10 s) or arguments that do not decode are
 * an `ok: false` outcome, which the errand turns into `safe_stop` (never a local fallback decision).
 */
export const decide = Effect.fn('EthMumbai.Robot.decide')(function* (config: ZeroGConfig, input: DecideInput) {
  const client = yield* HttpClient.HttpClient
  const body = decideRequestBody(config.model, input, config.extraBody)
  const bodyJson = JSON.stringify(body)
  const started = yield* Clock.currentTimeMillis
  const base = {
    model: config.model,
    promptSha256: yield* sha256Hex(bodyJson),
    inputJson: JSON.stringify(promptInput(input)),
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
  const outcome = outcomeOf({ ...base, latencyMs }, reply)
  // The reason names the reply's shape (tool calls, text length), never its text or the prompt.
  if (!outcome.ok)
    yield* Effect.logWarning(`0G decide failed: ${outcome.error}`).pipe(Effect.annotateLogs({ brain: base.brain }))
  return outcome
})

type Reply = { readonly status: number; readonly text: string; readonly chatId: string | undefined }
const parseJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

/** Classify the router's answer; every way it can be wrong is a failure with a reason, never a guessed decision. */
const outcomeOf = (
  base: Omit<ZeroGCall, 'requestId' | 'chatId' | 'provider' | 'routedTo' | 'httpStatus'> & { readonly brain: string },
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
    routedTo,
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
  const message = completion.value.choices[0]?.message
  const parsed = message === undefined ? { ok: false as const, error: 'reply has no choices' } : parseDecision(message)
  return parsed.ok
    ? { ok: true, call: logged, result: parsed.result }
    : { ok: false, call: logged, error: parsed.error, detail }
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

/** `ZG_EXTRA_JSON` / `APP_ZG_EXTRA_JSON`: a JSON object of extra request fields, merged under the spec's fields. */
export const ZeroGExtraBody = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))

/** Optional bindings: without all three, errands answer 503 "not configured" instead of deciding. */
export const ZeroGBindings = {
  baseUrl: Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/)),
  apiKey: Schema.String.check(Schema.isMinLength(8)),
  model: Schema.String.check(Schema.isMinLength(1)),
}
