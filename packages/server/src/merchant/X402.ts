import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { ARC_DELEGATION_MANAGER } from '@ethmumbai/protocol/Delegation'
import type { Hex } from '@ethmumbai/protocol/Hex'
import { ARC_NETWORK, type Invoice } from '@ethmumbai/protocol/Invoice'
import {
  type Check,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  PayRequest,
  type SettleSuccess,
  X402_VERSION,
} from '@ethmumbai/protocol/X402'
import { Effect, Option, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import { findItem, findMerchant } from './Catalogue.ts'
import { type InvoiceRow, readInvoice, toInvoice } from './Invoices.ts'
import { json, jsonError, notConfigured } from '../Respond.ts'

/** The facilitator refused or Arc reverted: the reason is returned verbatim (`IdEnforcer:id-already-used`, …). */
export class SettlementRejected extends Schema.TaggedError<SettlementRejected>()('SettlementRejected', {
  reason: Schema.String,
  checks: Schema.Array(
    Schema.Struct({ name: Schema.String, ok: Schema.Boolean, detail: Schema.optionalKey(Schema.String) }),
  ),
}) {}

/** The persistent per-invoice guard (`relayer_txs` key `settle:<invoiceHash>`) already holds a settlement. */
export class AlreadySettled extends Schema.TaggedError<AlreadySettled>()('AlreadySettled', {}) {}

export interface SettleInput {
  readonly invoice: Invoice
  readonly requirements: PaymentRequirements
  readonly payment: PaymentPayload
  readonly robotId?: string
  readonly episodeId?: string
  readonly approvalId?: string
}

/** What the merchant and the chip responses need from the facilitator in `@ethmumbai/chain` (verify, then settle). */
export interface Settlement {
  readonly relayer: Hex
  readonly settle: (input: SettleInput) => Effect.Effect<SettleSuccess, SettlementRejected | AlreadySettled>
}

const itemName = (row: InvoiceRow) =>
  Option.match(
    Option.flatMap(findMerchant(row.merchant_id), (merchant) => findItem(merchant, row.item_id)),
    {
      onNone: () => row.item_id,
      onSome: (item) => item.name,
    },
  )

/** `accepts[0]` for an invoice (§7): exact scheme, ERC-7710 transfer, our relayer as the only facilitator. */
export const requirementsFor = (invoice: Invoice, relayer: Hex): PaymentRequirements => ({
  scheme: 'exact',
  network: ARC_NETWORK,
  asset: invoice.asset,
  payTo: invoice.payTo,
  amount: invoice.amount,
  maxTimeoutSeconds: 120,
  extra: {
    assetTransferMethod: 'erc7710',
    invoiceHash: invoice.invoiceHash,
    invoiceId: invoice.id,
    expiresAt: invoice.expiresAt,
    delegationManager: ARC_DELEGATION_MANAGER,
    facilitators: [relayer],
    paymentIdentifier: invoice.id,
  },
})

const paymentRequired = (row: InvoiceRow, origin: string, relayer: Hex): PaymentRequired => {
  const invoice = toInvoice(row, origin)
  return {
    x402Version: X402_VERSION,
    error: 'payment-required',
    resource: { url: invoice.url, description: itemName(row), mimeType: 'application/json' },
    accepts: [requirementsFor(invoice, relayer)],
  }
}

const paidBody = (row: InvoiceRow) => ({
  invoiceId: row.id,
  status: row.status,
  item: row.item_id,
  amount: row.amount,
  payTo: row.pay_to,
  txHash: row.paid_tx,
})

const resourceRoute = (database: QueryDatabaseClient, origin: string, settlement: Option.Option<Settlement>) =>
  HttpRouter.route(
    'GET',
    '/api/i/:invoiceId',
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      // The ≈ 12.7 KB permission context does not fit Cloudflare's per-header margin, so payment goes in a POST body.
      if (request.headers['payment-signature'] !== undefined)
        return yield* jsonError(415, 'use POST /api/invoices/:id/pay')
      const { invoiceId } = yield* HttpRouter.params
      const found = yield* readInvoice(database, invoiceId ?? '')
      if (Option.isNone(found)) return yield* jsonError(404, 'unknown invoice')
      const row = found.value
      if (row.status === 'paid' || row.status === 'used') return yield* json(paidBody(row))
      if (row.status === 'expired') return yield* jsonError(410, 'invoice expired', { invoiceId: row.id })
      if (Option.isNone(settlement)) return yield* notConfigured('RELAYER_PRIVATE_KEY')
      const body = paymentRequired(row, origin, settlement.value.relayer)
      return yield* json(body, 402, { [PAYMENT_REQUIRED_HEADER]: Base64.encode(JSON.stringify(body)) })
    }),
  )

const failure = (status: number, errorReason: string, checks: ReadonlyArray<Check> = []) =>
  json({ success: false, errorReason, checks }, status)

const sameHex = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

/** The client echoes `accepts[0]`; what it pays for must be what this invoice asks for. */
const sameRequirements = (accepted: PaymentRequirements, required: PaymentRequirements) =>
  sameHex(accepted.asset, required.asset) &&
  sameHex(accepted.payTo, required.payTo) &&
  accepted.amount === required.amount &&
  sameHex(accepted.extra.invoiceHash, required.extra.invoiceHash) &&
  accepted.extra.invoiceId === required.extra.invoiceId

const payRoute = (database: QueryDatabaseClient, origin: string, settlement: Option.Option<Settlement>) =>
  HttpRouter.route(
    'POST',
    '/api/invoices/:invoiceId/pay',
    Effect.gen(function* () {
      if (Option.isNone(settlement)) return yield* notConfigured('RELAYER_PRIVATE_KEY')
      const { invoiceId } = yield* HttpRouter.params
      const found = yield* readInvoice(database, invoiceId ?? '')
      if (Option.isNone(found)) return yield* jsonError(404, 'unknown invoice')
      const row = found.value
      if (row.status === 'paid' || row.status === 'used') return yield* failure(409, 'already settled')
      if (row.status === 'expired') return yield* failure(400, 'invoice expired')
      const body = yield* HttpServerRequest.schemaBodyJson(PayRequest).pipe(Effect.option)
      if (Option.isNone(body)) return yield* failure(400, 'expected {"paymentPayload": x402 v2 exact/erc7710}')
      const invoice = toInvoice(row, origin)
      const requirements = requirementsFor(invoice, settlement.value.relayer)
      if (!sameRequirements(body.value.paymentPayload.accepted, requirements))
        return yield* failure(400, 'accepted requirements differ from the invoice')
      return yield* settlement.value.settle({ invoice, requirements, payment: body.value.paymentPayload }).pipe(
        Effect.flatMap((success) =>
          json(success, 200, { [PAYMENT_RESPONSE_HEADER]: Base64.encode(JSON.stringify(success)) }),
        ),
        Effect.catchTags({
          SettlementRejected: ({ reason, checks }) => failure(400, reason, checks),
          AlreadySettled: () => failure(409, 'already settled'),
        }),
      )
    }),
  )

/** `GET /api/i/:id` (402 or the paid resource) and `POST /api/invoices/:id/pay`. */
export const x402Routes = (database: QueryDatabaseClient, origin: string, settlement: Option.Option<Settlement>) =>
  HttpRouter.addAll([resourceRoute(database, origin, settlement), payRoute(database, origin, settlement)])
