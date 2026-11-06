import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Effect, Option, Schema } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'
import * as HttpRouter from 'effect/http/HttpRouter'
import { CurrentSession, requireSession } from '../auth/Session.ts'
import { json, notConfigured, nowSeconds, randomBytes, sha256Hex } from '../Respond.ts'
import { firstRow } from '../Sql.ts'
import { BOT_USERNAME, type TelegramConfig } from './Config.ts'

// Linking an owner's Telegram chat (spec §14): the wallet asks for a one-time code and opens the bot with it; the bot's
// webhook consumes the code on `/start <code>` (Webhook.ts). Only the code's sha256 is stored.

/** How long a link code may wait for its `/start`. */
export const LINK_CODE_SECONDS = 600

const LinkState = Schema.Struct({ chat_id: Schema.NullOr(Schema.String), username: Schema.NullOr(Schema.String) })

/** `POST /api/telegram/link` → `{ url, expiresAt }`: a fresh code replaces any older unused one. */
const createLink = (database: QueryDatabaseClient, config: Option.Option<TelegramConfig>) =>
  Effect.gen(function* () {
    if (Option.isNone(config)) return yield* notConfigured('TELEGRAM_BOT_TOKEN')
    const { accountId } = yield* CurrentSession
    // 24 random bytes: 32 base64url characters, within Telegram's 64-character `start` parameter.
    const code = Base64Url.encode(yield* randomBytes(24))
    const expiresAt = (yield* nowSeconds) + LINK_CODE_SECONDS
    yield* database
      .prepare(
        `INSERT INTO telegram_links (account_id, code_hash, code_expires_at) VALUES (?, ?, ?)
          ON CONFLICT (account_id) DO UPDATE SET code_hash = excluded.code_hash, code_expires_at = excluded.code_expires_at`,
      )
      .bind(accountId, yield* sha256Hex(code), expiresAt)
      .run()
    return yield* json({ url: `https://t.me/${BOT_USERNAME}?start=${code}`, expiresAt })
  })

/** `GET /api/telegram` → `{ configured, linked, username }` for the wallet's Telegram row. */
const linkStatus = (database: QueryDatabaseClient, config: Option.Option<TelegramConfig>) =>
  Effect.gen(function* () {
    const { accountId } = yield* CurrentSession
    const row = yield* firstRow(
      database.prepare('SELECT chat_id, username FROM telegram_links WHERE account_id = ?').bind(accountId),
      LinkState,
    )
    const linked = Option.exists(row, (link) => link.chat_id !== null)
    const username = Option.getOrNull(Option.flatMap(row, (link) => Option.fromNullishOr(link.username)))
    return yield* json({ configured: Option.isSome(config), linked, username: linked ? username : null })
  })

/** `POST /api/telegram/unlink`: forget the chat (the bot's `/stop` does the same from Telegram's side). */
const unlink = (database: QueryDatabaseClient) =>
  Effect.gen(function* () {
    const { accountId } = yield* CurrentSession
    yield* database
      .prepare(
        'UPDATE telegram_links SET chat_id = NULL, username = NULL, linked_at = NULL, code_hash = NULL WHERE account_id = ?',
      )
      .bind(accountId)
      .run()
    return yield* json({ linked: false })
  })

export const linkRoutes = (database: QueryDatabaseClient, config: Option.Option<TelegramConfig>) =>
  HttpRouter.addAll([
    HttpRouter.route('POST', '/api/telegram/link', requireSession(createLink(database, config))),
    HttpRouter.route('GET', '/api/telegram', requireSession(linkStatus(database, config))),
    HttpRouter.route('POST', '/api/telegram/unlink', requireSession(unlink(database))),
  ])
