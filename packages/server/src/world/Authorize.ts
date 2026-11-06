import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { Approver } from '@ethmumbai/chain/Approver'
import { Effect, Option, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import type { Address } from 'viem'
import { BadRequest } from '../auth/Routes.ts'
import { CurrentSession, type SessionAccount } from '../auth/Session.ts'
import { json } from '../Respond.ts'
import { denyErrand, type ErrandDeps } from '../robot/Errands.ts'
import { firstRow } from '../Sql.ts'
import { NotFound, required } from '../wallet/Errors.ts'
import { type ApprovalRow, closesAt, expireIfLate, moveApproval, readApproval } from './Approve.ts'
import type { WorldClient } from './Config.ts'

/** Everything the World approval routes need; each optional binding answers 503 until it is set. */
export interface WorldDeps {
  readonly database: QueryDatabaseClient
  readonly origin: string
  readonly world: Option.Option<WorldClient>
  readonly approver: Option.Option<Approver>
  readonly enforcer: Option.Option<Address>
  readonly errands: ErrandDeps
}

export const approvalPage = (origin: string, id: string) => `${new URL(origin).origin}/wallet/approvals/${id}`
export const callbackUrl = (origin: string) => `${new URL(origin).origin}/api/world/callback`

const IdPath = Schema.Struct({ id: Schema.String })

/** The signed-in owner's own approval (another account's is indistinguishable from a missing one), with expiry applied. */
export const ownApproval = Effect.fn('EthMumbai.World.ownApproval')(function* (
  database: QueryDatabaseClient,
  session: SessionAccount,
  id: string,
) {
  const row = yield* readApproval(database, id)
  if (Option.isNone(row) || row.value.account_id !== session.accountId)
    return yield* NotFound.make({ what: 'approval' })
  return yield* expireIfLate(database, row.value)
})

const EpisodeFacts = Schema.Struct({ item: Schema.String, robot_name: Schema.String, state: Schema.String })

/** `GET /api/approvals/:id` → what the owner approves: item, amount, payee, invoice, window and outcome. */
export const readApprovalView = (deps: WorldDeps) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    const { id } = yield* HttpRouter.schemaPathParams(IdPath).pipe(Effect.orDie)
    const row = yield* ownApproval(deps.database, session, id)
    const facts = yield* firstRow(
      deps.database
        .prepare(
          'SELECT e.item, r.name AS robot_name, e.state FROM episodes e JOIN robots r ON r.id = e.robot_id WHERE e.id = ?',
        )
        .bind(row.episode_id),
      EpisodeFacts,
    )
    return yield* json({
      id: row.id,
      status: row.status,
      error: row.error,
      item: Option.match(facts, { onNone: () => null, onSome: (found) => found.item }),
      robotName: Option.match(facts, { onNone: () => null, onSome: (found) => found.robot_name }),
      errandState: Option.match(facts, { onNone: () => null, onSome: (found) => found.state }),
      robotId: row.robot_id,
      episodeId: row.episode_id,
      invoiceId: row.invoice_id,
      invoiceHash: row.invoice_hash,
      payee: row.payee,
      amount: row.amount,
      closesAt: closesAt(row),
      worldConfigured: Option.isSome(deps.world) && Option.isSome(deps.approver) && Option.isSome(deps.enforcer),
    })
  })

const answerable = (row: ApprovalRow) => row.status === 'requested' || row.status === 'opened'

const AuthorizeQuery = Schema.Struct({ approval: Schema.String.check(Schema.isMaxLength(64)) })

/**
 * `GET /api/world/authorize?approval=:id` (§9 step 2) → 302 to World IdP with `state` = the approval's random OIDC
 * state, `nonce` = its EIP-712 nonce, `max_age=0` and `prompt=login` (a fresh World authentication every time).
 */
export const authorize = (deps: WorldDeps) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    const query = yield* HttpServerRequest.schemaSearchParams(AuthorizeQuery).pipe(
      Effect.mapError(() => BadRequest.make({ detail: 'expected ?approval=<id>' })),
    )
    const world = yield* required(deps.world, 'WORLD_CLIENT_ID')
    yield* required(deps.approver, 'APPROVER_PRIVATE_KEY')
    yield* required(deps.enforcer, 'ENFORCER_ADDRESS')
    const row = yield* ownApproval(deps.database, session, query.approval)
    if (!answerable(row)) return HttpServerResponse.redirect(approvalPage(deps.origin, row.id), { status: 302 })
    yield* deps.database
      .prepare("UPDATE approvals SET status = 'opened' WHERE id = ? AND status IN ('requested', 'opened')")
      .bind(row.id)
      .run()
    const endpoint = yield* world.authorizationEndpoint.pipe(Effect.orElseSucceed(() => `${world.issuer}/authorize`))
    const url = new URL(endpoint)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: world.clientId,
      redirect_uri: callbackUrl(deps.origin),
      scope: 'openid',
      state: row.oidc_state,
      nonce: row.oidc_nonce,
      max_age: '0',
      prompt: 'login',
    }).toString()
    yield* Effect.logInfo('world approval opened').pipe(Effect.annotateLogs({ approvalId: row.id }))
    return HttpServerResponse.redirect(url.toString(), { status: 302 })
  })

/** `POST /api/approvals/:id/deny`: the owner says no without World; the errand ends `denied`, nothing is signed. */
export const denyByOwner = (deps: WorldDeps) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    const { id } = yield* HttpRouter.schemaPathParams(IdPath).pipe(Effect.orDie)
    const row = yield* ownApproval(deps.database, session, id)
    const moved = yield* moveApproval(deps.database, row.id, ['requested', 'opened'], 'denied', 'denied by the owner')
    if (moved) yield* denyErrand(deps.errands, row.episode_id, 'denied by the owner')
    return yield* json({ id: row.id, status: moved ? 'denied' : row.status })
  })
