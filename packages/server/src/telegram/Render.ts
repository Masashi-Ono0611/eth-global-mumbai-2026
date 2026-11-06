import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { APP_BASE, approvalPagePath } from '@ethmumbai/protocol/Pages'
import { Effect, Option, Schema } from 'effect'
import { findItem, findMerchant } from '../merchant/Catalogue.ts'
import { nowSeconds } from '../Respond.ts'
import { latestSignedGrant, spentInPeriod } from '../robot/Budget.ts'
import { firstRow } from '../Sql.ts'
import { formatUsdc } from '../wallet/Activity.ts'
import { type Button, escapeHtml, type OutgoingMessage } from './Bot.ts'
import type { NotificationKind } from './Enqueue.ts'
import { fundsReceived } from './Funds.ts'
import { approvalLinkPath, mintApprovalLink } from '../world/Link.ts'

// The robot's voice in Telegram (spec §14): built from D1 at send time, so a hook only records which event happened.
// Messages carry amounts, item names and links only; never a key, a token or an address the owner did not see.

/** Under this share of the daily cap left, the paid message adds a warning (Kris: a line, not its own event). */
const LOW_BUDGET_PERCENT = 20n
const TX_HASH = /^0x[0-9a-fA-F]{64}$/

const usdc = (amount: string | null) => (amount === null ? '' : `${formatUsdc(BigInt(amount))} USDC`)

/** Catalogue names for an invoice's merchant and item, falling back to the raw ids. */
const names = (merchantId: string | null, itemId: string | null) => {
  const merchant = findMerchant(merchantId ?? '')
  const item = Option.flatMap(merchant, (found) => findItem(found, itemId ?? ''))
  return {
    merchant: Option.match(merchant, { onNone: () => merchantId ?? 'the shop', onSome: (found) => found.name }),
    item: Option.match(item, { onNone: () => itemId ?? 'it', onSome: (found) => found.name }),
  }
}

const header = (robot: string | null) => `🦆 <b>${escapeHtml(robot ?? 'Your robot')}</b>`

const ApprovalFacts = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  amount: Schema.NullOr(Schema.String),
  payee: Schema.NullOr(Schema.String),
  robot_id: Schema.NullOr(Schema.String),
  robot: Schema.NullOr(Schema.String),
  merchant_id: Schema.NullOr(Schema.String),
  item_id: Schema.NullOr(Schema.String),
  restricted: Schema.NullOr(Schema.Finite),
})

/** Why the owner is asked, in the words the approval page uses: over the per-payment cap, or a shop not on the list. */
const approvalReason = (
  facts: typeof ApprovalFacts.Type,
  grant: Option.Option<{ readonly perPaymentCap: bigint; readonly allowlist: ReadonlyArray<string> }>,
) =>
  Option.match(grant, {
    onNone: () => 'It needs your OK.',
    onSome: ({ perPaymentCap, allowlist }) => {
      if (facts.amount !== null && BigInt(facts.amount) > perPaymentCap)
        return `That's over your ${formatUsdc(perPaymentCap)} per-payment limit.`
      if (facts.payee !== null && !allowlist.some((payee) => payee.toLowerCase() === facts.payee?.toLowerCase()))
        return "That shop isn't on my list."
      return facts.restricted === 1 ? "It's a restricted item." : 'It needs your OK.'
    },
  })

const approvalNeeded = Effect.fn('EthMumbai.Telegram.renderApproval')(function* (
  database: QueryDatabaseClient,
  origin: string,
  approvalId: string,
) {
  const found = yield* firstRow(
    database
      .prepare(
        `SELECT a.id, a.status, a.amount, a.payee, a.robot_id, r.name AS robot, i.merchant_id, i.item_id, i.restricted
          FROM approvals a LEFT JOIN invoices i ON i.id = a.invoice_id LEFT JOIN robots r ON r.id = a.robot_id
          WHERE a.id = ?`,
      )
      .bind(approvalId),
    ApprovalFacts,
  )
  // Already answered (the owner was faster than the message): nothing to ask any more.
  if (Option.isNone(found) || !['requested', 'opened'].includes(found.value.status))
    return Option.none<OutgoingMessage>()
  const facts = found.value
  const grant = facts.robot_id === null ? Option.none() : yield* latestSignedGrant(database, facts.robot_id)
  const { merchant, item } = names(facts.merchant_id, facts.item_id)
  // With a World account bound, one tap goes straight to World ID (a one-time link that replaces the passkey sign-in
  // for this approval only, world/Link.ts); before that, the approval page as always.
  const link = yield* mintApprovalLink(database, facts.id)
  const buttons: ReadonlyArray<ReadonlyArray<Button>> = [
    [
      Option.match(link, {
        onNone: () => ({ text: 'Review and approve', url: `${new URL(origin).origin}${approvalPagePath(facts.id)}` }),
        onSome: (token) => ({
          text: 'Approve with World ID',
          url: `${new URL(origin).origin}${approvalLinkPath(facts.id, token)}`,
        }),
      }),
    ],
    [{ text: 'Deny', callback_data: `deny:${facts.id}` }],
  ]
  return Option.some<OutgoingMessage>({
    text: [
      header(facts.robot),
      `I want to buy <b>${escapeHtml(item)}, ${usdc(facts.amount)}</b> at ${escapeHtml(merchant)}.`,
      escapeHtml(approvalReason(facts, grant)),
      'Approve with World ID, or deny it here.',
    ].join('\n'),
    buttons,
  })
})

