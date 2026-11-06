import { expect } from 'bun:test'
import type { TestApi } from 'alchemy/Test/Bun'
import { TeeProof } from '@ethmumbai/protocol/Errand'
import { Effect, Schema } from 'effect'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import { keccak256, sha256, stringToHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { type Caps, freshConnections, grantRow, randomId, sampleGrant, SPEC_CAPS } from './AgentSamples.ts'
import { TEST_MERCHANT_PAY_TO } from './MerchantAcceptance.ts'
import { makeSoftwareAuthenticator, registerPasskey, sessionCookie } from './PasskeyFixture.ts'

type Urls = { readonly appUrl: string; readonly url: string; readonly apiUrl: string }
type StubMode = 'pay' | 'ask' | 'table' | 'timeout' | 'garbage'

/** The native stack binds these for the Robot Agent (test-only values; the stub never forwards anything). */
export const TEST_ZG_API_KEY = 'native-test-zg-key-0123456789'
export const TEST_ZG_MODEL = 'native-stub-model'
export const TEST_EVIDENCE_TOKEN = 'native-test-evidence-token-0123456789'

/** The stub provider's TEE key (throwaway, never funded): it signs each chat as a TeeML provider does. */
const teeAccount = privateKeyToAccount(keccak256(stringToHex('vitaquack native test tee signer')))
export const TEST_TEE_SIGNER = teeAccount.address
const notFound = () => new Response('not found', { status: 404 })
const teeSignature = async (chatId: string) => {
  const text = `zg-sig-v1/e2ee-ct:${sha256(stringToHex(`${chatId}/request`)).slice(2)}:${sha256(stringToHex(`${chatId}/response`)).slice(2)}`
  const signature = await teeAccount.signMessage({ message: text })
  return { text, signature, signing_address: teeAccount.address.toLowerCase(), signing_algo: 'ecdsa' }
}

const ASK_OWNER = { action: 'ask_human', reason: 'over the per-payment limit; the owner approves it in World App' }
const SentInput = Schema.Struct({
  requested: Schema.String,
  catalogue: Schema.Struct({ itemId: Schema.String }),
  invoice: Schema.Struct({ amount: Schema.String }),
  budget: Schema.Struct({ remainingToday: Schema.String }),
  policy: Schema.Struct({ approvalRequired: Schema.Boolean }),
})
/** What the brain was sent: the system prompt, then the structured input as JSON. */
export const SentDecide = Schema.Struct({
  messages: Schema.Tuple([Schema.Unknown, Schema.Struct({ content: Schema.fromJsonString(Schema.Unknown) })]),
})

/** The prompt's decision table applied to the input the Worker sent (a deterministic brain for the limits test). */
const byDecisionTable = (body: unknown) => {
  const sent = Schema.decodeUnknownSync(SentDecide)(body).messages[1].content
  const { requested, catalogue, invoice, budget, policy } = Schema.decodeUnknownSync(SentInput)(sent)
  if (requested !== catalogue.itemId) return { action: 'walk_away', reason: 'Not the item the owner asked for.' }
  if (BigInt(invoice.amount) > BigInt(budget.remainingToday))
    return { action: 'walk_away', reason: "over today's allowance; the owner can raise it" }
  return policy.approvalRequired ? ASK_OWNER : { action: 'pay', reason: 'as asked, within both limits' }
}

const decisionFor = (mode: StubMode, body: unknown) =>
  mode === 'table'
    ? byDecisionTable(body)
    : mode === 'ask'
      ? ASK_OWNER
      : { action: 'pay', reason: 'chai is allowlisted and within budget' }

/**
 * A stand-in for the 0G router on 127.0.0.1: answers the `decide` tool call with `pay`, `ask_human` or by the
 * prompt's decision table, hangs past the 10 s timeout, or returns something that is not a tool call. It records what it was sent so the test can check the request shape.
 */
export const startZeroGStub = () => {
  let mode: StubMode = 'pay'
  let signatures = true
  let calls = 0
  const seen: Array<{ readonly authorization: string | null; readonly body: unknown }> = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      if (path.startsWith('/v1/proxy/signature/'))
        return signatures ? Response.json(await teeSignature(path.slice('/v1/proxy/signature/'.length))) : notFound()
      if (path !== '/v1/chat/completions') return notFound()
      calls += 1
      seen.push({ authorization: request.headers.get('authorization'), body: await request.json() })
      if (mode === 'timeout') await Bun.sleep(12_000)
      if (mode === 'garbage') return Response.json({ choices: [{ message: { content: 'I would buy it' } }] })
      const decision = decisionFor(mode, seen.at(-1)?.body)
      return Response.json(
        {
          id: `stub-completion-${calls}`,
          model: TEST_ZG_MODEL,
          choices: [
            { message: { tool_calls: [{ function: { name: 'decide', arguments: JSON.stringify(decision) } }] } },
          ],
          x_0g_trace: { request_id: `stub-request-${calls}`, provider: '0x00000000000000000000000000000000000000f0' },
        },
        { headers: { 'zg-res-key': `stub-chat-${calls}` } },
      )
    },
  })
  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    /** The provider's service URL in the registry: the same stub serves `/v1/proxy/signature/<chatId>`. */
    serviceUrl: `http://127.0.0.1:${server.port}`,
    setMode: (next: StubMode) => {
      mode = next
    },
    /** Off: the provider no longer serves signatures (404), as after ~20 minutes. */
    setSignatures: (on: boolean) => {
      signatures = on
    },
    seen,
  }
}
export type ZeroGStub = ReturnType<typeof startZeroGStub>

