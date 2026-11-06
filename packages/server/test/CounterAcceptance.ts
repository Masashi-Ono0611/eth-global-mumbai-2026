import { expect } from 'bun:test'
import { IntentView } from '@ethmumbai/protocol/Intent'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Schema } from 'effect'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import { DEMO_CAPS, freshConnections } from './AgentSamples.ts'
import { makeSoftwareAuthenticator, registerPasskey, sessionCookie } from './PasskeyFixture.ts'
import { errandView, postTo, SentDecide, TEST_ZG_MODEL, type ZeroGStub } from './RobotAcceptance.ts'
import { scanErrand, seedScanningRobot } from './ScanAcceptance.ts'

// The café counter (spec §7): the till puts one invoice on the ESP32's screen (`POST …/counter`), the screen pulls it
// (`GET …/counter`, compact JSON it string-matches), and a real robot's owner intent ("get me a chai") reaches 0G's
// decide when the chip scans that screen. Both tests need SCANS_ENABLED (intents and scans), so they run after the
// restart test; run them alone with `-t "restart|counter"`.

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

const Started = Schema.Struct({ episodeId: Schema.String, state: Schema.String })

/** Twelve minutes: past the 10-minute window an intent waits for its scan. */
const PAST_THE_WINDOW_MS = 12 * 60_000

/** A signed-in owner of chip robots on the demo grant, and the calls the three beats make. */
const counterOwner = (urls: Urls, stub: ZeroGStub) =>
  Effect.gen(function* () {
    const { appUrl, url, apiUrl } = urls
    const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator())
    const { response } = yield* registerPasskey(appUrl, authenticator, 'Counter Owner')
    const { accountId } = yield* Schema.decodeUnknownEffect(Schema.Struct({ accountId: Schema.String }))(
      yield* response.json,
    )
    const cookie = sessionCookie(response)
    // Owner calls that wait on the brain go straight to the API Worker with the app's Origin.
    const asOwner = (path: string, body: unknown) =>
      HttpClient.post(`${apiUrl}${path}`, {
        headers: { origin: new URL(appUrl).origin, cookie },
        body: HttpBody.text(JSON.stringify(body), 'application/json'),
      }).pipe(Effect.flatMap((answer) => Effect.map(answer.json, (json) => ({ status: answer.status, json }))))
    const ask = (robotId: string, item: string) =>
      asOwner(`/api/robots/${robotId}/intents`, { instruction: `Get me a ${item}`, item }).pipe(
        Effect.tap(({ status }) => Effect.sync(() => expect(status).toBe(201))),
        Effect.flatMap(({ json }) => Schema.decodeUnknownEffect(IntentView)(json)),
      )
    const intentOf = (robotId: string, intentId: string) =>
      HttpClient.get(`${appUrl}/api/robots/${robotId}/intents/${intentId}`, { headers: { cookie } }).pipe(
        Effect.flatMap((read) => read.json),
        Effect.flatMap(Schema.decodeUnknownEffect(IntentView)),
      )
    const age = (intentId: string) =>
      postTo(url)(`/test/vq/intents/${intentId}/age`, { millis: PAST_THE_WINDOW_MS }).pipe(
        Effect.tap((aged) => Effect.sync(() => expect(aged.status).toBe(204))),
      )
    const lastSent = Effect.suspend(() => Schema.decodeUnknownEffect(SentDecide)(stub.seen.at(-1)?.body)).pipe(
      Effect.map((sent) => sent.messages[1].content),
    )
    /** A fresh robot: the owner asks, the till shows `shown`, the chip scans the screen's invoice. */
    const beat = (asked: string, shown: string) =>
      Effect.gen(function* () {
        const robot = yield* seedScanningRobot(url, accountId, DEMO_CAPS)
        const intent = yield* ask(robot.robotId, asked)
        expect(intent).toMatchObject({ state: 'running', item: asked, episodeId: null, turns: [] })
        const invoice = yield* Schema.decodeUnknownEffect(Minted)(yield* place(appUrl, shown))
        expect(yield* screen(appUrl)).toContain(`"id":"${invoice.id}"`)
        const started = yield* scanErrand({ apiUrl, ...robot, invoiceId: invoice.id })
        expect(yield* lastSent).toMatchObject({
          requested: asked,
          catalogue: { itemId: shown },
          owner: { instruction: `Get me a ${asked}`, item: asked },
        })
        return { robotId: robot.robotId, intent, invoice, started }
      })
    return { accountId, cookie, asOwner, ask, intentOf, age, beat }
  })
