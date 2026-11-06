import type { DecisionAction, EpisodeState } from '@ethmumbai/protocol/Errand'
import type { Invoice } from '@ethmumbai/protocol/Invoice'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { Effect, Option, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { type Grant, isApprovalRequired, latestSignedGrant, spentInPeriod } from './Budget.ts'
import { claimInvoice, findOpenInvoice } from './CounterInvoice.ts'
import { actionOf, decideInput, recordDecision } from './Decide.ts'
import { type ErrandDeps, insertEpisode, queueSigning, readEpisode, tickRobot, transition } from './Errands.ts'
import { proveDecision } from './TeeProof.ts'
import { decide, type ZeroGConfig, type ZeroGOutcome } from './ZeroGClient.ts'
import type { RobotRow } from '../chip/Lease.ts'
import { type CatalogueItem, findMerchant, type Merchant, type Payees } from '../merchant/Catalogue.ts'
import { createInvoice, type InvoiceRow, toInvoice } from '../merchant/Invoices.ts'
import { nowSeconds } from '../Respond.ts'

// Starting an errand (spec §6 queued → deciding → …), shared by the owner's console and the chip's scans.

/** The robot's demo merchant (the catalogue's only one). */
const MERCHANT_ID = 'duck-cafe'

/** Everything an errand start needs, checked by the caller (session route or chip scan). */
export interface ErrandContext {
  readonly robot: RobotRow
  readonly payees: Payees
  readonly zeroG: ZeroGConfig
  readonly merchant: Merchant
  readonly item: CatalogueItem
  readonly grant: Grant
  /** The exact open invoice to pay (console, e2e driver, a scan); otherwise the counter's or a fresh one. */
  readonly invoiceId?: string | undefined
}

/** Where the errand goes after the decision (spec §6 `deciding`). */
const afterDecision = Effect.fnUntraced(function* (
  deps: ErrandDeps,
  input: {
    readonly episodeId: string
    readonly robot: RobotRow
    readonly grant: Grant
    readonly invoice: Invoice
    readonly outcome: ZeroGOutcome
    readonly action: DecisionAction
  },
) {
  const { episodeId, robot, grant, invoice, outcome, action } = input
  const { database } = deps
  if (action === 'safe_stop' || !outcome.ok) {
    yield* transition(database, episodeId, 'deciding', 'safe_stop', outcome.ok ? 'safe_stop' : outcome.error)
    return Option.none<string>()
  }
  if (action === 'walk_away') {
    yield* transition(database, episodeId, 'deciding', 'walked_away', outcome.result.reason)
    return Option.none<string>()
  }
  if (action === 'pay' && !isApprovalRequired(grant, invoice.payTo, BigInt(invoice.amount))) {
    const relayer = Option.getOrUndefined(Option.map(deps.settlement, (settlement) => settlement.relayer))
    const episode = yield* readEpisode(database, episodeId)
    if (relayer === undefined || Option.isNone(episode)) return Option.none<string>()
    if (yield* transition(database, episodeId, 'deciding', 'signing'))
      yield* queueSigning(deps, { episode: episode.value, robot, grant, invoice, relayer, approval: null })
    return Option.none<string>()
  }
  yield* transition(database, episodeId, 'deciding', 'awaiting_approval')
  const approval = yield* deps.approvals.request({ episodeId, robotId: robot.id, accountId: robot.account_id, invoice })
  return Option.map(approval, (requested) => requested.approvalUrl)
})

/** A precondition the errand cannot start without; the route answers with its status. */
export class ErrandRefused extends Schema.TaggedError<ErrandRefused>()('ErrandRefused', {
  status: Schema.Finite,
  error: Schema.String,
}) {}

export const need = <A>(value: Option.Option<A>, status: number, error: string) =>
  Option.match(value, {
    onNone: () => Effect.fail(new ErrandRefused({ status, error })),
    onSome: (present) => Effect.succeed(present),
  })

/** The bindings and catalogue every errand start needs, in spec §10 order (a missing binding is 503). */
export const errandSetup = Effect.fnUntraced(function* (deps: ErrandDeps) {
  const payees = yield* need(deps.payees, 503, 'not configured: MERCHANT_PAY_TO')
  const zeroG = yield* need(deps.zeroG, 503, 'not configured: ZG_API_KEY')
  yield* need(deps.settlement, 503, 'not configured: RELAYER_PRIVATE_KEY')
  const merchant = yield* need(findMerchant(MERCHANT_ID), 500, 'merchant catalogue is missing')
  return { payees, zeroG, merchant }
})

/** The robot's newest signed grant (spec §5): no grant, no errand. */
export const signedGrant = (deps: ErrandDeps, robot: RobotRow) =>
  latestSignedGrant(deps.database, robot.id).pipe(
    Effect.flatMap((grant) => need(grant, 409, 'robot has no signed grant')),
  )

/**
 * The invoice this errand pays: the one the caller named (it must be open for this item, else 409), otherwise the
 * counter's newest open invoice for the item (what the gate shows), otherwise a fresh one. Restricted items are never
 * on the counter, so they always get their own invoice unless named.
 */
const attachInvoice = Effect.fnUntraced(function* (
  deps: ErrandDeps,
  context: ErrandContext,
  episodeId: string,
  named: Option.Option<InvoiceRow>,
) {
  const { database } = deps
  const { merchant, item, payees } = context
  const now = yield* nowSeconds
  const counter =
    Option.isSome(named) || item.restricted
      ? named
      : yield* findOpenInvoice(database, { merchantId: merchant.id, itemId: item.itemId, nowSeconds: now })
  if (Option.isSome(counter) && (yield* claimInvoice(database, episodeId, counter.value.id, now))) return counter.value
  if (Option.isSome(named)) {
    yield* transition(database, episodeId, 'queued', 'failed', 'the named invoice was claimed by another errand')
    return yield* new ErrandRefused({ status: 409, error: 'invoice is already claimed by another errand' })
  }
  const minted = yield* createInvoice(database, payees, merchant, item)
  yield* claimInvoice(database, episodeId, minted.id, now)
  return minted
})

/** queued → (invoice at the merchant) → deciding → the 0G decision → the next state; all inside this request. */
export const runErrand = Effect.fnUntraced(function* (
  deps: ErrandDeps,
  context: ErrandContext,
  /** Runs once the episode holds its invoice, before the decision (a scan stores its observation here). */
  onInvoice: (episodeId: string) => Effect.Effect<void, ErrandRefused, RuntimeContext> = () => Effect.void,
) {
  const { database } = deps
  const { robot, zeroG, merchant, item, grant } = context
  yield* tickRobot(database, robot.id)
  const named =
    context.invoiceId === undefined
      ? Option.none<InvoiceRow>()
      : Option.some(
          yield* need(
            yield* findOpenInvoice(database, {
              merchantId: merchant.id,
              itemId: item.itemId,
              nowSeconds: yield* nowSeconds,
              invoiceId: context.invoiceId,
            }),
            409,
            'invoice is not open for this item',
          ),
        )
  const episodeId = yield* need(
    yield* insertEpisode(database, { robotId: robot.id, accountId: robot.account_id, item: item.itemId }),
    409,
    'this robot already has an errand in progress',
  )
  const invoice = toInvoice(yield* attachInvoice(deps, context, episodeId, named), deps.origin)
  yield* onInvoice(episodeId).pipe(
    Effect.tapError((refused) => transition(database, episodeId, 'deciding', 'safe_stop', refused.error)),
  )
  const spentToday = yield* spentInPeriod(database, grant, yield* nowSeconds)
  const outcome = yield* decide(zeroG, decideInput({ item, merchant, invoice, grant, spentToday })).pipe(
    Effect.provide(FetchHttpClient.layer),
  )
  const action = actionOf(outcome)
  // The provider TEE's signature for this chat, fetched now (it is served ~20 min only); no proof never changes the action.
  const tee = yield* proveDecision(deps.teeRegistry, outcome).pipe(Effect.provide(FetchHttpClient.layer))
  yield* recordDecision(database, episodeId, 1, outcome, tee)
  const approvalUrl = yield* afterDecision(deps, { episodeId, robot, grant, invoice, outcome, action })
  const episode = yield* readEpisode(database, episodeId)
  return {
    episodeId,
    state: Option.match(episode, { onNone: (): EpisodeState => 'safe_stop', onSome: (row) => row.state }),
    decision: { action, reason: outcome.ok ? outcome.result.reason : outcome.error, requestId: outcome.call.requestId },
    ...(Option.isSome(approvalUrl) ? { approvalUrl: approvalUrl.value } : {}),
  }
})
