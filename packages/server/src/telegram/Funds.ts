import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ArcClient } from '@ethmumbai/chain/Arc'
import { APP_BASE } from '@ethmumbai/protocol/Pages'
import { Clock, Effect, Option, Schema } from 'effect'
import { allRows } from '../Sql.ts'
import { formatUsdc, readUsdcBalance } from '../wallet/Activity.ts'
import type { OutgoingMessage } from './Bot.ts'
import { enqueueNotification } from './Enqueue.ts'

// "Received 1.00 USDC" in Telegram (spec §14): the minute sweep reads the balance on Arc of every wallet with a linked
// chat and compares it with the last read it kept (`wallet_balances`); a higher balance queues `funds_received`. The
// first read only records where the wallet starts. A mirror for the message: Arc holds the money, and a payment and a
// deposit between two reads are seen as their difference.

const Watched = Schema.Struct({
  account_id: Schema.String,
  smart_account: Schema.String,
  units: Schema.NullOr(Schema.String),
})

/** `funds_received`'s subject: the account, when, and the balance before and after (the message is rendered from it). */
const subjectOf = (accountId: string, at: number, before: bigint, after: bigint) =>
  `${accountId}:${at}:${before}:${after}`

export const watchBalances = Effect.fn('EthMumbai.Telegram.watchBalances')(function* (
  database: QueryDatabaseClient,
  arc: ArcClient,
) {
  const wallets = yield* allRows(
    database.prepare(
      `SELECT t.account_id, a.smart_account, b.units FROM telegram_links t
        JOIN accounts a ON a.id = t.account_id LEFT JOIN wallet_balances b ON b.account_id = t.account_id
        WHERE t.chat_id IS NOT NULL`,
    ),
    Watched,
  )
  yield* Effect.forEach(
    wallets,
    (wallet) =>
      Effect.gen(function* () {
        const read = yield* readUsdcBalance(arc, wallet.smart_account)
        if (Option.isNone(read)) return
        const now = yield* Clock.currentTimeMillis
        yield* database
          .prepare(
            `INSERT INTO wallet_balances (account_id, units, observed_at) VALUES (?, ?, ?)
              ON CONFLICT (account_id) DO UPDATE SET units = excluded.units, observed_at = excluded.observed_at`,
          )
          .bind(wallet.account_id, read.value.toString(), now)
          .run()
        if (wallet.units === null || read.value <= BigInt(wallet.units)) return
        yield* enqueueNotification(database, {
          accountId: wallet.account_id,
          kind: 'funds_received',
          subjectId: subjectOf(wallet.account_id, now, BigInt(wallet.units), read.value),
        })
      }),
    { concurrency: 4, discard: true },
  )
})

/** "💰 Received 1.00 USDC. Your wallet now has 1.40 USDC." with the wallet's link; none for a malformed subject. */
export const fundsReceived = (origin: string, subjectId: string): Option.Option<OutgoingMessage> => {
  const [, , before, after] = subjectId.split(':')
  if (before === undefined || after === undefined || !/^\d+$/.test(before) || !/^\d+$/.test(after)) return Option.none()
  const received = BigInt(after) - BigInt(before)
  return Option.some({
    text: [
      `💰 Received <b>${formatUsdc(received)} USDC</b>.`,
      `Your wallet now has ${formatUsdc(BigInt(after))} USDC.`,
    ].join('\n'),
    buttons: [[{ text: 'Open wallet', url: `${new URL(origin).origin}${APP_BASE}/wallet` }]],
  })
}
