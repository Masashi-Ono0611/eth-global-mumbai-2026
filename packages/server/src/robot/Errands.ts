import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { withApprovalArgs } from '@ethmumbai/chain/Grant'
import { encodePermissionContext } from '@ethmumbai/chain/Hashes'
import type { SignedApproval } from '@ethmumbai/protocol/Approval'
import { generateId } from '@ethmumbai/protocol/Base32'
import type { RefusalCode, SignRequest } from '@ethmumbai/protocol/Chip'
import { ARC_DELEGATION_MANAGER, buildLeaf, delegationHash } from '@ethmumbai/protocol/Delegation'
import { EpisodeState, isTerminalState } from '@ethmumbai/protocol/Errand'
import type { Hex } from '@ethmumbai/protocol/Hex'
import { ARC_CHAIN_ID, type Invoice } from '@ethmumbai/protocol/Invoice'
import { X402_VERSION } from '@ethmumbai/protocol/X402'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { Clock, Effect, Option, Schema } from 'effect'
import { type Grant, latestSignedGrant } from './Budget.ts'
import { settleDecision } from './Decide.ts'
import { enqueueEvidence } from './Evidence.ts'
import type { ZeroGConfig } from './ZeroGClient.ts'
import type { ChipHooks, PaymentReport } from '../chip/Hooks.ts'
import { readRobot, type RobotRow } from '../chip/Lease.ts'
import { type ChipRequestRow, decodePayload, enqueueSignRequest } from '../chip/Requests.ts'
import type { Payees } from '../merchant/Catalogue.ts'
import { readInvoice, toInvoice } from '../merchant/Invoices.ts'
import { requirementsFor, type Settlement } from '../merchant/X402.ts'
import { nowSeconds } from '../Respond.ts'
import { allRows, changes, firstRow } from '../Sql.ts'

/** The `episodes` row (= errand, §3). `result` holds the tx hash when paid, otherwise the reason it ended. */
export const EpisodeRow = Schema.Struct({
  id: Schema.String,
  robot_id: Schema.String,
  account_id: Schema.String,
  item: Schema.String,
  invoice_id: Schema.NullOr(Schema.String),
  state: EpisodeState,
  decision_count: Schema.NullOr(Schema.Finite),
  result: Schema.NullOr(Schema.String),
  request_ids_hash: Schema.NullOr(Schema.String),
  state_changed_at: Schema.NullOr(Schema.Finite),
  created_at: Schema.Finite,
})
export type EpisodeRow = typeof EpisodeRow.Type
type State = EpisodeState

export const LIVE_STATES = ['queued', 'deciding', 'awaiting_approval', 'signing', 'settling'] as const
/** Lazy timeouts (spec §6), applied on every read and every chip poll. */
const TIMEOUTS: ReadonlyArray<{
  readonly from: State
  readonly seconds: number
  readonly to: State
  readonly why: string
}> = [
  { from: 'queued', seconds: 30, to: 'safe_stop', why: 'errand interrupted before deciding' },
  { from: 'deciding', seconds: 30, to: 'safe_stop', why: 'decision interrupted' },
  { from: 'awaiting_approval', seconds: 300, to: 'expired', why: 'no approval within 300 s' },
  { from: 'signing', seconds: 60, to: 'expired', why: 'chip silent for 60 s' },
]

/** Everything an errand needs; each optional binding missing makes errands answer 503, never guess. */
export interface ErrandDeps {
  readonly database: QueryDatabaseClient
  readonly origin: string
  readonly payees: Option.Option<Payees>
  readonly zeroG: Option.Option<ZeroGConfig>
  readonly settlement: Option.Option<Settlement>
  readonly approvals: ApprovalPort
}

/** The World approval seam (Wallet, spec §9): creates the `approvals` row and returns the owner's approval page. */
export interface ApprovalPort {
  readonly request: (input: {
    readonly episodeId: string
    readonly robotId: string
    readonly accountId: string
    readonly invoice: Invoice
  }) => Effect.Effect<
    Option.Option<{ readonly approvalId: string; readonly approvalUrl: string }>,
    never,
    RuntimeContext
  >
}

export const noApprovals: ApprovalPort = { request: () => Effect.succeedNone }

export const readEpisode = (database: QueryDatabaseClient, episodeId: string) =>
  firstRow(database.prepare('SELECT * FROM episodes WHERE id = ?').bind(episodeId), EpisodeRow)

