import { Clock, Effect, Option, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

// The till's view of the merchant API (docs/hardware-handoff.md §6). Requests are same-origin: this app's Worker
// forwards /api/* to the app. The till never reads the signed gate status: its first `paid` read belongs to the
// counter screen (the ESP32), which opens on it.

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

export const Status = Schema.Literals(['pending', 'paid', 'used', 'expired'])
export type Status = typeof Status.Type

/** The invoice on the counter screen, as `GET …/counter/latest` reports it (`expiresAt` in unix seconds). */
export const CounterInvoice = Schema.Struct({
  id: Schema.String,
  itemId: Schema.String,
  name: Schema.String,
  amount: Schema.String,
  expiresAt: Schema.Finite,
  status: Status,
})
export type CounterInvoice = typeof CounterInvoice.Type

const Latest = Schema.Struct({ invoice: Schema.NullOr(CounterInvoice) })
const Minted = Schema.Struct({ id: Schema.String, amount: Schema.String, expiresAt: Schema.Finite })
const ErrorBody = Schema.Struct({ error: Schema.String })

/** How long one read of the screen or one tap may take before the till says the app did not answer. */
const ANSWER_MILLIS = 10_000

/** What the till can tell the person at the counter when a request fails. */
class TillFailure extends Schema.TaggedError<TillFailure>()('TillFailure', { reason: Schema.String }) {}

const call = <S extends Schema.Constraint>(request: HttpClientRequest.HttpClientRequest, schema: S) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const response = yield* client.execute(request).pipe(
      Effect.timeout(ANSWER_MILLIS),
      Effect.mapError(() => TillFailure.make({ reason: 'The app did not answer.' })),
    )
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

/** Mint an invoice for `item` and put it on the counter screen; `placedAt` is when the app had stored it. */
export const placeOnCounter = (merchantId: string, item: Item) =>
  call(
    HttpClientRequest.post(`/api/merchants/${merchantId}/counter`).pipe(
      HttpClientRequest.bodyJsonUnsafe({ itemId: item.itemId }),
    ),
    Minted,
  ).pipe(
    Effect.map(({ id, amount, expiresAt }): CounterInvoice => ({
      id,
      itemId: item.itemId,
      name: item.name,
      amount,
      expiresAt,
      status: 'pending',
    })),
    Effect.flatMap((invoice) => Effect.map(Clock.currentTimeMillis, (placedAt) => ({ invoice, placedAt }))),
  )

/** What the counter screen shows, in any status; `askedAt` is when the read began. */
export const readCounter = (merchantId: string) =>
  Effect.gen(function* () {
    const askedAt = yield* Clock.currentTimeMillis
    const { invoice } = yield* call(HttpClientRequest.get(`/api/merchants/${merchantId}/counter/latest`), Latest)
    return { maybeInvoice: Option.fromNullishOr(invoice), askedAt }
  })

/** `"250000"` (base units) → `"0.25"`. */
export const usdc = (amount: string) => {
  const units = BigInt(amount)
  const cents = (units % 1_000_000n).toString().padStart(6, '0').slice(0, 2)
  return `${units / 1_000_000n}.${cents}`
}