const Created = Schema.Struct({
  episodeId: Schema.String,
  state: Schema.String,
  decision: Schema.Struct({ action: Schema.String, reason: Schema.String, requestId: Schema.NullOr(Schema.String) }),
})
const ErrandView = Schema.Struct({
  episode: Schema.Struct({
    state: Schema.String,
    invoice_id: Schema.NullOr(Schema.String),
    result: Schema.NullOr(Schema.String),
  }),
  decisions: Schema.Array(
    Schema.Struct({
      step: Schema.Finite,
      action: Schema.String,
      request_id: Schema.NullOr(Schema.String),
      chat_id: Schema.NullOr(Schema.String),
      error: Schema.NullOr(Schema.String),
      tee_json: Schema.NullOr(Schema.String),
    }),
  ),
  chipRequest: Schema.NullOr(Schema.Struct({ status: Schema.String })),
})
const Pending = Schema.Struct({ episodes: Schema.Array(Schema.Struct({ episodeId: Schema.String })) })

/** A fresh throwaway chip per robot: `robots.chip_address` is unique across tests and reruns. */
const freshChip = () => privateKeyToAccount(generatePrivateKey()).address

export const postTo = (url: string) => (path: string, body: unknown) =>
  HttpClient.post(`${url}${path}`, { body: HttpBody.text(JSON.stringify(body), 'application/json') })

/** A paired robot of this account with a signed grant to the throwaway chip (the spec's caps unless given). */
export const seedRobot = (url: string, accountId: string, chipAddress: `0x${string}`, caps: Caps = SPEC_CAPS) =>
  Effect.gen(function* () {
    const robotId = randomId()
    const post = postTo(url)
    const robot = { id: robotId, accountId, pairingCode: null, chipAddress, chipToken: 'R'.repeat(43) }
    expect((yield* post('/test/vq/robots', robot)).status).toBe(204)
    const delegation = sampleGrant(chipAddress, TEST_MERCHANT_PAY_TO, caps)
    const grant = grantRow({ robotId, accountId, delegation, payee: TEST_MERCHANT_PAY_TO, caps })
    expect((yield* post('/test/vq/grants', grant)).status).toBe(204)
    return robotId
  })

export const errandView = (appUrl: string, cookie: string, robotId: string, episodeId: string) =>
  HttpClient.get(`${appUrl}/api/robots/${robotId}/errands/${episodeId}`, { headers: { cookie } }).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(ErrandView)),
  )

