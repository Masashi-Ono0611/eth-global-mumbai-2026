import { expect } from 'bun:test'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Layer, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { DEMO_CAPS, freshConnections } from './AgentSamples.ts'
import { makeSoftwareAuthenticator, registerPasskey, sessionCookie } from './PasskeyFixture.ts'
import { errandView, EvidenceTee, postTo, SentDecide, seedRobot, type ZeroGStub } from './RobotAcceptance.ts'

// The demo's approval story is spending limits only (6 Nov, Kris). On the demo grant (3.00 a day, 1.00 per payment) a
// chai pays; a thali (2.00) is over the per-payment limit, so the owner approves it in World and it pays; a second thali
// is over what is left today (0.90). No approval lifts that, because Arc's period cap counts approved payments too, so
// the brain walks away. The stub brain applies the prompt's decision table to what the Worker sent.

type Urls = { readonly appUrl: string; readonly url: string; readonly apiUrl: string }

const Started = Schema.Struct({
  episodeId: Schema.String,
  state: Schema.String,
  decision: Schema.Struct({ action: Schema.String }),
  approvalUrl: Schema.optionalKey(Schema.String),
})

const unescape = (html: string) => html.replaceAll('&amp;', '&')

/** Manual redirects: the World authorize and callback answers are 302s whose Location the test follows itself. */
const manualRedirects = Layer.mergeAll(
  FetchHttpClient.layer,
  Layer.succeed(FetchHttpClient.RequestInit, { keepalive: false, redirect: 'manual' }),
)

/** The owner answers in the stub World IdP (WorldStubAcceptance checks that protocol itself). */
const answerInStubWorld = (appUrl: string, cookie: string, approvalUrl: string, choice: 'approve' | 'deny') =>
  Effect.gen(function* () {
    const approvalId = approvalUrl.split('/').at(-1) ?? ''
    const authorize = yield* HttpClient.get(`${appUrl}/api/world/authorize?approval=${approvalId}`, {
      headers: { cookie },
    })
    const page = yield* (yield* HttpClient.get(authorize.headers['location'] ?? '')).text
    const href = unescape(new RegExp(`id="${choice}" href="([^"]+)"`).exec(page)?.[1] ?? '')
    return (yield* HttpClient.get(href)).status
  }).pipe(Effect.provide(manualRedirects))

/** What the brain was told about this errand's budget, from the stub's last request. */
const lastSentInput = (stub: ZeroGStub) =>
  Schema.decodeUnknownEffect(SentDecide)(stub.seen.at(-1)?.body).pipe(Effect.map((sent) => sent.messages[1].content))

export const registerLimitsAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>, stub: ZeroGStub) =>
  test(
    "spending limits (3.00/day, 1.00/payment): chai pays, thali asks the owner and pays, a second thali is over today's allowance",
    Effect.gen(function* () {
      const { appUrl, url, apiUrl } = yield* stack
      const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator())
      const { response } = yield* registerPasskey(appUrl, authenticator, 'Limits Owner')
      const { accountId } = yield* Schema.decodeUnknownEffect(Schema.Struct({ accountId: Schema.String }))(
        yield* response.json,
      )
      const cookie = sessionCookie(response)
      // Errands wait on the brain: straight to the API Worker with the app's Origin (as the robot acceptance does).
      const start = (robotId: string, item: string) =>
        HttpClient.post(`${apiUrl}/api/robots/${robotId}/errands`, {
          headers: { origin: new URL(appUrl).origin, cookie },
          body: HttpBody.text(JSON.stringify({ item }), 'application/json'),
        }).pipe(
          Effect.tap((created) => Effect.sync(() => expect(created.status).toBe(201))),
          Effect.flatMap((created) => created.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Started)),
        )
      const settle = (robotId: string, episodeId: string, tx: string) =>
        Effect.gen(function* () {
          expect((yield* postTo(url)(`/test/vq/episodes/${episodeId}/settled`, { txHash: tx })).status).toBe(204)
          expect((yield* errandView(appUrl, cookie, robotId, episodeId)).episode.state).toBe('paid')
        })
      stub.setMode('table')
      const robotId = yield* seedRobot(url, accountId, privateKeyToAccount(generatePrivateKey()).address, DEMO_CAPS)

      const chai = yield* start(robotId, 'chai')
      expect(chai).toMatchObject({ state: 'signing', decision: { action: 'pay' } })
      expect(yield* lastSentInput(stub)).toMatchObject({
        budget: { remainingToday: '3000000', perPaymentCap: '1000000' },
      })
      yield* settle(robotId, chai.episodeId, `0x${'c1'.repeat(32)}`)
      // The owner's view of the same day: the robot route reports what the period has used (spec §6 budget).
      const robotView: unknown = yield* (yield* HttpClient.get(`${appUrl}/api/robots/${robotId}`, {
        headers: { cookie },
      })).json
      expect(robotView).toMatchObject({ grant: { dailyCap: '3000000', spentToday: '100000' } })

      const thali = yield* start(robotId, 'thali')
      expect(thali).toMatchObject({ state: 'awaiting_approval', decision: { action: 'ask_human' } })
      expect(yield* lastSentInput(stub)).toMatchObject({
        budget: { spentToday: '100000', remainingToday: '2900000' },
        policy: { approvalRequired: true },
        approval: { required: true },
      })
      expect(yield* answerInStubWorld(appUrl, cookie, thali.approvalUrl ?? '', 'approve')).toBe(302)
      expect((yield* errandView(appUrl, cookie, robotId, thali.episodeId)).episode.state).toBe('signing')
      yield* settle(robotId, thali.episodeId, `0x${'c2'.repeat(32)}`)

      const again = yield* start(robotId, 'thali')
      expect(again).toMatchObject({ state: 'walked_away', decision: { action: 'walk_away' } })
      const overToday = yield* lastSentInput(stub)
      expect(overToday).toMatchObject({
        budget: { spentToday: '2100000', remainingToday: '900000' },
        dailyAllowance: { exceeded: true, approvalCanLift: false },
      })
      expect(overToday).not.toHaveProperty('approval')
      const evidence = yield* (yield* HttpClient.get(`${appUrl}/api/evidence/${again.episodeId}`)).json
      expect(evidence).toMatchObject({
        payload: { item: 'thali', decisions: [{ action: 'walk_away', outcome: 'walked_away' }] },
      })

      // A declined thali on a new robot, after the provider stopped serving signatures: denied, and no TEE proof.
      stub.setSignatures(false)
      const declinedRobot = yield* seedRobot(
        url,
        accountId,
        privateKeyToAccount(generatePrivateKey()).address,
        DEMO_CAPS,
      )
      const declined = yield* start(declinedRobot, 'thali')
      expect(declined.state).toBe('awaiting_approval')
      expect(yield* answerInStubWorld(appUrl, cookie, declined.approvalUrl ?? '', 'deny')).toBe(302)
      const unproven = yield* Schema.decodeUnknownEffect(EvidenceTee)(
        yield* (yield* HttpClient.get(`${appUrl}/api/evidence/${declined.episodeId}`)).json,
      )
      expect(unproven.payload.decisions).toHaveLength(1)
      expect(unproven.payload.decisions[0]).not.toHaveProperty('tee')
      stub.setSignatures(true)
      stub.setMode('pay')
    }).pipe(Effect.provide(freshConnections)),
    { timeout: 90000 },
  )
