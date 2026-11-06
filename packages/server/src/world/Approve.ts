import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { Approver } from '@ethmumbai/chain/Approver'
import { approvalNonce, type SignedApproval } from '@ethmumbai/protocol/Approval'
import { idFromBytes16 } from '@ethmumbai/protocol/Base32'
import type { Hex } from '@ethmumbai/protocol/Hex'
import { Clock, Effect, Option, Schema } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'
import type { Address } from 'viem'
import type { ApprovalPort } from '../robot/Errands.ts'
import { nowSeconds, randomBytes } from '../Respond.ts'
import { changes, firstRow } from '../Sql.ts'

/** An approval is answered within 300 s of the request (spec §9 step 4), or it expires and nothing is signed. */
export const APPROVAL_SECONDS = 300

export const ApprovalStatus = Schema.Literals(['requested', 'opened', 'approved', 'denied', 'expired', 'consumed'])
export const ApprovalRow = Schema.Struct({
  id: Schema.String,
  account_id: Schema.String,
  robot_id: Schema.String,
  episode_id: Schema.String,
  invoice_id: Schema.String,
  invoice_hash: Schema.String,
  payee: Schema.String,
  amount: Schema.String,
  expiry: Schema.Finite,
  nonce: Schema.String,
  oidc_state: Schema.String,
  oidc_nonce: Schema.String,
  status: ApprovalStatus,
  error: Schema.NullOr(Schema.String),
  created_at: Schema.Finite,
  decided_at: Schema.NullOr(Schema.Finite),
})
export type ApprovalRow = typeof ApprovalRow.Type

/** Seconds since the epoch at which the approval stops accepting a World answer. */
export const closesAt = (row: ApprovalRow) => Math.floor(row.created_at / 1000) + APPROVAL_SECONDS

export const readApproval = (database: QueryDatabaseClient, id: string) =>
  firstRow(database.prepare('SELECT * FROM approvals WHERE id = ?').bind(id), ApprovalRow)

export const approvalByState = (database: QueryDatabaseClient, state: string) =>
  firstRow(database.prepare('SELECT * FROM approvals WHERE oidc_state = ?').bind(state), ApprovalRow)

/** One conditional move between approval states; false when another request already moved it. */
export const moveApproval = (
  database: QueryDatabaseClient,
  id: string,
  from: ReadonlyArray<ApprovalRow['status']>,
  to: ApprovalRow['status'],
  error: string | null,
) =>
  Effect.flatMap(nowSeconds, (now) =>
    changes(
      database
        .prepare(
          `UPDATE approvals SET status = ?, error = COALESCE(?, error), decided_at = ? WHERE id = ? AND status IN (${from.map(() => '?').join(', ')})`,
        )
        .bind(to, error, now, id, ...from),
    ),
  ).pipe(Effect.map((count) => count === 1))

/** Lazily applies the 300 s window on every read (no scheduler, like the errands). */
export const expireIfLate = Effect.fn('EthMumbai.World.expireIfLate')(function* (
  database: QueryDatabaseClient,
  row: ApprovalRow,
) {
  if ((row.status === 'requested' || row.status === 'opened') && (yield* nowSeconds) > closesAt(row)) {
    yield* moveApproval(database, row.id, ['requested', 'opened'], 'expired', 'no answer within 300 s')
    return { ...row, status: 'expired' as const }
  }
  return row
})

/**
 * The Robot Agent's approval seam (§9 step 1): one `approvals` row per invoice, keyed by its nonce (the EIP-712 digest
 * of {invoiceHash, payee, amount, expiry} with the invoice hash as nonce), which is also the World OIDC `nonce`.
 * A second request for the same invoice returns the existing approval.
 */
export const makeApprovalPort = (deps: {
  readonly database: QueryDatabaseClient
  readonly enforcer: Option.Option<Address>
  readonly approver: Option.Option<Approver>
}): ApprovalPort => ({
  request: ({ episodeId, robotId, accountId, invoice }) =>
    Effect.gen(function* () {
      if (Option.isNone(deps.enforcer) || Option.isNone(deps.approver)) {
        yield* Effect.logWarning('approval requested but ENFORCER_ADDRESS or APPROVER_PRIVATE_KEY is not configured')
        return Option.none()
      }
      const nonce = approvalNonce(deps.enforcer.value, {
        invoiceHash: invoice.invoiceHash,
        payee: invoice.payTo,
        amount: invoice.amount,
        expiry: invoice.expiresAt,
      })
      const id = idFromBytes16(yield* randomBytes(16))
      const state = Base64Url.encode(yield* randomBytes(32))
      yield* deps.database
        .prepare(
          `INSERT INTO approvals (id, account_id, robot_id, episode_id, invoice_id, invoice_hash, payee, amount, expiry,
            nonce, oidc_state, oidc_nonce, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?)
          ON CONFLICT (nonce) DO NOTHING`,
        )
        .bind(
          id,
          accountId,
          robotId,
          episodeId,
          invoice.id,
          invoice.invoiceHash,
          invoice.payTo,
          invoice.amount,
          invoice.expiresAt,
          nonce,
          state,
          nonce,
          yield* Clock.currentTimeMillis,
        )
        .run()
      const row = yield* firstRow(
        deps.database.prepare('SELECT id FROM approvals WHERE nonce = ?').bind(nonce),
        Schema.Struct({ id: Schema.String }),
      )
      return Option.map(row, ({ id: approvalId }) => ({ approvalId, approvalUrl: `/wallet/approvals/${approvalId}` }))
    }).pipe(Effect.withSpan('EthMumbai.World.requestApproval')),
})

/** §9 step 3, after a verified token: the backend co-signer (D15) signs exactly this invoice, payee, amount, expiry. */
export const signApproval = (approver: Approver, enforcer: Address, row: ApprovalRow) =>
  Effect.gen(function* () {
    const signed: SignedApproval = yield* approver.sign(enforcer, {
      invoiceHash: hex(row.invoice_hash),
      payee: hex(row.payee),
      amount: row.amount,
      expiry: row.expiry,
      nonce: hex(row.nonce),
    })
    return signed
  })

const hex = (value: string): Hex => `0x${value.slice(2)}`