/** One conditional move; entering a terminal state queues the episode's evidence (exactly once: the move wins once). */
export const transition = Effect.fnUntraced(function* (
  database: QueryDatabaseClient,
  episodeId: string,
  from: State,
  to: State,
  result: string | null = null,
) {
  const moved = yield* changes(
    database
      .prepare(
        `UPDATE episodes SET state = ?, state_changed_at = ?, result = COALESCE(?, result) WHERE id = ? AND state = ?`,
      )
      .bind(to, yield* nowSeconds, result, episodeId, from),
  )
  if (moved !== 1) return false
  if (isTerminalState(to)) {
    const episode = yield* readEpisode(database, episodeId)
    if (Option.isSome(episode)) yield* enqueueEvidence(database, episode.value)
  }
  return true
})

/** Apply every due timeout for this robot's live errands. */
export const tickRobot = Effect.fn('EthMumbai.Robot.tick')(function* (database: QueryDatabaseClient, robotId: string) {
  const now = yield* nowSeconds
  const live = yield* allRows(
    database
      .prepare(
        `SELECT * FROM episodes WHERE robot_id = ? AND state IN ('queued', 'deciding', 'awaiting_approval', 'signing')`,
      )
      .bind(robotId),
    EpisodeRow,
  )
  yield* Effect.forEach(live, (episode) => {
    const due = TIMEOUTS.find(
      (timeout) => timeout.from === episode.state && now - (episode.state_changed_at ?? 0) >= timeout.seconds,
    )
    return due === undefined ? Effect.void : transition(database, episode.id, due.from, due.to, due.why)
  })
})

/** Build and queue the chip's sign request: the leaf it must re-derive, the grant, and the approval if there is one. */
export const queueSigning = Effect.fnUntraced(function* (
  deps: ErrandDeps,
  input: {
    readonly episode: EpisodeRow
    readonly robot: RobotRow
    readonly grant: Grant
    readonly invoice: Invoice
    readonly relayer: Hex
    readonly approval: SignedApproval | null
  },
) {
  const { episode, robot, grant, invoice, relayer, approval } = input
  if (robot.chip_address === null) return yield* Effect.die(new Error('a paired robot has a chip address'))
  const chip = robot.chip_address
  const build = (id: string, expiresAt: number): SignRequest => ({
    id,
    kind: 'sign-invoice',
    expiresAt,
    invoice,
    grant: {
      delegation: grant.delegation,
      dailyCap: grant.dailyCap.toString(),
      perPaymentCap: grant.perPaymentCap.toString(),
      allowlist: grant.allowlist,
      expiresAt: grant.row.expires_at,
    },
    approval,
    leaf: buildLeaf({
      chip,
      grantHash: delegationHash(grant.delegation),
      relayer,
      invoiceHash: invoice.invoiceHash,
      payTo: invoice.payTo,
      amount: BigInt(invoice.amount),
      expiresAt: invoice.expiresAt,
    }),
    chainId: ARC_CHAIN_ID,
    delegationManager: ARC_DELEGATION_MANAGER,
  })
  return yield* enqueueSignRequest(deps.database, { robotId: robot.id, episodeId: episode.id, build })
})

const ApprovalRef = Schema.Struct({ id: Schema.String })
const approvalIdOf = (database: QueryDatabaseClient, episodeId: string) =>
  firstRow(
    database
      .prepare(`SELECT id FROM approvals WHERE episode_id = ? AND status IN ('approved', 'consumed') LIMIT 1`)
      .bind(episodeId),
    ApprovalRef,
  ).pipe(Effect.map(Option.map((row) => row.id)))

