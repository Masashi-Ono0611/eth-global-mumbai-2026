import type { Approver } from '@ethmumbai/chain/Approver'
import type { SignedApproval } from '@ethmumbai/protocol/Approval'
import { Effect, Option, Redacted, Result, Schema } from 'effect'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { keccak256, stringToHex, type Address } from 'viem'
import { jsonError, nowSeconds } from '../Respond.ts'
import { approveErrand, denyErrand } from '../robot/Errands.ts'
import { changes, firstRow } from '../Sql.ts'
import { type ApprovalRow, approvalByState, expireIfLate, moveApproval, signApproval } from './Approve.ts'
import { approvalPage, callbackUrl, type WorldDeps } from './Authorize.ts'
import type { WorldClient } from './Config.ts'
import { takeVerifier } from './Pkce.ts'
import { verifyIdToken, type VerifiedHuman } from './Verify.ts'

const CallbackQuery = Schema.Struct({
  state: Schema.String.check(Schema.isMaxLength(128)),
  code: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2048))),
  error: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(128))),
  iss: Schema.optionalKey(Schema.String),
})
type CallbackQuery = typeof CallbackQuery.Type

/** A refusal with the reason stored on the approval (never the token, the code or the claims' values). */
class Refused extends Schema.TaggedError<Refused>()('Refused', { reason: Schema.String }) {}
const refuse = (reason: string) => Refused.make({ reason })

/**
 * The World token for this approval: exchanged with the attempt's PKCE verifier, RS256-verified, every §9 claim checked
 * (one key refresh on rotation).
 */
const verifiedHuman = Effect.fn('EthMumbai.World.verifiedHuman')(function* (
  world: WorldClient,
  row: ApprovalRow,
  query: CallbackQuery,
  deps: WorldDeps,
) {
  if (query.error !== undefined) return yield* refuse(`World answered ${query.error}`)
  if (query.iss !== undefined && query.iss !== world.issuer) return yield* refuse('issuer mismatch')
  if (query.code === undefined) return yield* refuse('no authorization code')
  const verifier = yield* takeVerifier(deps.database, row.id)
  if (Option.isNone(verifier)) return yield* refuse('no PKCE verifier for this approval')
  const token = yield* world.exchange(query.code, callbackUrl(deps.origin), verifier.value)
  const check = (refresh: boolean) =>
    Effect.flatMap(world.keys(refresh), (keys) =>
      Effect.flatMap(nowSeconds, (now) =>
        verifyIdToken({
          token: Redacted.value(token),
          keys,
          issuer: world.issuer,
          clientId: world.clientId,
          nonce: row.oidc_nonce,
          notBefore: Math.floor(row.created_at / 1000) - 60,
          now,
        }),
      ),
    )
  return yield* check(false).pipe(
    Effect.catchTag('IdTokenRejected', (error) => (error.reason === 'unknown-key' ? check(true) : Effect.fail(error))),
  )
})

/** The wallet's World account: bound on the first approval, the same `sub` required on every later one. */
const bindWorldAccount = Effect.fn('EthMumbai.World.bindAccount')(function* (
  deps: WorldDeps,
  row: ApprovalRow,
  human: VerifiedHuman,
) {
  yield* deps.database
    .prepare('UPDATE accounts SET world_sub = ? WHERE id = ? AND world_sub IS NULL')
    .bind(human.sub, row.account_id)
    .run()
  const bound = yield* firstRow(
    deps.database.prepare('SELECT world_sub FROM accounts WHERE id = ?').bind(row.account_id),
    Schema.Struct({ world_sub: Schema.NullOr(Schema.String) }),
  )
  if (Option.isNone(bound) || bound.value.world_sub !== human.sub)
    return yield* refuse('a different World account than the one bound to this wallet')
})

const authClaims = (human: VerifiedHuman) => JSON.stringify({ acr: human.acr, amr: human.amr })

