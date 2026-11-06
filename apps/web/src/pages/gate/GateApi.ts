import { Effect, Option, Result, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as Base64Url from 'effect/encoding/Base64Url'
import { getJson, postJson } from '../../api/Http.ts'

// The merchant's public API as the gate and the merchant page use it (spec §7). The browser verifies every status
// itself with WebCrypto Ed25519 against the merchant's gate key: the page never trusts an unsigned "paid".

export const MerchantInvoice = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  merchantId: Schema.String,
  payTo: Schema.String,
  amount: Schema.String,
  expiresAt: Schema.Finite,
  invoiceHash: Schema.String,
  restricted: Schema.Boolean,
})
export type MerchantInvoice = typeof MerchantInvoice.Type

export const InvoiceStatus = Schema.Literals(['pending', 'paid', 'used', 'expired'])
export type InvoiceStatus = typeof InvoiceStatus.Type

const SignedStatus = Schema.Struct({
  invoiceId: Schema.String,
  status: InvoiceStatus,
  nonce: Schema.String,
  expiresAt: Schema.Finite,
  sig: Schema.String,
})
const GateKey = Schema.Struct({ alg: Schema.Literal('ed25519'), publicKey: Schema.String })

export const createInvoice = (merchantId: string, itemId: string) =>
  postJson(`/api/merchants/${merchantId}/invoices`, { itemId }, MerchantInvoice)

export const loadGateKey = (merchantId: string) =>
  getJson(`/api/merchants/${merchantId}/gate-key`, GateKey).pipe(Effect.map(({ publicKey }) => publicKey))

/** A fresh challenge per read, so a recorded "paid" answer can never be replayed to the gate. */
const freshNonce = Effect.sync(() => Base64Url.encode(crypto.getRandomValues(new Uint8Array(12))))

const bytesOf = (base64: string) => Option.getOrUndefined(Result.getSuccess(Base64.decode(base64)))

/** Ed25519 over UTF-8 `<invoiceId>|<status>|<nonce>|<expiresAt>` with the gate key; false on any malformed input. */
const verify = (publicKey: string, status: typeof SignedStatus.Type) => {
  const key = bytesOf(publicKey)
  const signature = bytesOf(status.sig)
  if (key === undefined || signature === undefined) return Effect.succeed(false)
  const message = new TextEncoder().encode(`${status.invoiceId}|${status.status}|${status.nonce}|${status.expiresAt}`)
  return Effect.tryPromise(async () => {
    const imported = await crypto.subtle.importKey('raw', Uint8Array.from(key), { name: 'Ed25519' }, false, ['verify'])
    return crypto.subtle.verify({ name: 'Ed25519' }, imported, Uint8Array.from(signature), message)
  }).pipe(Effect.orElseSucceed(() => false))
}

/** One gate read: the status only counts when the signature verifies and echoes our nonce. */
export const readSignedStatus = (invoiceId: string, publicKey: string) =>
  Effect.gen(function* () {
    const nonce = yield* freshNonce
    const status = yield* getJson(`/api/invoices/${invoiceId}/status?nonce=${nonce}`, SignedStatus)
    const verified = status.nonce === nonce && status.invoiceId === invoiceId && (yield* verify(publicKey, status))
    return { status: status.status, verified }
  })
