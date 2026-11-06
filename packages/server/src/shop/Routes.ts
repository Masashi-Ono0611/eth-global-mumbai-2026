import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ArcClient } from '@ethmumbai/chain/Arc'
import { ARC_CHAIN_ID } from '@ethmumbai/protocol/Invoice'
import { Effect, Option } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { renderSVG } from 'uqr'
import { json, jsonError } from '../Respond.ts'
import { createOrder, type OrderRow, readOrder, scanPayments, stock } from './Orders.ts'
import { formatAmount, KITS, OrderBody, paymentRequest, SHOP_PAY_TO } from './Shop.ts'

export type ShopDeps = {
  readonly database: QueryDatabaseClient
  readonly arc: Option.Option<ArcClient>
}

/** What the buyer's page needs to pay and to follow the order; never the shipping details. */
const orderView = (order: OrderRow) => {
  const units = BigInt(order.amount)
  return {
    id: order.id,
    kit: order.kit,
    kitName: KITS[order.kit].name,
    pay: order.pay,
    founding: order.founding === 1,
    amount: order.amount,
    usdc: formatAmount(units),
    payTo: SHOP_PAY_TO,
    chainId: ARC_CHAIN_ID,
    paymentRequest: paymentRequest(units),
    status: order.status,
    paidTx: order.paid_tx,
    expiresAt: order.expires_at,
  }
}

const orderId = Effect.map(HttpRouter.params, ({ orderId: id }) => id ?? '')

/**
 * The shop's API, apart from the robot payment flow: nothing here signs, settles or touches an errand.
 * - `POST /api/shop/orders` {kit, pay, email, name, address, country} → 201 the order with its exact amount
 * - `GET /api/shop/orders/:id` → the order, after one look at Arc while it is unpaid
 * - `GET /api/shop/orders/:id/qr.svg` → the payment request as a QR code
 * - `GET /api/shop/stock` → founding spots left per kit
 */
export const shopRoutes = (deps: ShopDeps) =>
  HttpRouter.addAll([
    HttpRouter.route(
      'POST',
      '/api/shop/orders',
      Effect.gen(function* () {
        const body = yield* HttpServerRequest.schemaBodyJson(OrderBody).pipe(Effect.option)
        if (Option.isNone(body)) return yield* jsonError(400, 'expected {kit, pay, email, name, address, country}')
        const order = yield* createOrder(deps.database, body.value)
        if (Option.isNone(order)) return yield* jsonError(503, 'busy, try again')
        return yield* json(orderView(order.value), 201)
      }),
    ),
    HttpRouter.route(
      'GET',
      '/api/shop/orders/:orderId',
      Effect.gen(function* () {
        const id = yield* orderId
        const before = yield* readOrder(deps.database, id)
        if (Option.isNone(before)) return yield* jsonError(404, 'unknown order')
        if (before.value.status === 'paid') return yield* json(orderView(before.value))
        yield* scanPayments(deps.database, deps.arc)
        const after = yield* readOrder(deps.database, id)
        return yield* json(orderView(Option.getOrElse(after, () => before.value)))
      }),
    ),
    HttpRouter.route(
      'GET',
      '/api/shop/orders/:orderId/qr.svg',
      Effect.gen(function* () {
        const order = yield* readOrder(deps.database, yield* orderId)
        if (Option.isNone(order)) return yield* jsonError(404, 'unknown order')
        const svg = renderSVG(paymentRequest(BigInt(order.value.amount)), { ecc: 'M', border: 2 })
        return HttpServerResponse.text(svg, { contentType: 'image/svg+xml' })
      }),
    ),
    HttpRouter.route(
      'GET',
      '/api/shop/stock',
      Effect.gen(function* () {
        yield* scanPayments(deps.database, deps.arc)
        return yield* json(yield* stock(deps.database))
      }),
    ),
  ])
