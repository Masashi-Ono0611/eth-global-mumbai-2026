import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Effect, Option, Redacted, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import { json, jsonError, notConfigured, nowSeconds, sha256Hex } from '../Respond.ts'
import { firstRow } from '../Sql.ts'
import { expireIfLate, readApproval } from '../world/Approve.ts'
import { denyApproval, type WorldDeps } from '../world/Authorize.ts'
import { callBot } from './Bot.ts'
import type { TelegramConfig } from './Config.ts'

// `POST /api/telegram/webhook` (spec §14): Telegram's updates for @vitaquack_bot. Only requests carrying the
// `secret_token` set by scripts/telegram-set-webhook.ts are read. Text replies go back in the webhook response itself
// (Telegram executes a `method` body), so a chat answer costs no extra call. Telegram may deny, never approve.

export interface WebhookDeps {
  readonly database: QueryDatabaseClient
  readonly config: Option.Option<TelegramConfig>
  /** The approval deny path shared with the wallet (world/Authorize.ts). */
  readonly world: Pick<WorldDeps, 'database' | 'errands'>
}

const Chat = Schema.Struct({ id: Schema.Finite })
const Update = Schema.Struct({
  message: Schema.optionalKey(
    Schema.Struct({
      chat: Chat,
      from: Schema.optionalKey(Schema.Struct({ username: Schema.optionalKey(Schema.String) })),
      text: Schema.optionalKey(Schema.String),
    }),
  ),
  callback_query: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      data: Schema.optionalKey(Schema.String),
      message: Schema.optionalKey(Schema.Struct({ chat: Chat, message_id: Schema.Finite })),
    }),
  ),
})
type Update = typeof Update.Type

const HELP =
  "🦆 I'm the Vitaquack robot. I tell you when I want to buy something that needs your OK, and when I've paid.\n" +
  'To connect, open your wallet → your avatar → Connect Telegram. Send /stop to disconnect.'

/** Digests of both sides compared over their full length, so the secret never leaks through timing. */
const secretMatches = (given: string, expected: string) =>
  Effect.map(Effect.all([sha256Hex(given), sha256Hex(expected)]), ([left, right]) => {
    let mismatch = 0
    for (let index = 0; index < left.length; index++) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
    return mismatch === 0
  })

const reply = (chatId: number, text: string) => json({ method: 'sendMessage', chat_id: chatId, text })

/** `/start <code>`: the wallet's one-time code links this chat to its account (unexpired, single use). */
const start = Effect.fn('EthMumbai.Telegram.start')(function* (
  database: QueryDatabaseClient,
  chatId: number,
  username: string | null,
  code: string,
) {
  const now = yield* nowSeconds
  const linked = yield* database
    .prepare(
      `UPDATE telegram_links SET chat_id = ?, username = ?, linked_at = ?, code_hash = NULL, code_expires_at = NULL
        WHERE code_hash = ? AND code_expires_at >= ?`,
    )
    .bind(String(chatId), username, now, yield* sha256Hex(code), now)
    .run()
  return linked.meta.changes === 1
    ? "🦆 Connected! I'll message you here when I want to buy something that needs your OK, and when I've paid."
    : 'That link has expired or was already used. Open your wallet → your avatar → Connect Telegram to get a new one.'
})

const ApprovalOwner = Schema.Struct({ ok: Schema.Finite })

/** A Deny tap: only from the chat linked to the approval's owner, only while it waits; a second tap changes nothing. */
const deny = Effect.fn('EthMumbai.Telegram.deny')(function* (deps: WebhookDeps, chatId: number, approvalId: string) {
  const found = yield* readApproval(deps.database, approvalId)
  if (Option.isNone(found)) return 'That approval no longer exists.'
  const owner = yield* firstRow(
    deps.database
      .prepare('SELECT 1 AS ok FROM telegram_links WHERE account_id = ? AND chat_id = ?')
      .bind(found.value.account_id, String(chatId)),
    ApprovalOwner,
  )
  if (Option.isNone(owner)) return 'This approval is not yours.'
  const row = yield* expireIfLate(deps.database, found.value)
  if (row.status !== 'requested' && row.status !== 'opened') return `Already decided (${row.status}).`
  const denied = yield* denyApproval(deps.world, row, 'denied by the owner in Telegram')
  return denied ? 'Denied. I will not buy it.' : 'Already decided.'
})

const handleCallback = Effect.fn('EthMumbai.Telegram.callback')(function* (
  deps: WebhookDeps,
  config: TelegramConfig,
  callback: NonNullable<Update['callback_query']>,
) {
  const approvalId = /^deny:([a-z0-9]{1,64})$/.exec(callback.data ?? '')?.[1]
  const chat = callback.message
  if (approvalId === undefined || chat === undefined)
    return yield* json({ method: 'answerCallbackQuery', callback_query_id: callback.id })
  const answer = yield* deny(deps, chat.chat.id, approvalId)
  if (answer.startsWith('Denied')) {
    // Replace the buttons, so the message shows the decision instead of an offer.
    yield* callBot(config, 'editMessageReplyMarkup', {
      chat_id: chat.chat.id,
      message_id: chat.message_id,
      reply_markup: { inline_keyboard: [[{ text: '⛔ Denied', callback_data: 'noop' }]] },
    }).pipe(Effect.provide(FetchHttpClient.layer))
  }
  return yield* json({ method: 'answerCallbackQuery', callback_query_id: callback.id, text: answer })
})

const handleMessage = Effect.fn('EthMumbai.Telegram.message')(function* (
  database: QueryDatabaseClient,
  message: NonNullable<Update['message']>,
) {
  const text = (message.text ?? '').trim()
  const code = /^\/start\s+([A-Za-z0-9_-]{16,64})$/.exec(text)?.[1]
  if (code !== undefined)
    return yield* reply(message.chat.id, yield* start(database, message.chat.id, message.from?.username ?? null, code))
  if (text === '/stop') {
    yield* database
      .prepare('UPDATE telegram_links SET chat_id = NULL, username = NULL, linked_at = NULL WHERE chat_id = ?')
      .bind(String(message.chat.id))
      .run()
    return yield* reply(message.chat.id, "Disconnected. I won't message you any more. Connect again from your wallet.")
  }
  return yield* reply(message.chat.id, HELP)
})

const webhook = (deps: WebhookDeps) =>
  Effect.gen(function* () {
    if (Option.isNone(deps.config)) return yield* notConfigured('TELEGRAM_BOT_TOKEN')
    const config = deps.config.value
    const request = yield* HttpServerRequest.HttpServerRequest
    const given = request.headers['x-telegram-bot-api-secret-token'] ?? ''
    if (!(yield* secretMatches(given, Redacted.value(config.webhookSecret)))) return yield* jsonError(403, 'bad secret')
    const update = yield* HttpServerRequest.schemaBodyJson(Update).pipe(Effect.option)
    // Anything we do not understand is acknowledged, so Telegram does not keep redelivering it.
    if (Option.isNone(update)) return yield* json({ ok: true })
    if (update.value.callback_query !== undefined)
      return yield* handleCallback(deps, config, update.value.callback_query)
    if (update.value.message !== undefined) return yield* handleMessage(deps.database, update.value.message)
    return yield* json({ ok: true })
  })

export const webhookRoute = (deps: WebhookDeps) => HttpRouter.add('POST', '/api/telegram/webhook', webhook(deps))
