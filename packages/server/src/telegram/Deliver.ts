import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Effect, Option, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { nowSeconds } from '../Respond.ts'
import { allRows, changes, firstRow } from '../Sql.ts'
import { callBot, messageBody } from './Bot.ts'
import type { TelegramConfig } from './Config.ts'
import { outboxSignal } from './Enqueue.ts'
import { renderNotification } from './Render.ts'

// The send side of the outbox (spec §14). It runs in `ctx.waitUntil` after a response, so it never delays or fails
// the request that queued the event; a failed send is retried at a later flush, at most {@link MAX_ATTEMPTS} times.

export interface DeliverDeps {
  readonly database: QueryDatabaseClient
  readonly origin: string
  readonly config: TelegramConfig
}

const BATCH = 5
const MAX_ATTEMPTS = 5
/** A row stuck in `sending` this long (the Worker died mid-send) is offered again. */
const RECLAIM_SECONDS = 60
/** Without news in this isolate, the outbox is still swept this often, so a failed send is retried. */
const SWEEP_SECONDS = 5

const OutboxRow = Schema.Struct({
  id: Schema.String,
  account_id: Schema.String,
  kind: Schema.Literals([
    'approval_needed',
    'payment_settled',
    'approval_denied',
    'approval_expired',
    'grant_revoked',
    'funds_received',
  ]),
  subject_id: Schema.String,
  attempts: Schema.Finite,
})
type OutboxRow = typeof OutboxRow.Type
const ChatRow = Schema.Struct({ chat_id: Schema.String })

const finish = (
  database: QueryDatabaseClient,
  id: string,
  status: 'sent' | 'failed' | 'pending',
  error: string | null,
  attempts: number,
) =>
  Effect.flatMap(nowSeconds, (now) =>
    changes(
      database
        .prepare(
          `UPDATE notifications SET status = ?, last_error = ?, attempts = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END
            WHERE id = ? AND status = 'sending'`,
        )
        .bind(status, error, attempts, status, now, id),
    ),
  )

const deliverOne = Effect.fn('EthMumbai.Telegram.deliver')(function* (deps: DeliverDeps, row: OutboxRow) {
  const now = yield* nowSeconds
  const claimed = yield* changes(
    deps.database
      .prepare(
        `UPDATE notifications SET status = 'sending', claimed_at = ?
          WHERE id = ? AND (status = 'pending' OR (status = 'sending' AND claimed_at < ?))`,
      )
      .bind(now, row.id, now - RECLAIM_SECONDS),
  )
  if (claimed !== 1) return
  const chat = yield* firstRow(
    deps.database
      .prepare('SELECT chat_id FROM telegram_links WHERE account_id = ? AND chat_id IS NOT NULL')
      .bind(row.account_id),
    ChatRow,
  )
  if (Option.isNone(chat)) return yield* finish(deps.database, row.id, 'failed', 'no linked chat', row.attempts)
  const message = yield* renderNotification(deps.database, deps.origin, row)
  if (Option.isNone(message))
    return yield* finish(deps.database, row.id, 'failed', 'nothing to say any more', row.attempts)
  const outcome = yield* callBot(deps.config, 'sendMessage', messageBody(chat.value.chat_id, message.value))
  const attempts = row.attempts + 1
  if (outcome.kind === 'sent') return yield* finish(deps.database, row.id, 'sent', null, attempts)
  if (outcome.kind === 'unreachable') {
    // The owner blocked the bot (or the chat is gone): unlink, so nothing else is queued for it.
    yield* deps.database
      .prepare('UPDATE telegram_links SET chat_id = NULL, username = NULL, linked_at = NULL WHERE account_id = ?')
      .bind(row.account_id)
      .run()
    return yield* finish(deps.database, row.id, 'failed', outcome.reason, attempts)
  }
  return yield* finish(deps.database, row.id, attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', outcome.reason, attempts)
})

/**
 * Deliver the oldest pending rows (and sends stuck in `sending`, the Worker having died mid-send). An idle flush is a
 * single indexed read; it writes only to claim a row. Never fails: errors are logged and the rows stay queued.
 */
export const flushOutbox = (deps: DeliverDeps) =>
  Effect.gen(function* () {
    const now = yield* nowSeconds
    const rows = yield* allRows(
      deps.database
        .prepare(
          `SELECT id, account_id, kind, subject_id, attempts FROM notifications
            WHERE status = 'pending' OR (status = 'sending' AND claimed_at < ?)
            ORDER BY created_at LIMIT ?`,
        )
        .bind(now - RECLAIM_SECONDS, BATCH),
      OutboxRow,
    )
    yield* Effect.forEach(rows, (row) => deliverOne(deps, row), { discard: true })
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.catchCause((cause) => Effect.logWarning('telegram: flush failed').pipe(Effect.annotateLogs({ cause }))),
    Effect.withSpan('EthMumbai.Telegram.flush'),
  )

/** Per isolate: when the last sweep ran. */
const sweep = { lastAt: 0 }

/**
 * After a response: flush when this isolate queued something, or when the last sweep is older than
 * {@link SWEEP_SECONDS} (another isolate may have queued, or a send needs a retry). Otherwise it does nothing at all.
 */
export const flushIfDue = (deps: DeliverDeps) =>
  Effect.flatMap(nowSeconds, (now) => {
    if (!outboxSignal.dirty && now - sweep.lastAt < SWEEP_SECONDS) return Effect.void
    outboxSignal.dirty = false
    sweep.lastAt = now
    return flushOutbox(deps)
  })
