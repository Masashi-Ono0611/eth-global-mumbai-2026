import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { generateId } from '@ethmumbai/protocol/Base32'
import { Clock, Effect } from 'effect'
import { changes } from '../Sql.ts'

/**
 * The write side of Telegram notifications (spec §14), called by each event's own writer: one `notifications` row,
 * and only for an owner with a linked chat. It never fails its caller (a payment or an approval): any error is logged
 * and swallowed. Sending happens after the response (Deliver.ts).
 */
export type NotificationKind =
  | 'approval_needed'
  | 'payment_settled'
  | 'approval_denied'
  | 'approval_expired'
  | 'grant_revoked'
  | 'funds_received'

/** Rows written in this isolate since the last flush: the flush after the response runs only when there is news. */
export const outboxSignal = { dirty: false }

export const enqueueNotification = (
  database: QueryDatabaseClient,
  input: { readonly accountId: string | null; readonly kind: NotificationKind; readonly subjectId: string | null },
) =>
  Effect.gen(function* () {
    const { accountId, kind, subjectId } = input
    if (accountId === null || subjectId === null) return
    const id = yield* generateId
    const inserted = yield* changes(
      database
        .prepare(
          `INSERT INTO notifications (id, account_id, kind, subject_id, status, attempts, created_at)
            SELECT ?, ?, ?, ?, 'pending', 0, ?
            WHERE EXISTS (SELECT 1 FROM telegram_links WHERE account_id = ? AND chat_id IS NOT NULL)
            ON CONFLICT (kind, subject_id) DO NOTHING`,
        )
        .bind(id, accountId, kind, subjectId, yield* Clock.currentTimeMillis, accountId),
    )
    if (inserted === 1) outboxSignal.dirty = true
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning('telegram: could not queue a notification').pipe(
        Effect.annotateLogs({ kind: input.kind, cause }),
      ),
    ),
    Effect.withSpan('EthMumbai.Telegram.enqueue'),
  )

/** The errand outcomes the owner hears about: paid, denied, and an approval nobody answered in time. */
export const enqueueEpisodeOutcome = (
  database: QueryDatabaseClient,
  episode: { readonly id: string; readonly account_id: string | null; readonly state: string },
  from: string,
) => {
  const kind: NotificationKind | null =
    episode.state === 'paid'
      ? 'payment_settled'
      : episode.state === 'denied'
        ? 'approval_denied'
        : episode.state === 'expired' && from === 'awaiting_approval'
          ? 'approval_expired'
          : null
  return kind === null
    ? Effect.void
    : enqueueNotification(database, { accountId: episode.account_id, kind, subjectId: episode.id })
}