/** `jti` once (keccak in `used_nonces`), the World account bound to the wallet on first use, then the co-signature. */
const approve = Effect.fn('EthMumbai.World.approve')(function* (
  deps: WorldDeps,
  input: {
    readonly row: ApprovalRow
    readonly human: VerifiedHuman
    readonly approver: Approver
    readonly enforcer: Address
    readonly bindsSubject: boolean
  },
) {
  const { database } = deps
  const { row, human } = input
  const now = yield* nowSeconds
  const fresh = yield* changes(
    database
      .prepare("INSERT INTO used_nonces (nonce, kind, ref, created_at) VALUES (?, 'jti', ?, ?) ON CONFLICT DO NOTHING")
      .bind(keccak256(stringToHex(human.jti)), row.id, now * 1000),
  )
  if (fresh !== 1) return yield* refuse('World token already used')
  if (input.bindsSubject) yield* bindWorldAccount(deps, row, human)
  const signed: SignedApproval = yield* signApproval(input.approver, input.enforcer, row)
  const recorded = yield* changes(
    database
      .prepare(
        `UPDATE approvals SET status = 'approved', jti = ?, sub = ?, auth_time = ?, amr_json = ?, signature = ?, decided_at = ?
          WHERE id = ? AND status = 'opened'`,
      )
      // amr_json keeps what World asserted about the sign-in, {acr, amr} (assurance class and methods, not secrets).
      .bind(human.jti, human.sub, human.authTime, authClaims(human), signed.signature, now, row.id),
  )
  if (recorded !== 1) return yield* refuse('approval was answered concurrently')
  yield* database
    .prepare(
      "INSERT INTO used_nonces (nonce, kind, ref, created_at) VALUES (?, 'approval', ?, ?) ON CONFLICT DO NOTHING",
    )
    .bind(row.nonce, row.id, now * 1000)
    .run()
  yield* Effect.logInfo('world token accepted').pipe(
    Effect.annotateLogs({ approvalId: row.id, acr: human.acr, amr: human.amr.join(' ') }),
  )
  return signed
})

/**
 * `GET /api/world/callback?code&state` (§9 step 3). Approved → the errand continues to `signing` with the signed
 * approval; any failure or `error=access_denied` → `denied` with its reason and nothing is ever signed. A replayed or
 * late `state` → 409. Then the browser goes back to the approval page.
 */
export const callback = (deps: WorldDeps) =>
  Effect.gen(function* () {
    const query = yield* HttpServerRequest.schemaSearchParams(CallbackQuery).pipe(Effect.option)
    if (Option.isNone(query)) return yield* jsonError(400, 'expected ?state=…&code=…')
    const found = yield* approvalByState(deps.database, query.value.state)
    if (Option.isNone(found)) return yield* jsonError(404, 'unknown approval state')
    const row = yield* expireIfLate(deps.database, found.value)
    if (row.status !== 'opened') return yield* jsonError(409, `approval is already ${row.status}`)
    const outcome = yield* Effect.gen(function* () {
      const world = yield* Option.match(deps.world, {
        onNone: () => refuse('World is not configured'),
        onSome: Effect.succeed,
      })
      const approver = yield* Option.match(deps.approver, {
        onNone: () => refuse('approver not configured'),
        onSome: Effect.succeed,
      })
      const enforcer = yield* Option.match(deps.enforcer, {
        onNone: () => refuse('enforcer not configured'),
        onSome: Effect.succeed,
      })
      const human = yield* verifiedHuman(world, row, query.value, deps)
      return yield* approve(deps, { row, human, approver, enforcer, bindsSubject: world.bindsSubject })
    }).pipe(
      Effect.catchTags({
        IdTokenRejected: ({ reason, detail }) =>
          refuse(`World token rejected: ${reason}${detail === undefined ? '' : ` (${detail})`}`),
        WorldUnavailable: ({ stage }) => refuse(`World did not answer (${stage})`),
      }),
      Effect.result,
    )
    if (Result.isSuccess(outcome)) {
      const continued = yield* approveErrand(deps.errands, row.episode_id, outcome.success)
      // The errand ended on its own (its 300 s tick) before World answered: the signature is never delivered, so the
      // approval must not read as approved.
      if (!continued)
        yield* moveApproval(deps.database, row.id, ['approved'], 'expired', 'the errand ended before approval')
      yield* Effect.logInfo('world approval approved').pipe(Effect.annotateLogs({ approvalId: row.id, continued }))
    } else {
      const { reason } = outcome.failure
      if (yield* moveApproval(deps.database, row.id, ['opened'], 'denied', reason))
        yield* denyErrand(deps.errands, row.episode_id, reason)
      yield* Effect.logWarning('world approval denied').pipe(Effect.annotateLogs({ approvalId: row.id, reason }))
    }
    return HttpServerResponse.redirect(approvalPage(deps.origin, row.id), { status: 302 })
  })