const EpisodeFacts = Schema.Struct({
  state: Schema.String,
  result: Schema.NullOr(Schema.String),
  robot_id: Schema.NullOr(Schema.String),
  robot: Schema.NullOr(Schema.String),
  episode_item: Schema.NullOr(Schema.String),
  amount: Schema.NullOr(Schema.String),
  merchant_id: Schema.NullOr(Schema.String),
  item_id: Schema.NullOr(Schema.String),
})

const episodeFacts = (database: QueryDatabaseClient, episodeId: string) =>
  firstRow(
    database
      .prepare(
        `SELECT e.state, e.result, e.robot_id, r.name AS robot, e.item AS episode_item, i.amount, i.merchant_id, i.item_id
          FROM episodes e LEFT JOIN invoices i ON i.id = e.invoice_id LEFT JOIN robots r ON r.id = e.robot_id
          WHERE e.id = ?`,
      )
      .bind(episodeId),
    EpisodeFacts,
  )

/** "Today: 2.60 of 3.00 USDC left", with a warning under {@link LOW_BUDGET_PERCENT}; empty without a signed grant. */
const budgetLine = Effect.fn('EthMumbai.Telegram.budgetLine')(function* (
  database: QueryDatabaseClient,
  robotId: string | null,
) {
  if (robotId === null) return ''
  const grant = yield* latestSignedGrant(database, robotId)
  if (Option.isNone(grant)) return ''
  const spent = yield* spentInPeriod(database, grant.value, yield* nowSeconds)
  const cap = grant.value.dailyCap
  const left = spent >= cap ? 0n : cap - spent
  const line = `Today: ${formatUsdc(left)} of ${formatUsdc(cap)} USDC left.`
  return left * 100n < cap * LOW_BUDGET_PERCENT ? `⚠️ ${line} Budget almost used up.` : line
})

const episodeMessage = Effect.fn('EthMumbai.Telegram.renderEpisode')(function* (
  database: QueryDatabaseClient,
  kind: Exclude<NotificationKind, 'approval_needed' | 'grant_revoked'>,
  episodeId: string,
) {
  const found = yield* episodeFacts(database, episodeId)
  if (Option.isNone(found)) return Option.none<OutgoingMessage>()
  const facts = found.value
  const { merchant, item } = names(facts.merchant_id, facts.item_id ?? facts.episode_item)
  if (kind === 'payment_settled') {
    const tx = facts.result !== null && TX_HASH.test(facts.result) ? facts.result : null
    const budget = yield* budgetLine(database, facts.robot_id)
    return Option.some<OutgoingMessage>({
      text: [
        header(facts.robot),
        `✅ Paid <b>${usdc(facts.amount)}</b> for ${escapeHtml(item)} at ${escapeHtml(merchant)}.`,
        ...(budget === '' ? [] : [budget]),
      ].join('\n'),
      buttons: tx === null ? [] : [[{ text: 'View on Arc', url: `https://explorer.arc.io/tx/${tx}` }]],
    })
  }
  const text =
    kind === 'approval_denied'
      ? `⛔ Okay, I didn't buy the ${escapeHtml(item)}.`
      : `⌛ No answer in 5 minutes, so I didn't buy the ${escapeHtml(item)}.`
  return Option.some<OutgoingMessage>({ text: [header(facts.robot), text].join('\n'), buttons: [] })
})

const GrantFacts = Schema.Struct({ robot: Schema.NullOr(Schema.String) })

const grantRevoked = Effect.fn('EthMumbai.Telegram.renderRevoke')(function* (
  database: QueryDatabaseClient,
  origin: string,
  grantId: string,
) {
  const found = yield* firstRow(
    database
      .prepare('SELECT r.name AS robot FROM grants g LEFT JOIN robots r ON r.id = g.robot_id WHERE g.id = ?')
      .bind(grantId),
    GrantFacts,
  )
  if (Option.isNone(found)) return Option.none<OutgoingMessage>()
  return Option.some<OutgoingMessage>({
    text: [header(found.value.robot), "🔒 You revoked my spending. I can't pay for anything now."].join('\n'),
    buttons: [[{ text: 'Open wallet', url: `${new URL(origin).origin}${APP_BASE}/wallet` }]],
  })
})

/** The message for one outbox row, or none when there is nothing to say any more (e.g. an approval already answered). */
export const renderNotification = (
  database: QueryDatabaseClient,
  origin: string,
  row: { readonly kind: NotificationKind; readonly subject_id: string },
) => {
  switch (row.kind) {
    case 'approval_needed':
      return approvalNeeded(database, origin, row.subject_id)
    case 'grant_revoked':
      return grantRevoked(database, origin, row.subject_id)
    case 'funds_received':
      return Effect.succeed(fundsReceived(origin, row.subject_id))
    case 'payment_settled':
    case 'approval_denied':
    case 'approval_expired':
      return episodeMessage(database, row.kind, row.subject_id)
  }
}