/** The uploader's side of the evidence queue for one terminal episode: pending → claimed with the token → uploaded. */
const evidenceRoundTrip = (appUrl: string, episodeId: string) =>
  Effect.gen(function* () {
    const evidence = yield* HttpClient.get(`${appUrl}/api/evidence/${episodeId}`)
    expect(yield* evidence.json).toMatchObject({ episodeId, status: 'pending' })
    const wrongToken = yield* HttpClient.get(`${appUrl}/api/evidence/pending`, {
      headers: { authorization: 'Bearer nope' },
    })
    expect(wrongToken.status).toBe(401)
    const uploader = { authorization: `Bearer ${TEST_EVIDENCE_TOKEN}` }
    const pending = yield* HttpClient.get(`${appUrl}/api/evidence/pending`, { headers: uploader }).pipe(
      Effect.flatMap((claimed) => claimed.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Pending)),
    )
    expect(pending.episodes.map((episode) => episode.episodeId)).toContain(episodeId)
    const proof = {
      rootHash: `0x${'01'.repeat(32)}`,
      storageTx: `0x${'02'.repeat(32)}`,
      logTx: `0x${'03'.repeat(32)}`,
    }
    const uploaded = yield* HttpClient.post(`${appUrl}/api/evidence/${episodeId}/uploaded`, {
      headers: uploader,
      body: HttpBody.text(JSON.stringify(proof), 'application/json'),
    })
    expect(uploaded.status).toBe(200)
    const recorded = yield* (yield* HttpClient.get(`${appUrl}/api/evidence/${episodeId}`)).json
    expect(recorded).toMatchObject({ status: 'uploaded', ...proof, payload: { episodeId } })
  })

const Invoice = Schema.Struct({ id: Schema.String })
const GateStatus = Schema.Struct({ status: Schema.String })

export const mintInvoice = (appUrl: string) =>
  postTo(appUrl)('/api/merchants/duck-cafe/invoices', { itemId: 'chai' }).pipe(
    Effect.flatMap((created) => created.json),
    Effect.flatMap(Schema.decodeUnknownEffect(Invoice)),
    Effect.map((invoice) => invoice.id),
  )

/** The errand took the counter's invoice; once its settlement lands, the gate reads that invoice `paid`, then `used`. */
const gateInvoiceIsPaid = (input: {
  readonly appUrl: string
  readonly url: string
  readonly cookie: string
  readonly robotId: string
  readonly episodeId: string
  readonly gateInvoice: string
}) =>
  Effect.gen(function* () {
    const { appUrl, url, cookie, robotId, episodeId, gateInvoice } = input
    const signing = yield* errandView(appUrl, cookie, robotId, episodeId)
    expect(signing.episode.invoice_id).toBe(gateInvoice)
    const asked = yield* (yield* HttpClient.get(`${url}/test/vq/episodes/${episodeId}/chip-invoice`)).json
    expect(asked).toEqual({ invoiceId: gateInvoice })
    const settledTx = `0x${'7a'.repeat(32)}`
    expect((yield* postTo(url)(`/test/vq/episodes/${episodeId}/settled`, { txHash: settledTx })).status).toBe(204)
    expect((yield* errandView(appUrl, cookie, robotId, episodeId)).episode).toMatchObject({
      state: 'paid',
      result: settledTx,
    })
    const read = (nonce: string) =>
      HttpClient.get(`${appUrl}/api/invoices/${gateInvoice}/status?nonce=${nonce}`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(GateStatus)),
        Effect.map(({ status }) => status),
      )
    expect([yield* read('gate1'), yield* read('gate2')]).toEqual(['paid', 'used'])
    // The episode's evidence is built after the decision learned its outcome.
    const evidence = yield* (yield* HttpClient.get(`${appUrl}/api/evidence/${episodeId}`)).json
    expect(evidence).toMatchObject({
      payload: { decisions: [{ outcome: 'paid' }], outcome: { state: 'paid', txHash: settledTx } },
    })
  })

const StoredProof = Schema.fromJsonString(TeeProof)
export const EvidenceTee = Schema.Struct({
  payload: Schema.Struct({ decisions: Schema.Array(Schema.Struct({ tee: Schema.optionalKey(TeeProof) })) }),
})
const VerifiedTee = Schema.Struct({
  tee: Schema.Struct({ present: Schema.Boolean, signerMatches: Schema.Boolean, signer: Schema.NullOr(Schema.String) }),
})

