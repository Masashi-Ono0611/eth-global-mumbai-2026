import { expect } from 'bun:test'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'

type Urls = { readonly appUrl: string }

const Order = Schema.Struct({
  id: Schema.String,
  kit: Schema.String,
  pay: Schema.String,
  founding: Schema.Boolean,
  amount: Schema.String,
  usdc: Schema.String,
  payTo: Schema.String,
  paymentRequest: Schema.String,
  status: Schema.String,
})
const Stock = Schema.Struct({
  full: Schema.Struct({ cap: Schema.Finite, left: Schema.Finite }),
  dev: Schema.Struct({ cap: Schema.Finite, left: Schema.Finite }),
})

const order = {
  kit: 'full',
  pay: 'reserve',
  email: 'buyer@example.com',
  name: 'A Buyer',
  address: '1 Duck Lane, Ljubljana',
  country: 'Slovenia',
}

/**
 * The shop through the edge, on real D1 (and the public Arc RPC, read only): an order gets a unique exact amount at
 * the founding price and takes a founding spot; reading it looks at Arc and keeps it pending; the QR is an SVG; a bad
 * body is 400 and an unknown order 404. The response never echoes the shipping details.
 */
export const registerShopAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>) =>
  test(
    'shop: orders with a unique exact amount on Arc, founding spots counted, no shipping details echoed',
    Effect.gen(function* () {
      const { appUrl } = yield* stack
      const before = yield* Schema.decodeUnknownEffect(Stock)(
        yield* (yield* HttpClient.get(`${appUrl}/api/shop/stock`)).json,
      )
      const post = (body: unknown) => HttpClient.post(`${appUrl}/api/shop/orders`, { body: HttpBody.jsonUnsafe(body) })
      const created = yield* post(order)
      expect(created.status).toBe(201)
      const text = JSON.stringify(yield* created.json)
      expect(text).not.toContain('Duck Lane')
      expect(text).not.toContain('buyer@example.com')
      const first = yield* Schema.decodeUnknownEffect(Order)(JSON.parse(text))
      expect(first).toMatchObject({ kit: 'full', pay: 'reserve', founding: true, status: 'pending' })
      expect(first.payTo).toBe('0x102b15E56A3a6869d0c8934296A61a091e877603')
      expect(BigInt(first.amount) > 50_000_000n && BigInt(first.amount) < 50_010_000n).toBe(true)
      expect(first.paymentRequest).toBe(
        `ethereum:${first.payTo}@5042?value=${BigInt(first.amount) * 1_000_000_000_000n}`,
      )
      const second = yield* Schema.decodeUnknownEffect(Order)(
        yield* (yield* post({ ...order, kit: 'dev', pay: 'full' })).json,
      )
      expect(second.amount).not.toBe(first.amount)
      expect(BigInt(second.amount) > 99_000_000n && BigInt(second.amount) < 99_010_000n).toBe(true)

      const read = yield* HttpClient.get(`${appUrl}/api/shop/orders/${first.id}`)
      expect(read.status).toBe(200)
      expect(yield* Schema.decodeUnknownEffect(Order)(yield* read.json)).toMatchObject({
        id: first.id,
        status: 'pending',
      })
      const qr = yield* HttpClient.get(`${appUrl}/api/shop/orders/${first.id}/qr.svg`)
      expect(qr.status).toBe(200)
      expect(qr.headers['content-type']).toContain('image/svg+xml')
      expect(yield* qr.text).toContain('<svg')

      const after = yield* Schema.decodeUnknownEffect(Stock)(
        yield* (yield* HttpClient.get(`${appUrl}/api/shop/stock`)).json,
      )
      expect(after.full.left).toBe(before.full.left - 1)
      expect(after.dev.left).toBe(before.dev.left - 1)
      expect((yield* post({ ...order, kit: 'mega' })).status).toBe(400)
      expect((yield* post({ ...order, email: 'not-an-email' })).status).toBe(400)
      expect((yield* HttpClient.get(`${appUrl}/api/shop/orders/nope`)).status).toBe(404)
    }).pipe(Effect.provide(FetchHttpClient.layer)),
    { timeout: 120000 },
  )