type CounterOwner = Effect.Success<ReturnType<typeof counterOwner>>

/** Asked for chai, shown samosa: walk away, the intent ends with its errand; the next one waits 10 minutes for a scan. */
const mismatch = (owner: CounterOwner) =>
  Effect.gen(function* () {
    const samosa = yield* owner.beat('chai', 'samosa')
    expect(samosa.started.state).toBe('walked_away')
    expect(yield* owner.intentOf(samosa.robotId, samosa.intent.id)).toMatchObject({
      state: 'finished',
      episodeId: samosa.started.episodeId,
      episodeState: 'walked_away',
      reason: 'errand walked_away',
    })
    const waiting = yield* owner.ask(samosa.robotId, 'chai')
    expect(yield* owner.asOwner(`/api/robots/${samosa.robotId}/intents`, { instruction: 'and a samosa' })).toEqual({
      status: 409,
      json: { error: 'this robot already has an open errand intent' },
    })
    yield* owner.age(waiting.id)
    expect(yield* owner.intentOf(samosa.robotId, waiting.id)).toMatchObject({
      state: 'expired',
      reason: 'no scan within 10 minutes',
    })
    // Asked for chai, shown a thali: not what the owner asked for comes first (decision table row 1), so no approval.
    expect((yield* owner.beat('chai', 'thali')).started.state).toBe('walked_away')
  })

/** Asked for a thali, over the 1.00 per-payment cap: World approval; the scanned intent follows its errand. */
const overCap = (owner: CounterOwner) =>
  Effect.gen(function* () {
    const thali = yield* owner.beat('thali', 'thali')
    expect(thali.started.state).toBe('awaiting_approval')
    yield* owner.age(thali.intent.id)
    expect(yield* owner.intentOf(thali.robotId, thali.intent.id)).toMatchObject({
      state: 'scanned',
      episodeState: 'awaiting_approval',
    })
    expect((yield* owner.asOwner(`/api/robots/${thali.robotId}/intents`, { instruction: 'a chai' })).status).toBe(409)
  })

/** Asked for chai, shown chai: the chip signs the counter's invoice; "buy chai" also pays exactly the shown one. */
const match = (urls: Urls, owner: CounterOwner) =>
  Effect.gen(function* () {
    const chai = yield* owner.beat('chai', 'chai')
    expect(chai.started.state).toBe('signing')
    const signing = yield* errandView(urls.appUrl, owner.cookie, chai.robotId, chai.started.episodeId)
    expect(signing.episode.invoice_id).toBe(chai.invoice.id)
    expect(yield* owner.intentOf(chai.robotId, chai.intent.id)).toMatchObject({
      state: 'scanned',
      episodeState: 'signing',
    })
    // Being displayed does not claim an invoice: the conversation's Buy (/errands) takes it as the counter's open one.
    const buyer = yield* seedScanningRobot(urls.url, owner.accountId, DEMO_CAPS)
    const shown = yield* Schema.decodeUnknownEffect(Minted)(yield* place(urls.appUrl, 'chai'))
    const bought = yield* owner.asOwner(`/api/robots/${buyer.robotId}/errands`, { item: 'chai' })
    expect(bought.status).toBe(201)
    const errand = yield* Schema.decodeUnknownEffect(Started)(bought.json)
    expect(errand.state).toBe('signing')
    const paying = yield* errandView(urls.appUrl, owner.cookie, buyer.robotId, errand.episodeId)
    expect(paying.episode.invoice_id).toBe(shown.id)
  })

const SentModel = Schema.Struct({ model: Schema.String })
const Brains = Schema.Struct({ brains: Schema.Array(Schema.Struct({ model: Schema.String, tee: Schema.Boolean })) })
const ErrandModels = Schema.Struct({
  episode: Schema.Struct({ model: Schema.NullOr(Schema.String) }),
  decisions: Schema.Array(Schema.Struct({ model: Schema.String })),
})

