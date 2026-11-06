import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Delegation } from '@ethmumbai/protocol/Delegation'
import { Address } from '@ethmumbai/protocol/Hex'
import { Effect, Option, Schema } from 'effect'
import { allRows, firstRow } from '../Sql.ts'

/** The `grants` row (§3) as the Robot Agent reads it; the Wallet writes it. Caps are USDC base units (decimal text). */
export const GrantRow = Schema.Struct({
  id: Schema.String,
  robot_id: Schema.String,
  account_id: Schema.String,
  delegation_hash: Schema.String,
  delegation_json: Schema.NullOr(Schema.String),
  daily_cap: Schema.String,
  per_payment_cap: Schema.String,
  allowlist_json: Schema.String,
  start_at: Schema.Finite,
  expires_at: Schema.Finite,
  status: Schema.Literals(['unsigned', 'active', 'revoking', 'revoked', 'expired']),
  revoke_tx: Schema.NullOr(Schema.String),
  created_at: Schema.Finite,
})
export type GrantRow = typeof GrantRow.Type

const Allowlist = Schema.fromJsonString(Schema.Array(Address))
const SignedDelegation = Schema.fromJsonString(Delegation)

/** A signed grant, ready to put in a sign request. */
export interface Grant {
  readonly row: GrantRow
  readonly delegation: Delegation
  readonly dailyCap: bigint
  readonly perPaymentCap: bigint
  readonly allowlist: ReadonlyArray<`0x${string}`>
}

/**
 * The robot's latest signed grant, whatever D1 says about its status: Arc is the authority, so a grant D1 marks
 * revoked is still offered and the DelegationManager rejects it (`CannotUseADisabledDelegation`, spec §11 step 9).
 */
export const latestSignedGrant = Effect.fnUntraced(function* (database: QueryDatabaseClient, robotId: string) {
  const row = yield* firstRow(
    database
      .prepare(
        `SELECT * FROM grants WHERE robot_id = ? AND delegation_json IS NOT NULL AND status != 'unsigned'
          ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(robotId),
    GrantRow,
  )
  if (Option.isNone(row)) return Option.none<Grant>()
  const delegation = yield* Schema.decodeUnknownEffect(SignedDelegation)(row.value.delegation_json).pipe(Effect.orDie)
  const allowlist = yield* Schema.decodeUnknownEffect(Allowlist)(row.value.allowlist_json).pipe(Effect.orDie)
  return Option.some<Grant>({
    row: row.value,
    delegation,
    dailyCap: BigInt(row.value.daily_cap),
    perPaymentCap: BigInt(row.value.per_payment_cap),
    allowlist,
  })
})

const SettledAmount = Schema.Struct({ amount: Schema.String })

/** USDC this robot settled in the grant's current period (the period enforcer's day starts at `start_at`). */
export const spentInPeriod = Effect.fnUntraced(function* (
  database: QueryDatabaseClient,
  grant: Grant,
  nowSeconds: number,
) {
  const start = grant.row.start_at
  const periodStart = nowSeconds < start ? start : start + Math.floor((nowSeconds - start) / 86_400) * 86_400
  const rows = yield* allRows(
    database
      .prepare(
        `SELECT invoices.amount AS amount FROM payments JOIN invoices ON invoices.id = payments.invoice_id
          WHERE payments.robot_id = ? AND payments.status = 'settled' AND payments.settled_at >= ?`,
      )
      .bind(grant.row.robot_id, periodStart),
    SettledAmount,
  )
  return rows.reduce((total, row) => total + BigInt(row.amount), 0n)
})

export const isApprovalRequired = (grant: Grant, payTo: string, amount: bigint) =>
  amount > grant.perPaymentCap || !grant.allowlist.some((payee) => payee.toLowerCase() === payTo.toLowerCase())
