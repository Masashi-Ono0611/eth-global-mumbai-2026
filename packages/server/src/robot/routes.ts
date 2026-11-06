import { CreateErrandRequest, type DecisionAction } from '@ethmumbai/protocol/Errand'
import type { Invoice } from '@ethmumbai/protocol/Invoice'
import { Clock, Effect, Option, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import { type Grant, isApprovalRequired, latestSignedGrant, spentInPeriod } from './Budget.ts'
import { actionOf, decideInput, decisionsOf, recordDecision } from './Decide.ts'
import {
  type EpisodeRow,
  type ErrandDeps,
  insertEpisode,
  queueSigning,
  readEpisode,
  tickRobot,
  transition,
} from './Errands.ts'
import { readEvidence } from './Evidence.ts'
import { decide, type ZeroGOutcome } from './ZeroGClient.ts'
import { CurrentSession, requireSession } from '../auth/Session.ts'
import { leaseOf, readRobot, type RobotRow } from '../chip/Lease.ts'
import { readRequestForEpisode } from '../chip/Requests.ts'
import { findItem, findMerchant } from '../merchant/Catalogue.ts'
import { createInvoice, readInvoice, toInvoice } from '../merchant/Invoices.ts'
import { json, jsonError, nowSeconds } from '../Respond.ts'

/** The robot's demo merchant (the catalogue's only one). */
const MERCHANT_ID = 'duck-cafe'

/** The signed-in owner's own robot, or nothing (another account's robot is indistinguishable from a missing one). */
const ownRobot = Effect.fnUntraced(function* (deps: ErrandDeps, robotId: string | undefined) {
  const session = yield* CurrentSession
  const robot = yield* readRobot(deps.database, robotId ?? '')
  return Option.filter(robot, (row) => row.account_id === session.accountId)
})

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
class ErrandRefused extends Schema.TaggedError<ErrandRefused>()('ErrandRefused', {
  status: Schema.Finite,
  error: Schema.String,
}) {}

const need = <A>(value: Option.Option<A>, status: number, error: string) =>
  Option.match(value, {
    onNone: () => Effect.fail(new ErrandRefused({ status, error })),
    onSome: (present) => Effect.succeed(present),
  })

/** Spec §6 preconditions, in order: own paired robot, body, configured bindings, known item, signed grant. */
const errandContext = Effect.fnUntraced(function* (deps: ErrandDeps) {
  const robot = yield* need(yield* ownRobot(deps, (yield* HttpRouter.params).robotId), 404, 'unknown robot')
  yield* need(
    Option.liftPredicate(robot, (row) => row.status === 'paired'),
    409,
    'robot is not paired',
  )
  const body = yield* need(
    yield* HttpServerRequest.schemaBodyJson(CreateErrandRequest).pipe(Effect.option),
    400,
    'expected {"item": string}',
  )
  const payees = yield* need(deps.payees, 503, 'not configured: MERCHANT_PAY_TO')
  const zeroG = yield* need(deps.zeroG, 503, 'not configured: ZG_API_KEY')
  yield* need(deps.settlement, 503, 'not configured: RELAYER_PRIVATE_KEY')
  const merchant = yield* need(findMerchant(MERCHANT_ID), 500, 'merchant catalogue is missing')
  const item = yield* need(findItem(merchant, body.item), 400, 'unknown item')
  const grant = yield* need(yield* latestSignedGrant(deps.database, robot.id), 409, 'robot has no signed grant')
  return { robot, payees, zeroG, merchant, item, grant }
})

/** queued → (invoice at the merchant) → deciding → the 0G decision → the next state; all inside this request. */
const runErrand = Effect.fnUntraced(function* (
  deps: ErrandDeps,
  context: Effect.Success<ReturnType<typeof errandContext>>,
) {
  const { database } = deps
  const { robot, payees, zeroG, merchant, item, grant } = context
  yield* tickRobot(database, robot.id)
  const episodeId = yield* need(
    yield* insertEpisode(database, { robotId: robot.id, accountId: robot.account_id, item: item.itemId }),
    409,
    'this robot already has an errand in progress',
  )
  const invoice = toInvoice(yield* createInvoice(database, payees, merchant, item), deps.origin)
  yield* database
    .prepare(
      `UPDATE episodes SET invoice_id = ?, state = 'deciding', state_changed_at = ? WHERE id = ? AND state = 'queued'`,
    )
    .bind(invoice.id, yield* nowSeconds, episodeId)
    .run()
  const spentToday = yield* spentInPeriod(database, grant, yield* nowSeconds)
  const outcome = yield* decide(zeroG, decideInput({ item, merchant, invoice, grant, spentToday })).pipe(
    Effect.provide(FetchHttpClient.layer),
  )
  const action = actionOf(outcome)
  yield* recordDecision(database, episodeId, 1, outcome)
  const approvalUrl = yield* afterDecision(deps, { episodeId, robot, grant, invoice, outcome, action })
  const episode = yield* readEpisode(database, episodeId)
  return {
    episodeId,
    state: Option.match(episode, { onNone: () => 'safe_stop', onSome: (row) => row.state }),
    decision: { action, reason: outcome.ok ? outcome.result.reason : outcome.error, requestId: outcome.call.requestId },
    ...(Option.isSome(approvalUrl) ? { approvalUrl: approvalUrl.value } : {}),
  }
})

const startErrand = (deps: ErrandDeps) =>
  errandContext(deps).pipe(
    Effect.flatMap((context) => runErrand(deps, context)),
    Effect.flatMap((created) => json(created, 201)),
    Effect.catchTag('ErrandRefused', ({ status, error }) => jsonError(status, error)),
  )

const PaymentRow = Effect.fnUntraced(function* (deps: ErrandDeps, episode: EpisodeRow) {
  if (episode.invoice_id === null) return null
  const invoice = yield* readInvoice(deps.database, episode.invoice_id)
  return Option.match(invoice, {
    onNone: () => null,
    onSome: (row) => ({ invoice: toInvoice(row, deps.origin), status: row.status, txHash: row.paid_tx }),
  })
})

const readErrand = (deps: ErrandDeps) =>
  Effect.gen(function* () {
    const { robotId, episodeId } = yield* HttpRouter.params
    const robot = yield* ownRobot(deps, robotId)
    if (Option.isNone(robot)) return yield* jsonError(404, 'unknown robot')
    yield* tickRobot(deps.database, robot.value.id)
    const episode = yield* readEpisode(deps.database, episodeId ?? '')
    if (Option.isNone(episode) || episode.value.robot_id !== robot.value.id)
      return yield* jsonError(404, 'unknown errand')
    const chipRequest = yield* readRequestForEpisode(deps.database, episode.value.id)
    return yield* json({
      episode: episode.value,
      decisions: yield* decisionsOf(deps.database, episode.value.id),
      chipRequest: Option.match(chipRequest, {
        onNone: () => null,
        onSome: ({ id, status, refusal_code, leaf_hash, expires_at }) => ({
          id,
          status,
          refusal_code,
          leaf_hash,
          expires_at,
        }),
      }),
      payment: yield* PaymentRow(deps, episode.value),
      evidence: Option.getOrNull(yield* readEvidence(deps.database, episode.value.id)),
    })
  })

const readRobotView = (deps: ErrandDeps) =>
  Effect.gen(function* () {
    const robot = yield* ownRobot(deps, (yield* HttpRouter.params).robotId)
    if (Option.isNone(robot)) return yield* jsonError(404, 'unknown robot')
    yield* tickRobot(deps.database, robot.value.id)
    const grant = yield* latestSignedGrant(deps.database, robot.value.id)
    const { id, name, status, chip_address, paired_at, last_poll_at } = robot.value
    return yield* json({
      robot: { id, name, status, chipAddress: chip_address, pairedAt: paired_at, lastPollAt: last_poll_at },
      lease: leaseOf(robot.value, yield* Clock.currentTimeMillis),
      grant: Option.match(grant, {
        onNone: () => null,
        onSome: ({ row, dailyCap, perPaymentCap, allowlist }) => ({
          id: row.id,
          status: row.status,
          dailyCap: dailyCap.toString(),
          perPaymentCap: perPaymentCap.toString(),
          allowlist,
          expiresAt: row.expires_at,
        }),
      }),
    })
  })

/** Robot console API (spec §6), all behind the session cookie and the Origin check. */
export const robotRoutes = (deps: ErrandDeps) =>
  HttpRouter.addAll([
    HttpRouter.route('POST', '/api/robots/:robotId/errands', requireSession(startErrand(deps))),
    HttpRouter.route('GET', '/api/robots/:robotId/errands/:episodeId', requireSession(readErrand(deps))),
    HttpRouter.route('GET', '/api/robots/:robotId', requireSession(readRobotView(deps))),
  ])
