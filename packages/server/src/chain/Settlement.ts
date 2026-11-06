import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ArcClient } from '@ethmumbai/chain/Arc'
import { settlementCall, verifyPayment } from '@ethmumbai/chain/Facilitator'
import { dataSha256, type Relayer } from '@ethmumbai/chain/Relayer'
import { ARC_NETWORK } from '@ethmumbai/protocol/Invoice'
import type { Check, SettleSuccess } from '@ethmumbai/protocol/X402'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { Clock, Effect, Option, Schema } from 'effect'
import { AlreadySettled, type Settlement, type SettleInput, SettlementRejected } from '../merchant/X402.ts'
import { nowSeconds } from '../Respond.ts'
import { changes, firstRow } from '../Sql.ts'

const PaymentStatusRow = Schema.Struct({ status: Schema.Literals(['verifying', 'settling', 'settled', 'failed']) })

const reject = (reason: string, checks: readonly Check[] = []) =>
  new SettlementRejected({ reason, checks: [...checks] })

/** Opens the `payments` row (or re-opens a failed one); false when a settlement for this invoice is in flight or done. */
const begin = Effect.fn('EthMumbai.Chain.settlement.begin')(function* (
  database: QueryDatabaseClient,
  settle: SettleInput,
) {
  const now = yield* Clock.currentTimeMillis
  const { payment, invoice } = settle
  const started = yield* changes(
    database
      .prepare(
        `INSERT INTO payments (invoice_hash, invoice_id, robot_id, episode_id, payer, delegation_manager,
           context_sha256, approval_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verifying', ?)
         ON CONFLICT(invoice_hash) DO UPDATE SET status = 'verifying', fail_reason = NULL,
           context_sha256 = excluded.context_sha256
         WHERE payments.status = 'failed'`,
      )
      .bind(
        invoice.invoiceHash.toLowerCase(),
        invoice.id,
        settle.robotId ?? null,
        settle.episodeId ?? null,
        payment.payload.delegator,
        payment.payload.delegationManager,
        dataSha256(payment.payload.permissionContext),
        settle.approvalId ?? null,
        now,
      ),
  )
  if (started > 0) return true
  const row = yield* firstRow(
    database.prepare('SELECT status FROM payments WHERE invoice_hash = ?').bind(invoice.invoiceHash.toLowerCase()),
    PaymentStatusRow,
  )
  return Option.isNone(row)
})

const finish = (database: QueryDatabaseClient, invoiceHash: string, assignments: string, values: readonly unknown[]) =>
  database
    .prepare(`UPDATE payments SET ${assignments} WHERE invoice_hash = ?`)
    .bind(...values, invoiceHash.toLowerCase())
    .run()

const fail = (database: QueryDatabaseClient, invoiceHash: string, reason: string) =>
  finish(database, invoiceHash, "status = 'failed', fail_reason = ?", [reason.slice(0, 500)])

const settled = (
  database: QueryDatabaseClient,
  invoiceId: string,
  invoiceHash: string,
  txHash: string,
  gasUsed: bigint,
) =>
  Effect.gen(function* () {
    const settledAt = yield* nowSeconds
    yield* finish(database, invoiceHash, "status = 'settled', tx_hash = ?, gas_used = ?, settled_at = ?", [
      txHash,
      gasUsed.toString(),
      settledAt,
    ])
    yield* database
      .prepare("UPDATE invoices SET status = 'paid', paid_tx = ? WHERE id = ? AND status = 'pending'")
      .bind(txHash, invoiceId)
      .run()
  })

/**
 * The facilitator behind the merchant's x402 route and the chip's inline settlement (§7): one `payments` row per
 * invoice hash, verify (structural checks + simulation from the relayer), then the relayer's keyed send
 * (`settle:<invoiceHash>`), then `payments.settled` and `invoices.paid`. Arc decides; these rows mirror it.
 */
export const makeSettlement = Effect.fn('EthMumbai.Chain.settlement')(function* (input: {
  readonly database: QueryDatabaseClient
  readonly client: ArcClient
  readonly relayer: Relayer
}) {
  const { database, client, relayer } = input
  const runtime = yield* Effect.context<RuntimeContext>()

  const settle = (request: SettleInput): Effect.Effect<SettleSuccess, SettlementRejected | AlreadySettled> =>
    Effect.gen(function* () {
      const { invoice, payment, requirements } = request
      if (!(yield* begin(database, request))) return yield* new AlreadySettled()
      const verified = yield* verifyPayment({ client, relayer: relayer.address }, payment, requirements)
      if (!verified.isValid) {
        const reason = verified.invalidReason ?? 'invalid'
        yield* fail(database, invoice.invoiceHash, reason)
        return yield* reject(reason, verified.checks)
      }
      yield* finish(database, invoice.invoiceHash, "status = 'settling'", [])
      const sent = yield* relayer
        .send({
          key: `settle:${invoice.invoiceHash.toLowerCase()}`,
          kind: 'settle',
          ...settlementCall(payment, requirements),
        })
        .pipe(
          Effect.catchTag('AlreadySubmitted', () => Effect.fail(new AlreadySettled())),
          Effect.catchTag(['RelayerError', 'RelayerStoreError'], (error) =>
            fail(database, invoice.invoiceHash, error.message).pipe(
              Effect.andThen(Effect.fail(reject(error.message, verified.checks))),
            ),
          ),
        )
      if (!sent.success) {
        yield* fail(database, invoice.invoiceHash, `reverted on chain ${sent.txHash}`)
        return yield* reject(`reverted on chain (${sent.txHash})`, verified.checks)
      }
      yield* settled(database, invoice.id, invoice.invoiceHash, sent.txHash, sent.gasUsed)
      const success: SettleSuccess = {
        success: true,
        transaction: sent.txHash,
        network: ARC_NETWORK,
        payer: payment.payload.delegator,
        invoiceId: invoice.id,
        status: 'paid',
      }
      return success
    }).pipe(Effect.provideContext(runtime), Effect.withSpan('EthMumbai.Chain.settle'))

  const settlement: Settlement = { relayer: relayer.address, settle }
  return settlement
})
