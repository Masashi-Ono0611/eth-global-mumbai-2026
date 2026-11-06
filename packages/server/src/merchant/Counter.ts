import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Effect, Option, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { findItem, findMerchant, type Merchant, type Payees } from './Catalogue.ts'
import { type InvoiceRow, mintRoute, readInvoice } from './Invoices.ts'
import { CLAIM_MARGIN_SECONDS } from '../robot/CounterInvoice.ts'
import { json, jsonError, nowSeconds } from '../Respond.ts'
import { firstRow } from '../Sql.ts'

// The café's counter screen (the ESP32 gate) cannot be reached from outside, so it pulls what to show: the one invoice
// the till last put on display (`counter_display`). Only the till's POST writes it; invoices minted through POST
// /invoices (the sim's stalls, the web gate) never replace it. Displaying an invoice does not claim it: a scan or a
// "buy <item>" errand still takes it as the counter's open invoice (spec §6). No session and no Origin, like the mint.

const DisplayRow = Schema.Struct({ invoice_id: Schema.String })

/** Put a freshly minted invoice on the merchant's counter screen, replacing whatever it showed. */
const display = Effect.fnUntraced(function* (database: QueryDatabaseClient, row: InvoiceRow) {
  const now = yield* nowSeconds
  yield* database
    .prepare(
      `INSERT INTO counter_display (merchant_id, invoice_id, set_at) VALUES (?, ?, ?)
        ON CONFLICT (merchant_id) DO UPDATE SET invoice_id = excluded.invoice_id, set_at = excluded.set_at`,
    )
    .bind(row.merchant_id, row.id, now)
    .run()
})

/** The invoice on display (its expiry applied lazily), if the till ever put one up. */
const displayedInvoice = Effect.fnUntraced(function* (database: QueryDatabaseClient, merchantId: string) {
  const shown = yield* firstRow(
    database.prepare('SELECT invoice_id FROM counter_display WHERE merchant_id = ?').bind(merchantId),
    DisplayRow,
  )
  return Option.isNone(shown) ? Option.none<InvoiceRow>() : yield* readInvoice(database, shown.value.invoice_id)
})

/** Exactly these keys, in this order: the ESP32 string-matches the compact JSON. */
const counterInvoice = (merchant: Merchant, row: InvoiceRow) => ({
  id: row.id,
  itemId: row.item_id,
  name: Option.match(findItem(merchant, row.item_id), { onNone: () => row.item_id, onSome: (item) => item.name }),
  amount: row.amount,
  expiresAt: row.expires_at,
  status: row.status,
})

/**
 * `screen`: what the ESP32 shows, only while it is payable (pending, at least 60 s left, as scans and the chip
 * require), else `{"invoice":null}`. `till`: the same invoice in any status, so the till can say PAID or expired.
 */
const counterRead = (database: QueryDatabaseClient, reader: 'screen' | 'till') =>
  Effect.gen(function* () {
    const { merchantId } = yield* HttpRouter.params
    const merchant = findMerchant(merchantId ?? '')
    if (Option.isNone(merchant)) return yield* jsonError(404, 'unknown merchant')
    const now = yield* nowSeconds
    const shown = Option.filter(
      yield* displayedInvoice(database, merchant.value.id),
      (row) => reader === 'till' || (row.status === 'pending' && row.expires_at >= now + CLAIM_MARGIN_SECONDS),
    )
    const invoice = Option.match(shown, { onNone: () => null, onSome: (row) => counterInvoice(merchant.value, row) })
    return yield* json({ invoice }, 200, { 'cache-control': 'no-store' })
  })

/**
 * `POST /api/merchants/:id/counter {itemId}` → 201 invoice (the mint's body) and on display; `GET …/counter` → the
 * screen's `{"invoice": {id, itemId, name, amount, expiresAt, status} | null}`; `GET …/counter/latest` → the till's.
 */
export const counterRoutes = (database: QueryDatabaseClient, origin: string, payees: Option.Option<Payees>) =>
  HttpRouter.addAll([
    HttpRouter.route(
      'POST',
      '/api/merchants/:merchantId/counter',
      mintRoute(database, origin, payees, (row) => display(database, row)),
    ),
    HttpRouter.route('GET', '/api/merchants/:merchantId/counter', counterRead(database, 'screen')),
    HttpRouter.route('GET', '/api/merchants/:merchantId/counter/latest', counterRead(database, 'till')),
  ])