/**
 * The owner picks the brain per message (Kris, 7 Nov): an intent's model reaches the decide of the scan that claims it,
 * an errand's model its own decide; a model off the allowlist is 400; without one, ZG_MODEL.
 */
const brainPerMessage = (urls: Urls, owner: CounterOwner, stub: ZeroGStub) =>
  Effect.gen(function* () {
    const read = <A>(path: string, schema: Schema.Decoder<A>) =>
      HttpClient.get(`${urls.appUrl}${path}`, { headers: { cookie: owner.cookie } }).pipe(
        Effect.flatMap((answer) => answer.json),
        Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      )
    const sentModel = Effect.suspend(() => Schema.decodeUnknownEffect(SentModel)(stub.seen.at(-1)?.body)).pipe(
      Effect.map((sent) => sent.model),
    )
    const scanning = yield* seedScanningRobot(urls.url, owner.accountId, DEMO_CAPS)
    expect((yield* read(`/api/robots/${scanning.robotId}`, Brains)).brains).toEqual([
      { model: TEST_ZG_MODEL, tee: true },
      { model: 'qwen3-vl-plus', tee: false },
    ])
    const intents = `/api/robots/${scanning.robotId}/intents`
    const allowlist = { error: `model must be one of: ${TEST_ZG_MODEL}, qwen3-vl-plus` }
    expect(yield* owner.asOwner(intents, { instruction: 'Get me a chai', item: 'chai', model: 'gpt-4o' })).toEqual({
      status: 400,
      json: allowlist,
    })
    const asked = yield* owner.asOwner(intents, { instruction: 'Get me a chai', item: 'chai', model: 'qwen3-vl-plus' })
    expect(asked.status).toBe(201)
    expect(yield* Schema.decodeUnknownEffect(IntentView)(asked.json)).toMatchObject({ model: 'qwen3-vl-plus' })
    const invoice = yield* Schema.decodeUnknownEffect(Minted)(yield* place(urls.appUrl, 'chai'))
    const scanned = yield* scanErrand({ apiUrl: urls.apiUrl, ...scanning, invoiceId: invoice.id })
    expect(yield* sentModel).toBe('qwen3-vl-plus')
    expect(yield* read(`/api/robots/${scanning.robotId}/errands/${scanned.episodeId}`, ErrandModels)).toEqual({
      episode: { model: 'qwen3-vl-plus' },
      decisions: [{ model: 'qwen3-vl-plus' }],
    })
    // The conversation's Buy: the errand route takes the same field; the next message without one is ZG_MODEL again.
    const picked = yield* seedScanningRobot(urls.url, owner.accountId, DEMO_CAPS)
    const errands = `/api/robots/${picked.robotId}/errands`
    expect(yield* owner.asOwner(errands, { item: 'chai', model: 'glm-9' })).toEqual({ status: 400, json: allowlist })
    const bought = yield* owner.asOwner(errands, { item: 'chai', model: 'qwen3-vl-plus' })
    expect(bought.status).toBe(201)
    expect(yield* sentModel).toBe('qwen3-vl-plus')
    const plain = yield* seedScanningRobot(urls.url, owner.accountId, DEMO_CAPS)
    const defaulted = yield* owner.asOwner(`/api/robots/${plain.robotId}/errands`, { item: 'chai' })
    expect(defaulted.status).toBe(201)
    expect(yield* sentModel).toBe(TEST_ZG_MODEL)
    const started = yield* Schema.decodeUnknownEffect(Started)(defaulted.json)
    expect(yield* read(`/api/robots/${plain.robotId}/errands/${started.episodeId}`, ErrandModels)).toEqual({
      episode: { model: null },
      decisions: [{ model: TEST_ZG_MODEL }],
    })
  })

export const registerChipIntentAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>, stub: ZeroGStub) =>
  test(
    "counter: a chip robot's owner intent waits for the scan of the counter's invoice, and decide compares it with what was asked",
    Effect.gen(function* () {
      const urls = yield* stack
      const owner = yield* counterOwner(urls, stub)
      stub.setMode('table')
      yield* mismatch(owner)
      yield* overCap(owner)
      yield* match(urls, owner)
      yield* brainPerMessage(urls, owner, stub)
      stub.setMode('pay')
    }).pipe(Effect.provide(freshConnections)),
    { timeout: 120000 },
  )
