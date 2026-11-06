import { Duration, Effect, Option, Redacted, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import type { TelegramConfig } from './Config.ts'

/** Telegram's Bot API answer for one call. A call never fails: transport errors and timeouts are `retry`. */
export interface BotOutcome {
  /**
   * `sent`; `unreachable` when the chat is gone for this bot (blocked, deleted, never started), so stop sending to it;
   * `retry` on a rate limit, a 5xx, a timeout or no answer.
   */
  readonly kind: 'sent' | 'unreachable' | 'retry'
  readonly reason: string | null
}

const BOT_TIMEOUT = Duration.seconds(8)
const Answer = Schema.Struct({ ok: Schema.Boolean, description: Schema.optional(Schema.String) })
const parseAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(Answer))

/** One inline button: a link, or a callback the webhook receives (`deny:<approvalId>`). */
export type Button =
  | { readonly text: string; readonly url: string }
  | { readonly text: string; readonly callback_data: string }

export interface OutgoingMessage {
  readonly text: string
  readonly buttons: ReadonlyArray<ReadonlyArray<Button>>
}

/** The message body Telegram expects; HTML parse mode, so every interpolated value must go through `escapeHtml`. */
export const messageBody = (chatId: string, message: OutgoingMessage) => ({
  chat_id: chatId,
  text: message.text,
  parse_mode: 'HTML',
  link_preview_options: { is_disabled: true },
  ...(message.buttons.length === 0 ? {} : { reply_markup: { inline_keyboard: message.buttons } }),
})

const classify = (status: number, text: string): BotOutcome => {
  const reason = Option.match(parseAnswer(text), {
    onNone: () => `HTTP ${status}`,
    onSome: (answer) => answer.description ?? `HTTP ${status}`,
  })
  if (status >= 200 && status < 300) return { kind: 'sent', reason: null }
  // 403: the owner blocked the bot; 400 "chat not found": the chat id no longer reaches anyone.
  if (status === 403 || (status === 400 && /chat not found|user is deactivated/i.test(reason)))
    return { kind: 'unreachable', reason }
  return { kind: 'retry', reason }
}

/** One Bot API call (`sendMessage`, `editMessageText`, …). The token is only in the URL, never in a log or a reason. */
export const callBot = Effect.fn('EthMumbai.Telegram.call')(function* (
  config: TelegramConfig,
  method: string,
  body: Readonly<Record<string, unknown>>,
) {
  const client = yield* HttpClient.HttpClient
  const reply = yield* client
    .execute(
      HttpClientRequest.post(`${config.apiBase}/bot${Redacted.value(config.token)}/${method}`).pipe(
        HttpClientRequest.bodyText(JSON.stringify(body), 'application/json'),
      ),
    )
    .pipe(
      Effect.flatMap((response) => Effect.map(response.text, (text) => classify(response.status, text))),
      Effect.timeout(BOT_TIMEOUT),
      Effect.orElseSucceed((): BotOutcome => ({ kind: 'retry', reason: `no answer from Telegram (${method})` })),
    )
  return reply
})

export const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