/**
 * The paid errand's decision carries the stub provider TEE's proof, fetched at decision time. The signer comes from the
 * registry (stub chain), `verified`, the same in the evidence, and verify recovers it again.
 */
const teeProofRecorded = (input: {
  readonly appUrl: string
  readonly cookie: string
  readonly robotId: string
  readonly episodeId: string
  readonly stub: ZeroGStub
}) =>
  Effect.gen(function* () {
    const { appUrl, cookie, robotId, episodeId, stub } = input
    const view = yield* errandView(appUrl, cookie, robotId, episodeId)
    const proof = yield* Schema.decodeUnknownEffect(StoredProof)(view.decisions[0]?.tee_json)
    expect(proof).toMatchObject({ signer: TEST_TEE_SIGNER, serviceUrl: stub.serviceUrl, verified: true })
    expect(proof.signingAddress.toLowerCase()).toBe(TEST_TEE_SIGNER.toLowerCase())
    expect(proof.text).toMatch(/^zg-sig-v1\/e2ee-ct:[0-9a-f]{64}:[0-9a-f]{64}$/)
    const evidence = yield* (yield* HttpClient.get(`${appUrl}/api/evidence/${episodeId}`)).json
    expect((yield* Schema.decodeUnknownEffect(EvidenceTee)(evidence)).payload.decisions[0]?.tee).toEqual(proof)
    const verified = yield* HttpClient.post(`${appUrl}/api/wallet/episodes/${episodeId}/verify`, {
      headers: { origin: new URL(appUrl).origin, cookie },
    }).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(VerifiedTee)),
    )
    expect(verified.tee).toEqual({ present: true, signerMatches: true, signer: TEST_TEE_SIGNER })
  })

/** A Worker that died mid-settle must not wedge the robot: the next read ends the errand from what D1 recorded. */
const stuckSettlementsReconcile = (input: {
  readonly appUrl: string
  readonly url: string
  readonly cookie: string
  readonly accountId: string
  readonly robotId: string
}) =>
  Effect.gen(function* () {
    const { appUrl, url, cookie, accountId, robotId } = input
    const post = postTo(url)
    const invoiceFor = postTo(appUrl)('/api/merchants/duck-cafe/invoices', { itemId: 'chai' }).pipe(
      Effect.flatMap((created) => created.json),
      Effect.flatMap(Schema.decodeUnknownEffect(Invoice)),
    )
    const settledTx = `0x${'5e'.repeat(32)}`
    const landed = { id: randomId(), robotId, accountId, invoiceId: (yield* invoiceFor).id, ageSeconds: 200, settledTx }
    const lost = {
      id: randomId(),
      robotId,
      accountId,
      invoiceId: (yield* invoiceFor).id,
      ageSeconds: 400,
      settledTx: null,
    }
    expect((yield* post('/test/vq/stuck-episodes', landed)).status).toBe(204)
    expect((yield* post('/test/vq/stuck-episodes', lost)).status).toBe(204)
    const landedView = yield* errandView(appUrl, cookie, robotId, landed.id)
    expect(landedView.episode).toMatchObject({ state: 'paid', result: settledTx })
    const lostView = yield* errandView(appUrl, cookie, robotId, lost.id)
    expect(lostView.episode).toMatchObject({ state: 'failed', result: 'settlement interrupted before broadcast' })
  })

/** M5 acceptance with the stub 0G: `pay` → `signing` + one decision with its request id; timeout and garbage →
 * `safe_stop` with no chip request; evidence is queued and the uploader's protocol works with its bearer token. */
