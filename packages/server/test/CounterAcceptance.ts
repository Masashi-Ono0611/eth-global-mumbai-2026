import { expect } from 'bun:test'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import { freshConnections } from './AgentSamples.ts'
import { postTo } from './RobotAcceptance.ts'

// The café counter (spec §7): the till puts one invoice on the ESP32's screen (`POST …/counter`), the screen pulls it
// (`GET …/counter`, compact JSON it string-matches) and the till reads it in any status (`GET …/counter/latest`).
// Run it alone with `-t "counter"`.

type Urls = { readonly appUrl: string; readonly url: string; readonly apiUrl: string }

const COUNTER = '/api/merchants/duck-cafe/counter'

const Minted = Schema.Struct({ id: Schema.String, expiresAt: Schema.Finite })
const Body = Schema.Record(Schema.String, Schema.Unknown)
const Latest = Schema.Struct({
  invoice: Schema.NullOr(Schema.Struct({ id: Schema.String, status: Schema.String })),
})

/** The till's tap: mint and display; the 201 body is the mint's, key for key. */
const place = (appUrl: string, itemId: string) =>
  postTo(appUrl)(COUNTER, { itemId }).pipe(
    Effect.tap((placed) => Effect.sync(() => expect(placed.status).toBe(201))),
    Effect.flatMap((placed) => placed.json),
  )

/** What the ESP32 reads, as the bytes it string-matches. */
const screen = (appUrl: string) =>
  HttpClient.get(`${appUrl}${COUNTER}`).pipe(
    Effect.tap((read) =>
      Effect.sync(() => {
        expect(read.status).toBe(200)
        expect(read.headers['cache-control']).toBe('no-store')
      }),
    ),
    Effect.flatMap((read) => read.text),
  )

const latest = (appUrl: string) =>
  HttpClient.get(`${appUrl}${COUNTER}/latest`).pipe(
    Effect.flatMap((read) => read.json),
    Effect.flatMap(Schema.decodeUnknownEffect(Latest)),
    Effect.map(({ invoice }) => invoice),
  )

const shownText = (id: string, item: { itemId: string; name: string; amount: string }, expiresAt: number) =>
  `{"invoice":{"id":"${id}","itemId":"${item.itemId}","name":"${item.name}","amount":"${item.amount}","expiresAt":${expiresAt},"status":"pending"}}`

const CHAI = { itemId: 'chai', name: 'Chai', amount: '100000' }
const SAMOSA = { itemId: 'samosa', name: 'Samosa', amount: '250000' }
const NOTHING = '{"invoice":null}'

export const registerCounterAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>) =>
  test(
    'counter: the till puts one invoice on the ESP32 screen, POST /invoices never changes it, null once paid, expired or under 60 s left',
    Effect.gen(function* () {
      const { appUrl, url } = yield* stack
      const chai = yield* place(appUrl, 'chai')
      const minted = yield* Schema.decodeUnknownEffect(Body)(
        yield* (yield* postTo(appUrl)('/api/merchants/duck-cafe/invoices', { itemId: 'chai' })).json,
      )
      expect(Object.keys(yield* Schema.decodeUnknownEffect(Body)(chai)).toSorted()).toEqual(
        Object.keys(minted).toSorted(),
      )
      const shownChai = yield* Schema.decodeUnknownEffect(Minted)(chai)
      expect(yield* screen(appUrl)).toBe(shownText(shownChai.id, CHAI, shownChai.expiresAt))

      // The sim's stalls and the web gate mint through POST /invoices: the screen keeps the till's invoice.
      expect((yield* postTo(appUrl)('/api/merchants/duck-cafe/invoices', { itemId: 'samosa' })).status).toBe(201)
      expect(yield* screen(appUrl)).toBe(shownText(shownChai.id, CHAI, shownChai.expiresAt))

      // A second tap replaces it; paid, the screen is empty and the till reads paid, then used after the gate's read.
      const samosa = yield* Schema.decodeUnknownEffect(Minted)(yield* place(appUrl, 'samosa'))
      expect(yield* screen(appUrl)).toBe(shownText(samosa.id, SAMOSA, samosa.expiresAt))
      expect(yield* latest(appUrl)).toEqual({ id: samosa.id, status: 'pending' })
      expect((yield* postTo(url)(`/test/vq/invoices/${samosa.id}/force-paid`, {})).status).toBe(204)
      expect(yield* screen(appUrl)).toBe(NOTHING)
      expect(yield* latest(appUrl)).toEqual({ id: samosa.id, status: 'paid' })
      const gate = yield* HttpClient.get(`${appUrl}/api/invoices/${samosa.id}/status?nonce=counter1`)
      expect(yield* gate.json).toMatchObject({ invoiceId: samosa.id, status: 'paid', nonce: 'counter1' })
      expect(yield* latest(appUrl)).toEqual({ id: samosa.id, status: 'used' })

      // Under 60 s left the chip and scans refuse it, so the screen drops it; past its expiry the till reads expired.
      const thali = yield* Schema.decodeUnknownEffect(Minted)(yield* place(appUrl, 'thali'))
      expect(yield* screen(appUrl)).toContain(`"id":"${thali.id}","itemId":"thali"`)
      expect((yield* postTo(url)(`/test/vq/invoices/${thali.id}/expire`, { inSeconds: 59 })).status).toBe(204)
      expect(yield* screen(appUrl)).toBe(NOTHING)
      expect(yield* latest(appUrl)).toEqual({ id: thali.id, status: 'pending' })
      expect((yield* postTo(url)(`/test/vq/invoices/${thali.id}/expire`, {})).status).toBe(204)
      expect(yield* screen(appUrl)).toBe(NOTHING)
      expect(yield* latest(appUrl)).toEqual({ id: thali.id, status: 'expired' })

      // The mint's refusals, unchanged; no Origin and no session on any of these calls.
      const refused = (path: string, body: unknown) =>
        postTo(appUrl)(path, body).pipe(
          Effect.flatMap((answer) => Effect.map(answer.json, (json) => ({ status: answer.status, json }))),
        )
      expect(yield* refused(COUNTER, { itemId: 'cake' })).toEqual({ status: 404, json: { error: 'unknown item' } })
      expect(yield* refused(COUNTER, { item: 'chai' })).toEqual({
        status: 400,
        json: { error: 'expected {"itemId": string}' },
      })
      expect(yield* refused('/api/merchants/nowhere/counter', { itemId: 'chai' })).toMatchObject({ status: 404 })
      expect((yield* HttpClient.get(`${appUrl}/api/merchants/nowhere/counter`)).status).toBe(404)
      expect(yield* latest(appUrl)).toEqual({ id: thali.id, status: 'expired' })
    }).pipe(Effect.provide(freshConnections)),
    { timeout: 60000 },
  )
