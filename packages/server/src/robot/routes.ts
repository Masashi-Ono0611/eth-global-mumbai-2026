import { Id } from '@ethmumbai/protocol/Base32'
import { CreateErrandRequest } from '@ethmumbai/protocol/Errand'
import { Clock, Effect, Option, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import { latestSignedGrant, periodStartOf, spentInPeriod } from './Budget.ts'
import { firstObservation } from './Observations.ts'
import { decisionsOf } from './Decide.ts'
import { type EpisodeRow, type ErrandDeps, readEpisode, tickRobot } from './Errands.ts'
import { readEvidence } from './Evidence.ts'
import { openIntent, settleIntents } from './Intents.ts'
import { chosenBrain, errandSetup, need, runErrand, signedGrant } from './Start.ts'
import { brainChoices } from './ZeroGClient.ts'
import { CurrentSession, requireSession } from '../auth/Session.ts'
import { leaseOf, readRobot } from '../chip/Lease.ts'
import { readRequestForEpisode } from '../chip/Requests.ts'
import { findItem } from '../merchant/Catalogue.ts'
import { readInvoice, toInvoice } from '../merchant/Invoices.ts'
import { json, jsonError, nowSeconds } from '../Respond.ts'
import { firstRow } from '../Sql.ts'

/**
 * `{item}` (spec §6) plus an optional `invoiceId`: the exact counter invoice to pay (console, e2e driver, a scan), and an
 * optional `model`: the brain the owner picked for this errand.
 */
const ErrandRequest = Schema.Struct({ ...CreateErrandRequest.fields, invoiceId: Schema.optionalKey(Id) })

/** The signed-in owner's own robot, or nothing (another account's robot is indistinguishable from a missing one). */
const ownRobot = Effect.fnUntraced(function* (deps: ErrandDeps, robotId: string | undefined) {
  const session = yield* CurrentSession
  const robot = yield* readRobot(deps.database, robotId ?? '')
  return Option.filter(robot, (row) => row.account_id === session.accountId)
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
    yield* HttpServerRequest.schemaBodyJson(ErrandRequest).pipe(Effect.option),
    400,
    'expected {"item": string, "invoiceId"?: string, "model"?: string}',
  )
  const { payees, zeroG, merchant } = yield* errandSetup(deps)
  const item = yield* need(findItem(merchant, body.item), 400, 'unknown item')
  const model = yield* chosenBrain(deps.zeroG, body.model)
  const grant = yield* signedGrant(deps, robot)
  return { robot, payees, zeroG, merchant, item, grant, invoiceId: body.invoiceId, model }
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

const ApprovalSummary = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  error: Schema.NullOr(Schema.String),
  decided_at: Schema.NullOr(Schema.Finite),
})

/** The errand's latest World approval (spec §9), without its tokens or signature. */
const approvalOf = (deps: ErrandDeps, episodeId: string) =>
  firstRow(
    deps.database
      .prepare(
        'SELECT id, status, error, decided_at FROM approvals WHERE episode_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .bind(episodeId),
    ApprovalSummary,
  )

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
      approval: Option.getOrNull(yield* approvalOf(deps, episode.value.id)),
      evidence: Option.getOrNull(yield* readEvidence(deps.database, episode.value.id)),
      // What the robot saw: the errand's first chip-signed QR crop (metadata only; the image is owner-only).
      observation: Option.getOrNull(yield* firstObservation(deps.database, episode.value.id)),
    })
  })

const readRobotView = (deps: ErrandDeps) =>
  Effect.gen(function* () {
    const robot = yield* ownRobot(deps, (yield* HttpRouter.params).robotId)
    if (Option.isNone(robot)) return yield* jsonError(404, 'unknown robot')
    yield* settleIntents(deps.database, robot.value.id)
    const intent = yield* openIntent(deps.database, robot.value.id)
    const grant = yield* latestSignedGrant(deps.database, robot.value.id)
    const { id, name, kind, status, chip_address, paired_at, last_poll_at } = robot.value
    const now = yield* nowSeconds
    const spent = Option.isSome(grant) ? yield* spentInPeriod(deps.database, grant.value, now) : 0n
    return yield* json({
      robot: { id, name, kind, status, chipAddress: chip_address, pairedAt: paired_at, lastPollAt: last_poll_at },
      lease: leaseOf(robot.value, yield* Clock.currentTimeMillis),
      // The newest open errand intent (running or scanned), so the conversation resumes after a reload.
      openIntentId: Option.match(intent, { onNone: () => null, onSome: (row) => row.id }),
      // The brains the owner may pick per message (ZG_MODEL first); none while 0G is not configured.
      brains: Option.match(deps.zeroG, { onNone: () => [], onSome: brainChoices }),
      grant: Option.match(grant, {
        onNone: () => null,
        onSome: ({ row, dailyCap, perPaymentCap, allowlist }) => ({
          id: row.id,
          status: row.status,
          delegationHash: row.delegation_hash,
          dailyCap: dailyCap.toString(),
          perPaymentCap: perPaymentCap.toString(),
          allowlist,
          startAt: row.start_at,
          expiresAt: row.expires_at,
          // What the period enforcer's current day has used, from settled payments (Arc is the authority).
          spentToday: spent.toString(),
          periodEndsAt: periodStartOf(row.start_at, now) + 86_400,
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
