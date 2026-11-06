import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Effect } from 'effect'
import { InvoiceRow } from '../merchant/Invoices.ts'
import { changes, firstRow } from '../Sql.ts'

// The robot pays what the counter shows: an errand takes the merchant's open invoice for the item (the one the gate
// or the ESP32 displays) instead of minting its own, so a paid errand opens that gate. Deviation from spec §6's
// "invoice created at the merchant", agreed with the orchestrator on 6 Nov: mint only when no open invoice exists.

/** An invoice must stay payable this long after it is claimed (the chip refuses an expired one). */
export const CLAIM_MARGIN_SECONDS = 60

/**
 * An invoice is free when every errand that took it ended unpaid and no chip ever signed it (a signed invoice is in
 * the chip's replay list, so a second errand on it would only be refused).
 */
const RELEASING_STATES = `('refused', 'failed', 'walked_away', 'safe_stop', 'denied', 'expired')`
const UNCLAIMED = `NOT EXISTS (SELECT 1 FROM episodes e WHERE e.invoice_id = invoices.id AND e.state NOT IN ${RELEASING_STATES})
  AND NOT EXISTS (SELECT 1 FROM episodes e JOIN chip_requests c ON c.episode_id = e.id
    WHERE e.invoice_id = invoices.id AND c.status = 'signed')`

/** The newest open invoice for this item, or exactly `invoiceId` when the caller names one. */
export const findOpenInvoice = (
  database: QueryDatabaseClient,
  input: {
    readonly merchantId: string
    readonly itemId: string
    readonly nowSeconds: number
    readonly invoiceId?: string
  },
) =>
  firstRow(
    database
      .prepare(
        `SELECT * FROM invoices WHERE merchant_id = ? AND item_id = ? AND status = 'pending' AND expires_at >= ?
          AND (? IS NULL OR id = ?) AND ${UNCLAIMED} ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(
        input.merchantId,
        input.itemId,
        input.nowSeconds + CLAIM_MARGIN_SECONDS,
        input.invoiceId ?? null,
        input.invoiceId ?? null,
      ),
    InvoiceRow,
  )

/** Attach the invoice to a `queued` episode and move it to `deciding`, unless another live errand took it meanwhile. */
export const claimInvoice = (database: QueryDatabaseClient, episodeId: string, invoiceId: string, nowSeconds: number) =>
  changes(
    database
      .prepare(
        `UPDATE episodes SET invoice_id = ?, state = 'deciding', state_changed_at = ? WHERE id = ? AND state = 'queued'
          AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.invoice_id = ? AND e.id != ? AND e.state NOT IN ${RELEASING_STATES})`,
      )
      .bind(invoiceId, nowSeconds, episodeId, invoiceId, episodeId),
  ).pipe(Effect.map((count) => count === 1))