/** The chip signed: settle inline (verify, simulate, send, receipt) and end the errand `paid` or `failed`. */
const settleSigned = Effect.fnUntraced(function* (deps: ErrandDeps, request: ChipRequestRow, signature: Hex) {
  const { database } = deps
  if (!(yield* transition(database, request.episode_id, 'signing', 'settling')))
    return { status: 'failed', reason: 'errand is no longer signing' } satisfies PaymentReport
  const fail = (reason: string) =>
    Effect.gen(function* () {
      yield* transition(database, request.episode_id, 'settling', 'failed', reason)
      yield* settleDecision(database, request.episode_id, 'failed', reason)
      return { status: 'failed', reason } satisfies PaymentReport
    })
  if (Option.isNone(deps.settlement)) return yield* fail('not configured: RELAYER_PRIVATE_KEY')
  const settlement = deps.settlement.value
  const payload = yield* decodePayload(request)
  const grant = payload.grant.delegation
  const enforcer = grant.caveats[3]?.enforcer
  if (enforcer === undefined) return yield* fail('grant has no policy caveat')
  const permissionContext = encodePermissionContext([
    { ...payload.leaf, signature },
    withApprovalArgs(grant, enforcer, payload.approval),
  ])
  const requirements = requirementsFor(payload.invoice, settlement.relayer)
  const approvalId = yield* approvalIdOf(database, request.episode_id)
  const paid = (txHash: Hex) =>
    Effect.gen(function* () {
      yield* transition(database, request.episode_id, 'settling', 'paid', txHash)
      yield* settleDecision(database, request.episode_id, 'paid', txHash)
      return { status: 'settled', txHash } satisfies PaymentReport
    })
  return yield* settlement
    .settle({
      invoice: payload.invoice,
      requirements,
      payment: {
        x402Version: X402_VERSION,
        accepted: requirements,
        payload: { delegationManager: ARC_DELEGATION_MANAGER, permissionContext, delegator: grant.delegator },
      },
      robotId: request.robot_id,
      episodeId: request.episode_id,
      ...(Option.isSome(approvalId) ? { approvalId: approvalId.value } : {}),
    })
    .pipe(
      Effect.flatMap((success) => paid(success.transaction)),
      Effect.catchTags({
        AlreadySettled: () => fail('already settled'),
        SettlementRejected: ({ reason }) => fail(reason),
      }),
    )
})

const refuseSigned = Effect.fnUntraced(function* (deps: ErrandDeps, request: ChipRequestRow, code: RefusalCode) {
  if (yield* transition(deps.database, request.episode_id, 'signing', 'refused', code))
    yield* settleDecision(deps.database, request.episode_id, 'refused', code)
})

/** The chip protocol's hooks, bound to this errand engine. */
export const errandChipHooks = (deps: ErrandDeps): ChipHooks => ({
  tick: (robotId) => tickRobot(deps.database, robotId),
  signed: (request, signature) => settleSigned(deps, request, signature),
  refused: (request, code) => refuseSigned(deps, request, code),
})

/** World said yes (Wallet's callback): attach the approver's signature and ask the chip to sign. */
export const approveErrand = Effect.fn('EthMumbai.Robot.approve')(function* (
  deps: ErrandDeps,
  episodeId: string,
  approval: SignedApproval,
) {
  const episode = yield* readEpisode(deps.database, episodeId)
  if (Option.isNone(episode) || episode.value.invoice_id === null || Option.isNone(deps.settlement)) return false
  const robot = yield* readRobot(deps.database, episode.value.robot_id)
  const grant = yield* latestSignedGrant(deps.database, episode.value.robot_id)
  const invoice = yield* readInvoice(deps.database, episode.value.invoice_id)
  if (Option.isNone(robot) || Option.isNone(grant) || Option.isNone(invoice)) return false
  if (!(yield* transition(deps.database, episodeId, 'awaiting_approval', 'signing'))) return false
  yield* settleDecision(deps.database, episodeId, 'approved', null)
  yield* queueSigning(deps, {
    episode: episode.value,
    robot: robot.value,
    grant: grant.value,
    invoice: toInvoice(invoice.value, deps.origin),
    relayer: deps.settlement.value.relayer,
    approval,
  })
  return true
})

/** World said no, or the approval failed: nothing is ever signed for this errand. */
export const denyErrand = Effect.fn('EthMumbai.Robot.deny')(function* (
  deps: ErrandDeps,
  episodeId: string,
  reason: string,
) {
  const moved = yield* transition(deps.database, episodeId, 'awaiting_approval', 'denied', reason)
  if (moved) yield* settleDecision(deps.database, episodeId, 'denied', null)
  return moved
})

/** Insert a `queued` episode unless this robot already has a live errand (the check and insert are one statement). */
export const insertEpisode = Effect.fnUntraced(function* (
  database: QueryDatabaseClient,
  input: { readonly robotId: string; readonly accountId: string; readonly item: string },
) {
  const id = yield* generateId
  const createdAt = yield* Clock.currentTimeMillis
  const inserted = yield* changes(
    database
      .prepare(
        `INSERT INTO episodes (id, robot_id, account_id, item, state, decision_count, state_changed_at, created_at)
          SELECT ?, ?, ?, ?, 'queued', 0, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM episodes WHERE robot_id = ? AND state IN (${LIVE_STATES.map((state) => `'${state}'`).join(', ')}))`,
      )
      .bind(id, input.robotId, input.accountId, input.item, Math.floor(createdAt / 1000), createdAt, input.robotId),
  )
  return inserted === 1 ? Option.some(id) : Option.none()
})
