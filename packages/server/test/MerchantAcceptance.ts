import { expect } from 'bun:test'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Result, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'

/** The native test binds these two fixed test addresses (never funded, never used on a chain). */
export const TEST_MERCHANT_PAY_TO = '0x000000000000000000000000000000000000c0de'
export const TEST_RESTRICTED_PAY_TO = '0x000000000000000000000000000000000000dead'
/** A fixed test-only Ed25519 seed for the gate. */
export const TEST_GATE_SEED = '0x' + '42'.repeat(32)

type Urls = { readonly appUrl: string; readonly url: string }

const CreatedInvoice = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  payTo: Schema.String,
  amount: Schema.String,
  expiresAt: Schema.Finite,
  invoiceHash: Schema.String,
  restricted: Schema.Boolean,
})
const SignedStatus = Schema.Struct({
  invoiceId: Schema.String,
  status: Schema.String,
  nonce: Schema.String,
  expiresAt: Schema.Finite,
  sig: Schema.String,
})
const GateKey = Schema.Struct({ alg: Schema.Literal('ed25519'), publicKey: Schema.String })

const verifyStatus = (publicKey: string, status: typeof SignedStatus.Type) =>
  Effect.promise(async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(Result.getOrThrow(Base64.decode(publicKey))),
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    const message = `${status.invoiceId}|${status.status}|${status.nonce}|${status.expiresAt}`
    return crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      Uint8Array.from(Result.getOrThrow(Base64.decode(status.sig))),
      new TextEncoder().encode(message),
    )
  })

const readStatus = (appUrl: string, id: string, nonce: string) =>
  HttpClient.get(`${appUrl}/api/invoices/${id}/status?nonce=${nonce}`).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(SignedStatus)),
  )

/** M3 acceptance: invoice → 402 with PAYMENT-REQUIRED → signed `pending` → forced `paid` reads `paid` once, then `used`. */
export const registerMerchantAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>) =>
  test(
    'merchant: invoice, x402 402, Ed25519 gate status and the paid → used flip',
    Effect.gen(function* () {
      const { appUrl, url } = yield* stack
      const items = yield* HttpClient.get(`${appUrl}/api/merchants/duck-cafe/items`)
      expect(items.status).toBe(200)
      const created = yield* HttpClient.post(`${appUrl}/api/merchants/duck-cafe/invoices`, {
        body: HttpBody.text(JSON.stringify({ itemId: 'chai' }), 'application/json'),
      })
      expect(created.status).toBe(201)
      const invoice = yield* Schema.decodeUnknownEffect(CreatedInvoice)(yield* created.json)
      expect(invoice).toMatchObject({ amount: '100000', payTo: TEST_MERCHANT_PAY_TO, restricted: false })
      expect(invoice.id).toMatch(/^[a-z2-7]{26}$/)
      expect(invoice.url).toBe(`${appUrl}/api/i/${invoice.id}`)

      const required = yield* HttpClient.get(`${appUrl}/api/i/${invoice.id}`)
      const header = required.headers['payment-required']
      const body: unknown = yield* required.json
      // Without a relayer key the native stack answers 503 "not configured"; with one, the 402 of §7.
      if (required.status === 402) {
        expect(header).toBeDefined()
        expect(JSON.parse(Result.getOrThrow(Base64.decodeString(header ?? '')))).toEqual(body)
        expect(body).toMatchObject({ x402Version: 2, error: 'payment-required', accepts: [{ amount: '100000' }] })
      } else expect(body).toEqual({ error: 'not configured: RELAYER_PRIVATE_KEY' })

      const key = yield* HttpClient.get(`${appUrl}/api/merchants/duck-cafe/gate-key`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(GateKey)),
      )
      const pending = yield* readStatus(appUrl, invoice.id, 'abc')
      expect(pending).toMatchObject({ invoiceId: invoice.id, status: 'pending', nonce: 'abc' })
      expect(yield* verifyStatus(key.publicKey, pending)).toBe(true)
      expect(yield* verifyStatus(key.publicKey, { ...pending, status: 'paid' })).toBe(false)

      const forced = yield* HttpClient.post(`${url}/test/merchant/invoices/${invoice.id}/force-paid`)
      expect(forced.status).toBe(204)
      const first = yield* readStatus(appUrl, invoice.id, 'n1')
      const second = yield* readStatus(appUrl, invoice.id, 'n2')
      expect([first.status, second.status]).toEqual(['paid', 'used'])
      expect(yield* verifyStatus(key.publicKey, first)).toBe(true)
      expect(yield* verifyStatus(key.publicKey, second)).toBe(true)

      const badNonce = yield* HttpClient.get(`${appUrl}/api/invoices/${invoice.id}/status?nonce=a|b`)
      expect(badNonce.status).toBe(400)
      const signatureHeader = yield* HttpClient.get(`${appUrl}/api/i/${invoice.id}`, {
        headers: { 'payment-signature': 'x' },
      })
      expect(signatureHeader.status).toBe(415)
    }).pipe(Effect.provide(FetchHttpClient.layer)),
    { timeout: 60000 },
  )
