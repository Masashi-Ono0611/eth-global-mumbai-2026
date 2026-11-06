import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { generateId } from '@ethmumbai/protocol/Base32'
import {
  type DecideInput,
  DecisionAction,
  DecisionOutcome,
  type DecisionAction as Action,
  type DecisionOutcome as Outcome,
  type TeeProof,
} from '@ethmumbai/protocol/Errand'
import type { Invoice } from '@ethmumbai/protocol/Invoice'
import { Clock, Effect, Option, Schema } from 'effect'
import { type Grant, isApprovalRequired } from './Budget.ts'
import { encodeTeeProof } from './TeeProof.ts'
import type { ZeroGOutcome } from './ZeroGClient.ts'
import type { CatalogueItem, Merchant } from '../merchant/Catalogue.ts'
import { allRows, changes } from '../Sql.ts'

export const DecisionRow = Schema.Struct({
  id: Schema.String,
  episode_id: Schema.String,
  step: Schema.Finite,
  model: Schema.String,
  request_id: Schema.NullOr(Schema.String),
  chat_id: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  latency_ms: Schema.NullOr(Schema.Finite),
  prompt_sha256: Schema.String,
  input_json: Schema.String,
  action: DecisionAction,
  reason: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(DecisionOutcome),
  outcome_ref: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  /** The provider TEE's proof for this chat (protocol `TeeProof` as JSON), or null without one. */
  tee_json: Schema.NullOr(Schema.String),
  created_at: Schema.Finite,
})
export type DecisionRow = typeof DecisionRow.Type

/** The structured input of spec §6: no frames, no free text from the merchant, only facts the Worker checked. */
export const decideInput = (input: {
  readonly item: CatalogueItem
  readonly merchant: Merchant
  readonly invoice: Invoice
  readonly grant: Grant
  readonly spentToday: bigint
  /** The owner's errand intent the scan claimed: `requested` is its item when it named one. */
  readonly owner?: DecideInput['owner'] | undefined
}): DecideInput => {
  const { item, merchant, invoice, grant, spentToday, owner } = input
  const remaining = grant.dailyCap > spentToday ? grant.dailyCap - spentToday : 0n
  const payeeAllowlisted = grant.allowlist.some((payee) => payee.toLowerCase() === invoice.payTo.toLowerCase())
  return {
    requested: owner?.item ?? item.itemId,
    catalogue: { itemId: item.itemId, name: item.name, amount: item.amount, restricted: item.restricted },
    invoice: { id: invoice.id, payTo: invoice.payTo, amount: invoice.amount, expiresAt: invoice.expiresAt },
    budget: {
      dailyCap: grant.dailyCap.toString(),
      spentToday: spentToday.toString(),
      remainingToday: remaining.toString(),
      perPaymentCap: grant.perPaymentCap.toString(),
    },
    policy: {
      payeeAllowlisted,
      restricted: item.restricted,
      approvalRequired: isApprovalRequired(grant, invoice.payTo, BigInt(invoice.amount)),
    },
    merchant: { id: merchant.id, trust: merchant.trust },
    ...(owner === undefined ? {} : { owner }),
  }
}

/** What the errand does with a 0G outcome: a failed call is `safe_stop`, never a guess. */
export const actionOf = (outcome: ZeroGOutcome): Action => (outcome.ok ? outcome.result.action : 'safe_stop')

/** One `decisions` row per 0G call (unique `(episode_id, step)`), with the request id and never the key or prompt. */
export const recordDecision = Effect.fnUntraced(function* (
  database: QueryDatabaseClient,
  episodeId: string,
  step: number,
  outcome: ZeroGOutcome,
  tee: Option.Option<TeeProof> = Option.none(),
) {
  const id = yield* generateId
  const teeJson = yield* encodeTeeProof(tee)
  const createdAt = yield* Clock.currentTimeMillis
  const { call } = outcome
  const action = actionOf(outcome)
  yield* database
    .prepare(
      `INSERT INTO decisions (id, episode_id, step, model, request_id, chat_id, provider, latency_ms, prompt_sha256,
        input_json, action, reason, outcome, error, tee_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(episode_id, step) DO NOTHING`,
    )
    .bind(
      id,
      episodeId,
      step,
      call.model,
      call.requestId,
      call.chatId,
      call.provider,
      call.latencyMs,
      call.promptSha256,
      call.inputJson,
      action,
      outcome.ok ? outcome.result.reason : null,
      action === 'safe_stop' ? 'safe_stop' : action === 'walk_away' ? 'walked_away' : null,
      outcome.ok ? null : outcome.error,
      teeJson,
      createdAt,
    )
    .run()
  return action
})

/** The decision's eventual outcome (paid, approved, denied, refused, failed), set when the errand learns it. */
export const settleDecision = (
  database: QueryDatabaseClient,
  episodeId: string,
  outcome: Outcome,
  ref: string | null,
) =>
  changes(
    database
      .prepare(`UPDATE decisions SET outcome = ?, outcome_ref = ? WHERE episode_id = ? AND step = 1`)
      .bind(outcome, ref, episodeId),
  )

export const decisionsOf = (database: QueryDatabaseClient, episodeId: string) =>
  allRows(database.prepare('SELECT * FROM decisions WHERE episode_id = ? ORDER BY step').bind(episodeId), DecisionRow)
