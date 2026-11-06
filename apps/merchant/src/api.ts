import { Effect, Option, Result, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as Base64Url from 'effect/encoding/Base64Url'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

// The till's view of the merchant API (frozen contract, docs/hardware-handoff.md §1). Requests are same-origin: this
// app's Worker forwards /api/* to the app. A status only counts once its Ed25519 signature verifies here.

export const Item = Schema.Struct({
  itemId: Schema.String,
  name: Schema.String,
  /** USDC base units (6 decimals) as a decimal string. */
  amount: Schema.String,
  restricted: Schema.Boolean,
})
export type Item = typeof Item.Type

export const Catalogue = Schema.Struct({ merchantId: Schema.String, name: Schema.String, items: Schema.Array(Item) })
export type Catalogue = typeof Catalogue.Type

export const Invoice = Schema.Struct({
  id: Schema.String,
  /** The x402 resource: GET answers 402 with the payment requirements. This is what the QR code carries. */
  url: Schema.String,
  amount: Schema.String,
  expiresAt: Schema.Finite,
})
export type Invoice = typeof Invoice.Type

export const Status = Schema.Literals(['pending', 'paid', 'used', 'expired'])
export type Status = typeof Status.Type

const SignedStatus = Schema.Struct({
  invoiceId: Schema.String,
  status: Status,
  nonce: Schema.String,
  expiresAt: Schema.Finite,
  sig: Schema.String,
})
const GateKey = Schema.Struct({ alg: Schema.Literal('ed25519'), publicKey: Schema.String })
const ErrorBody = Schema.Struct({ error: Schema.String })

/** What the till can tell the person at the counter when a request fails. */
class TillFailure extends Schema.TaggedError<TillFailure>()('TillFailure', { reason: Schema.String }) {}

const call = <S extends Schema.Constraint>(request: HttpClientRequest.HttpClientRequest, schema: S) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const response = yield* client
      .execute(request)
      .pipe(Effect.mapError(() => TillFailure.make({ reason: 'The app did not answer.' })))
    const body: unknown = yield* response.json.pipe(Effect.orElseSucceed(() => null))
    if (response.status >= 300) {
      const message = Schema.decodeUnknownOption(ErrorBody)(body).pipe(Option.map(({ error }) => error))
      return yield* TillFailure.make({ reason: Option.getOrElse(message, () => `HTTP ${response.status}`) })
    }
    return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(() => TillFailure.make({ reason: 'The app answered something unexpected.' })),
    )
  })

export const loadCatalogue = (merchantId: string) =>
  call(HttpClientRequest.get(`/api/merchants/${merchantId}/items`), Catalogue)

export const loadGateKey = (merchantId: string) =>
  call(HttpClientRequest.get(`/api/merchants/${merchantId}/gate-key`), GateKey).pipe(
    Effect.map(({ publicKey }) => publicKey),
  )

export const openInvoice = (merchantId: string, itemId: string) =>
  call(
    HttpClientRequest.post(`/api/merchants/${merchantId}/invoices`).pipe(HttpClientRequest.bodyJsonUnsafe({ itemId })),
    Invoice,
  )

const decoded = (base64: string) => Option.getOrUndefined(Result.getSuccess(Base64.decode(base64)))

/** Ed25519 over UTF-8 `<invoiceId>|<status>|<nonce>|<expiresAt>`; any malformed key or signature is a failed check. */
const signatureHolds = (publicKey: string, signed: typeof SignedStatus.Type) => {
  const key = decoded(publicKey)
  const signature = decoded(signed.sig)
  if (key === undefined || signature === undefined) return Effect.succeed(false)
  const text = `${signed.invoiceId}|${signed.status}|${signed.nonce}|${signed.expiresAt}`
  return Effect.tryPromise(async () => {
    const ed25519 = await crypto.subtle.importKey('raw', Uint8Array.from(key), { name: 'Ed25519' }, false, ['verify'])
    return crypto.subtle.verify('Ed25519', ed25519, Uint8Array.from(signature), new TextEncoder().encode(text))
  }).pipe(Effect.orElseSucceed(() => false))
}

/** One status read with a fresh nonce, so a recorded answer can't be replayed; `trusted` only if it verifies. */
export const readStatus = (invoiceId: string, publicKey: string) =>
  Effect.gen(function* () {
    const nonce = Base64Url.encode(crypto.getRandomValues(new Uint8Array(12)))
    const signed = yield* call(HttpClientRequest.get(`/api/invoices/${invoiceId}/status?nonce=${nonce}`), SignedStatus)
    const echoed = signed.nonce === nonce && signed.invoiceId === invoiceId
    return { status: signed.status, trusted: echoed && (yield* signatureHolds(publicKey, signed)) }
  })

/** `"250000"` (base units) → `"0.25"`. */
export const usdc = (amount: string) => {
  const units = BigInt(amount)
  const cents = (units % 1_000_000n).toString().padStart(6, '0').slice(0, 2)
  return `${units / 1_000_000n}.${cents}`
}