export const registerRobotAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>, stub: ZeroGStub) =>
  test(
    'robot agent: 0G decides pay → signing; a timed-out or garbled decision → safe_stop; evidence queue',
    Effect.gen(function* () {
      const { appUrl, url, apiUrl } = yield* stack
      const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator())
      const { response } = yield* registerPasskey(appUrl, authenticator, 'Robot Owner')
      const { accountId } = yield* Schema.decodeUnknownEffect(Schema.Struct({ accountId: Schema.String }))(
        yield* response.json,
      )
      const cookie = sessionCookie(response)
      // Errands wait on 0G (up to the 10 s timeout): they go to the API Worker's own URL with the app's Origin, since
      // the full local suite's edge proxy has reset responses that took that long (checked on the deploy instead).
      const call = (path: string, body: unknown, withCookie: string) =>
        HttpClient.post(`${apiUrl}${path}`, {
          headers: { origin: new URL(appUrl).origin, 'content-type': 'application/json', cookie: withCookie },
          body: HttpBody.text(JSON.stringify(body), 'application/json'),
        })
      const start = (robotId: string, item: string) =>
        call(`/api/robots/${robotId}/errands`, { item }, cookie).pipe(
          Effect.tap((created) => Effect.sync(() => expect(created.status).toBe(201))),
          Effect.flatMap((created) => created.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Created)),
        )

      stub.setMode('pay')
      const robot = yield* seedRobot(url, accountId, freshChip())
      // The counter (gate) shows an invoice; the errand must pay that one, not mint its own.
      const gateInvoice = yield* mintInvoice(appUrl)
      const first = yield* call(`/api/robots/${robot}/errands`, { item: 'chai' }, cookie)
      // Until the native stack binds a (throwaway) relayer, errands refuse to start: the 503 contract of spec §10.
      if (first.status === 503) {
        expect(yield* first.json).toEqual({ error: 'not configured: RELAYER_PRIVATE_KEY' })
        return
      }
      expect(first.status).toBe(201)
      const paying = yield* Schema.decodeUnknownEffect(Created)(yield* first.json)
      expect(paying).toMatchObject({ state: 'signing', decision: { action: 'pay' } })
      expect(paying.decision.requestId).toMatch(/^stub-request-\d+$/)
      const sent = stub.seen.at(-1)
      expect(sent?.authorization).toBe(`Bearer ${TEST_ZG_API_KEY}`)
      expect(sent?.body).toMatchObject({
        model: TEST_ZG_MODEL,
        temperature: 0,
        tool_choice: { function: { name: 'decide' } },
      })
      const signing = yield* errandView(appUrl, cookie, robot, paying.episodeId)
      expect(signing.decisions).toHaveLength(1)
      expect(signing.decisions[0]).toMatchObject({ step: 1, action: 'pay', request_id: paying.decision.requestId })
      expect(signing.decisions[0]?.chat_id).toMatch(/^stub-chat-\d+$/)
      expect(signing.chipRequest).toMatchObject({ status: 'queued' })
      const busy = yield* call(`/api/robots/${robot}/errands`, { item: 'chai' }, cookie)
      expect(busy.status).toBe(409)
      yield* gateInvoiceIsPaid({ appUrl, url, cookie, robotId: robot, episodeId: paying.episodeId, gateInvoice })
      yield* teeProofRecorded({ appUrl, cookie, robotId: robot, episodeId: paying.episodeId, stub })

      stub.setMode('timeout')
      const slowRobot = yield* seedRobot(url, accountId, freshChip())
      const stopped = yield* start(slowRobot, 'chai')
      expect(stopped).toMatchObject({ state: 'safe_stop', decision: { action: 'safe_stop', requestId: null } })
      const stoppedView = yield* errandView(appUrl, cookie, slowRobot, stopped.episodeId)
      expect(stoppedView.chipRequest).toBeNull()
      expect(stoppedView.decisions[0]).toMatchObject({ action: 'safe_stop', error: '0G call timed out (10 s)' })

      stub.setMode('garbage')
      const confusedRobot = yield* seedRobot(url, accountId, freshChip())
      const paidAlready = yield* call(
        `/api/robots/${confusedRobot}/errands`,
        { item: 'chai', invoiceId: gateInvoice },
        cookie,
      )
      expect(paidAlready.status).toBe(409)
      const garbled = yield* start(confusedRobot, 'chai')
      expect(garbled).toMatchObject({ state: 'safe_stop', decision: { action: 'safe_stop' } })
      expect((yield* errandView(appUrl, cookie, confusedRobot, garbled.episodeId)).chipRequest).toBeNull()

      yield* evidenceRoundTrip(appUrl, stopped.episodeId)
      yield* stuckSettlementsReconcile({ appUrl, url, cookie, accountId, robotId: robot })
    }).pipe(Effect.provide(freshConnections)),
    { timeout: 90000 },
  )
