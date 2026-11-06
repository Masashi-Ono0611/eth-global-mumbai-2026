import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { generateId } from '@ethmumbai/protocol/Base32'
import { Address, Bytes32, type Hex } from '@ethmumbai/protocol/Hex'
import { ARC_USDC, type Invoice, invoiceHash, jsonHash } from '@ethmumbai/protocol/Invoice'
import { Clock, Effect, Option, Schema } from 'effect'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import { getAddress } from 'viem'
import { type CatalogueItem, findItem, findMerchant, type Merchant, type Payees } from './Catalogue.ts'
import { json, jsonError, notConfigured, nowSeconds } from '../Respond.ts'
import { changes, firstRow, SqlBoolean } from '../Sql.ts'

/** An invoice is payable for ten minutes (spec §7). */
export const INVOICE_TTL_SECONDS = 600

export const InvoiceStatus = Schema.Literals(['pending', 'paid', 'used', 'expired'])
export type InvoiceStatus = typeof InvoiceStatus.Type

export const InvoiceRow = Schema.Struct({
  id: Schema.String,
  merchant_id: Schema.String,
  item_id: Schema.String,
  pay_to: Address,
  asset: Address,
  amount: Schema.String,
  expires_at: Schema.Finite,
  lines_hash: Bytes32,
  rules_hash: Bytes32,
  invoice_hash: Bytes32,
  restricted: SqlBoolean,
  status: InvoiceStatus,
  paid_tx: Schema.NullOr(Schema.String),
  used_at: Schema.NullOr(Schema.Finite),
  created_at: Schema.Finite,
})
export type InvoiceRow = typeof InvoiceRow.Type

export const invoiceUrl = (origin: string, id: string) => `${origin}/api/i/${id}`

/** The published invoice (§7): what the gate shows, the chip receives and the x402 body carries. */
export const toInvoice = (row: InvoiceRow, origin: string): Invoice => ({
  id: row.id,
  url: invoiceUrl(origin, row.id),
  merchantId: row.merchant_id,
  payTo: row.pay_to,
  asset: row.asset,
  amount: row.amount,
  expiresAt: row.expires_at,
  linesHash: row.lines_hash,
  rulesHash: row.rules_hash,
  invoiceHash: row.invoice_hash,
  restricted: row.restricted === 1,
})

const payToOf = (item: CatalogueItem, payees: Payees): Hex =>
  item.payee === 'restricted' ? payees.restricted : payees.merchant

/** Mint and store a `pending` invoice for one catalogue item. Used by the merchant API and by robot errands. */
export const createInvoice = Effect.fn('EthMumbai.Merchant.createInvoice')(function* (
  database: QueryDatabaseClient,
  payees: Payees,
  merchant: Merchant,
  item: CatalogueItem,
) {
  const id = yield* generateId
  const createdAt = yield* Clock.currentTimeMillis
  const expiresAt = Math.floor(createdAt / 1000) + INVOICE_TTL_SECONDS
  const lines = [{ sku: item.itemId, name: item.name, qty: 1, unitAmount: item.amount }]
  const restrictions = item.restricted ? ['restricted-item'] : []
  const payTo = payToOf(item, payees)
  const linesHash = jsonHash(lines)
  const rulesHash = jsonHash(restrictions)
  const hash = invoiceHash({
    merchantId: merchant.id,
    id,
    payTo,
    asset: ARC_USDC,
    amount: item.amount,
    expiresAt,
    linesHash,
    rulesHash,
  })
  const row: InvoiceRow = {
    id,
    merchant_id: merchant.id,
    item_id: item.itemId,
    pay_to: payTo,
    asset: ARC_USDC,
    amount: item.amount,
    expires_at: expiresAt,
    lines_hash: linesHash,
    rules_hash: rulesHash,
    invoice_hash: hash,
    restricted: item.restricted ? 1 : 0,
    status: 'pending',
    paid_tx: null,
    used_at: null,
    created_at: createdAt,
  }
  yield* database
    .prepare(
      `INSERT INTO invoices (id, merchant_id, item_id, pay_to, asset, amount, expires_at, lines_hash, rules_hash,
        invoice_hash, restricted, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(
      id,
      merchant.id,
      item.itemId,
      payTo,
      ARC_USDC,
      item.amount,
      expiresAt,
      linesHash,
      rulesHash,
      hash,
      row.restricted,
      createdAt,
    )
    .run()
  return row
})

/** Read an invoice and apply its expiry lazily: a `pending` invoice past `expires_at` becomes `expired`. */
export const readInvoice = Effect.fn('EthMumbai.Merchant.readInvoice')(function* (
  database: QueryDatabaseClient,
  id: string,
) {
  const found = yield* firstRow(database.prepare('SELECT * FROM invoices WHERE id = ?').bind(id), InvoiceRow)
  if (Option.isNone(found)) return found
  const now = yield* nowSeconds
  if (found.value.status !== 'pending' || found.value.expires_at > now) return found
  yield* changes(
    database.prepare(`UPDATE invoices SET status = 'expired' WHERE id = ? AND status = 'pending'`).bind(id),
  )
  return yield* firstRow(database.prepare('SELECT * FROM invoices WHERE id = ?').bind(id), InvoiceRow)
})

/** The catalogue plus the merchant's own payee (checksummed) for grant allowlists; never the restricted payee. */
const catalogueBody = (merchant: Merchant, payees: Option.Option<Payees>) => ({
  merchantId: merchant.id,
  name: merchant.name,
  payTo: Option.match(payees, { onNone: () => null, onSome: ({ merchant: payTo }) => getAddress(payTo) }),
  items: merchant.items.map(({ itemId, name, amount, restricted }) => ({ itemId, name, amount, restricted })),
})

const CreateInvoiceBody = Schema.Struct({ itemId: Schema.String.check(Schema.isMaxLength(64)) })

/** `GET /api/merchants/:id/items` and `POST /api/merchants/:id/invoices {itemId}` → 201 invoice. */
export const invoiceRoutes = (database: QueryDatabaseClient, origin: string, payees: Option.Option<Payees>) =>
  HttpRouter.addAll([
    HttpRouter.route(
      'GET',
      '/api/merchants/:merchantId/items',
      Effect.gen(function* () {
        const { merchantId } = yield* HttpRouter.params
        const merchant = findMerchant(merchantId ?? '')
        if (Option.isNone(merchant)) return yield* jsonError(404, 'unknown merchant')
        return yield* json(catalogueBody(merchant.value, payees))
      }),
    ),
    HttpRouter.route(
      'POST',
      '/api/merchants/:merchantId/invoices',
      Effect.gen(function* () {
        const { merchantId } = yield* HttpRouter.params
        const merchant = findMerchant(merchantId ?? '')
        if (Option.isNone(merchant)) return yield* jsonError(404, 'unknown merchant')
        if (Option.isNone(payees)) return yield* notConfigured('MERCHANT_PAY_TO')
        const body = yield* HttpServerRequest.schemaBodyJson(CreateInvoiceBody).pipe(Effect.option)
        if (Option.isNone(body)) return yield* jsonError(400, 'expected {"itemId": string}')
        const item = findItem(merchant.value, body.value.itemId)
        if (Option.isNone(item)) return yield* jsonError(404, 'unknown item')
        const row = yield* createInvoice(database, payees.value, merchant.value, item.value)
        return yield* json(toInvoice(row, origin), 201)
      }),
    ),
  ])
