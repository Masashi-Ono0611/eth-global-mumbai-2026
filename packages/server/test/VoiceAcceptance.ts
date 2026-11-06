import { expect } from 'bun:test'
import { IntentView } from '@ethmumbai/protocol/Intent'
import { VoiceSay, VoiceTurn } from '@ethmumbai/protocol/Voice'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import { DEMO_CAPS, freshConnections, randomId } from './AgentSamples.ts'
import { makeSoftwareAuthenticator, registerPasskey, sessionCookie } from './PasskeyFixture.ts'
import { postTo, STUB_SPEECH, TEST_ZG_API_KEY, type ZeroGStub } from './RobotAcceptance.ts'
import { scanErrand, seedScanningRobot } from './ScanAcceptance.ts'
import { BOSS, SNACKS } from '../src/robot/VoiceLines.ts'

// Vita's voice (`POST /api/robots/:robotId/voice`, `…/voice/say`, behind VOICE_ENABLED) against the 0G stand-in: the
// omni model's JSON drives the turn, a `buy` turn creates the same intent a Buy chip does, the robot's scan then runs
// 0G's decide, and Vita's line about it comes from the typed state. VOICE_ENABLED is on only after the restart test.

type Urls = { readonly appUrl: string; readonly url: string; readonly apiUrl: string }

/** A WAV header's first bytes: the stub never decodes audio, the route only checks the data URI's shape. */
const CLIP = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA='
const Minted = Schema.Struct({ id: Schema.String })
const UserAudio = Schema.Struct({
  messages: Schema.Tuple([
    Schema.Struct({ role: Schema.Literal('system'), content: Schema.String }),
    Schema.Struct({
      role: Schema.Literal('user'),
      content: Schema.Tuple([
        Schema.Struct({ type: Schema.Literal('input_audio'), input_audio: Schema.Struct({ data: Schema.String }) }),
        Schema.Unknown,
      ]),
    }),
  ]),
})

const owner = (urls: Urls, name: string) =>
  Effect.gen(function* () {
    const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator())
    const { response } = yield* registerPasskey(urls.appUrl, authenticator, name)
    const { accountId } = yield* Schema.decodeUnknownEffect(Schema.Struct({ accountId: Schema.String }))(
      yield* response.json,
    )
    const cookie = sessionCookie(response)
    const call = (path: string, body: unknown) =>
      HttpClient.post(`${urls.apiUrl}${path}`, {
        headers: { origin: new URL(urls.appUrl).origin, cookie },
        body: HttpBody.text(JSON.stringify(body), 'application/json'),
      }).pipe(Effect.flatMap((answer) => Effect.map(answer.json, (json) => ({ status: answer.status, json }))))
    const talk = (robotId: string, audio = CLIP) =>
      call(`/api/robots/${robotId}/voice`, { audio }).pipe(
        Effect.tap(({ status }) => Effect.sync(() => expect(status).toBe(200))),
        Effect.flatMap(({ json }) => Schema.decodeUnknownEffect(VoiceTurn)(json)),
      )
    const say = (robotId: string, intentId: string) =>
      call(`/api/robots/${robotId}/voice/say`, { intentId }).pipe(
        Effect.tap(({ status }) => Effect.sync(() => expect(status).toBe(200))),
        Effect.flatMap(({ json }) => Schema.decodeUnknownEffect(VoiceSay)(json)),
      )
    return { accountId, cookie, call, talk, say }
  })

type Owner = Effect.Success<ReturnType<typeof owner>>
type ScanningRobot = Effect.Success<ReturnType<typeof seedScanningRobot>>

/** The robot scans the counter's thali after a spoken buy; Vita speaks the approval state, also without speech. */
const approvalBeat = (urls: Urls, me: Owner, robot: ScanningRobot, stub: ZeroGStub, errandId: string) =>
  Effect.gen(function* () {
    // The robot scans the counter's thali: 0G's decide (not the voice) answers ask_human; Vita says it from the state; 0G's own reason comes back as a quote to show, never spoken.
    stub.setMode('table')
    const placed = yield* postTo(urls.appUrl)('/api/merchants/duck-cafe/counter', { itemId: 'thali' })
    expect(placed.status).toBe(201)
    const invoice = yield* Schema.decodeUnknownEffect(Minted)(yield* placed.json)
    const started = yield* scanErrand({ apiUrl: urls.apiUrl, ...robot, invoiceId: invoice.id })
    expect(started.state).toBe('awaiting_approval')
    const asking = yield* me.say(robot.robotId, errandId)
    expect(asking.errand).toMatchObject({ state: 'scanned', episodeState: 'awaiting_approval' })
    expect(asking.line.text).toContain('needs your approval in World App')
    expect(asking.decisionReason).toBe('over the per-payment limit; the owner approves it in World App')
    expect(asking.line.text).not.toContain('per-payment limit; the owner')
    expect(asking.line.closer).toBe(BOSS)
    stub.setMode('pay')

    // Speech down: the line still comes back, without audio.
    stub.setSpeech(false)
    const mute = yield* me.say(robot.robotId, errandId)
    expect(mute.speech).toBeNull()
    expect(mute.speechError).toBe('0G speech did not answer; showing the line as text')
    expect(mute.line.text).toContain('needs your approval in World App')
    // A spoken stop while 0G's ask_human waits for the owner: the intent ends, and Vita does not promise nothing pays.
    stub.setHearing({ heard: 'Stop.', intent: 'stop', item: null })
    const stopped = yield* me.talk(robot.robotId)
    expect(stopped.errand).toMatchObject({ id: errandId, state: 'stopped', episodeState: 'awaiting_approval' })
    expect(stopped.line.text).toContain('may still pay')
    // A second stop finds no open intent, but the errand still waits: the warning stays.
    const again = yield* me.talk(robot.robotId)
    expect(again.errand).toBeNull()
    expect(again.line.text).toContain('may still pay')
    // A new buy while that errand still waits, then a stop: the warning covers the earlier errand too.
    stub.setHearing({ heard: 'Get me a chai.', intent: 'buy', item: 'chai' })
    const next = yield* me.talk(robot.robotId)
    expect(next.errand).toMatchObject({ state: 'running', episodeId: null })
    stub.setHearing({ heard: 'Stop.', intent: 'stop', item: null })
    const third = yield* me.talk(robot.robotId)
    expect(third.errand).toMatchObject({ id: next.errand?.id, state: 'stopped', episodeId: null })
    expect(third.line.text).toContain('may still pay')
    stub.setSpeech(true)
  })

export const registerVoiceOffAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>) =>
  test(
    'voice: while VOICE_ENABLED is pending the voice routes do not exist (404) and health reports voice off',
    Effect.gen(function* () {
      const { apiUrl } = yield* stack
      for (const path of ['voice', 'voice/say']) {
        const response = yield* HttpClient.post(`${apiUrl}/api/robots/${randomId()}/${path}`, {
          body: HttpBody.text('{}', 'application/json'),
        })
        expect(response.status).toBe(404)
      }
      const health = yield* (yield* HttpClient.get(`${apiUrl}/api/health`)).json
      expect(health).toMatchObject({ features: { voice: false } })
    }).pipe(Effect.provide(freshConnections)),
    { timeout: 60000 },
  )

export const registerVoiceAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>, stub: ZeroGStub) =>
  test(
    "voice: a spoken buy starts the owner's intent, 0G down starts nothing, Vita speaks the errand's real state, another owner gets 404",
    Effect.gen(function* () {
      const urls = yield* stack
      const health = yield* (yield* HttpClient.get(`${urls.apiUrl}/api/health`)).json
      expect(health).toMatchObject({ features: { voice: true } })
      const me = yield* owner(urls, 'Voice Owner')
      const robot = yield* seedScanningRobot(urls.url, me.accountId, DEMO_CAPS)
      stub.setSpeech(true)

      // 0G down: a visible 502, and nothing started (the next intent is still free to create).
      stub.setHearing('down')
      const down = yield* me.call(`/api/robots/${robot.robotId}/voice`, { audio: CLIP })
      expect(down.status).toBe(502)
      const downError = yield* Schema.decodeUnknownEffect(Schema.Struct({ error: Schema.String }))(down.json)
      expect(downError.error).toContain('0G did not answer')
      expect(JSON.stringify(down.json)).not.toContain(TEST_ZG_API_KEY)

      // "Get me a thali": the intent a Buy chip would create, with the owner's words as its instruction.
      stub.setHearing({ heard: 'Get me a thali, please.', intent: 'buy', item: 'thali', topic: null })
      const before = stub.voiceSeen.length
      const thali = yield* me.talk(robot.robotId)
      expect(thali).toMatchObject({
        heard: 'Get me a thali, please.',
        intent: 'buy',
        item: 'thali',
        errand: { state: 'running', item: 'thali', instruction: 'Get me a thali', episodeId: null },
      })
      expect(thali.line.closer).toBe(SNACKS)
      expect(thali.speech?.audio).toBe(`data:audio/mpeg;base64,${Base64.encode(STUB_SPEECH)}`)
      // The Worker sent the clip and the line to 0G with its own key; nothing reached the browser but the answer.
      const [heardCall, spokenCall] = stub.voiceSeen.slice(before)
      expect(heardCall?.authorization).toBe(`Bearer ${TEST_ZG_API_KEY}`)
      const sent = yield* Schema.decodeUnknownEffect(UserAudio)(heardCall?.body)
      expect(sent.messages[1].content[0].input_audio.data).toBe(CLIP)
      expect(sent.messages[0].content).toContain('"topic"')
      expect(spokenCall).toMatchObject({ path: '/v1/audio/speech', body: { input: thali.line.text } })
      const errand = thali.errand ?? (yield* Effect.die('no intent'))
      const read = yield* HttpClient.get(`${urls.appUrl}/api/robots/${robot.robotId}/intents/${errand.id}`, {
        headers: { cookie: me.cookie },
      }).pipe(
        Effect.flatMap((answer) => answer.json),
        Effect.flatMap(Schema.decodeUnknownEffect(IntentView)),
      )
      // The stored instruction is the canonical sentence, never the transcript.
      expect(read).toMatchObject({ id: errand.id, state: 'running', instruction: 'Get me a thali' })

      // A second buy while that one is open: Vita says so; nothing new starts.
      stub.setHearing({ heard: 'And a chai.', intent: 'buy', item: 'chai' })
      const busy = yield* me.talk(robot.robotId)
      expect(busy.errand).toBeNull()
      expect(busy.line.text).toContain('already on an errand')

      yield* approvalBeat(urls, me, robot, stub, errand.id)

      // A question: the model only names its topic; the answer is built from the robot's real grant, and any text the
      // model adds is never spoken.
      stub.setHearing({ heard: 'What is your limit?', intent: 'question', item: null, topic: 'limits' })
      const question = yield* me.talk(robot.robotId)
      expect(question).toMatchObject({ intent: 'question', errand: null })
      expect(question.line.text).toContain('1.00 per payment and 3.00 a day')
      const noisy = { heard: 'Did you pay?', intent: 'question', item: null, topic: 'status', answer: 'Yes, I paid!' }
      stub.setHearing(noisy)
      expect((yield* me.talk(robot.robotId)).line.text).not.toMatch(/\bpaid\b/i)

      // Another owner: the robot and its intent are someone else's, so they do not exist (404), and 0G is not called.
      const other = yield* owner(urls, 'Other Voice Owner')
      const calls = stub.voiceSeen.length
      expect((yield* other.call(`/api/robots/${robot.robotId}/voice`, { audio: CLIP })).status).toBe(404)
      expect((yield* other.call(`/api/robots/${robot.robotId}/voice/say`, { intentId: errand.id })).status).toBe(404)
      expect(stub.voiceSeen.length).toBe(calls)

      // Not a WAV data URI: 400 before any 0G call; no Origin: refused before the route.
      expect((yield* me.call(`/api/robots/${robot.robotId}/voice`, { audio: 'hello' })).status).toBe(400)
      const noOrigin = yield* HttpClient.post(`${urls.apiUrl}/api/robots/${robot.robotId}/voice`, {
        headers: { cookie: me.cookie },
        body: HttpBody.text(JSON.stringify({ audio: CLIP }), 'application/json'),
      })
      expect(noOrigin.status).toBe(403)
      expect(stub.voiceSeen.length).toBe(calls)
    }).pipe(Effect.provide(freshConnections)),
    { timeout: 120000 },
  )

/** A spoken stop ends the open intent; with none open, Vita says there is nothing to stop. */
export const registerVoiceStopAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>, stub: ZeroGStub) =>
  test(
    'voice: a spoken stop ends the open intent',
    Effect.gen(function* () {
      const urls = yield* stack
      const me = yield* owner(urls, 'Voice Stopper')
      const robot = yield* seedScanningRobot(urls.url, me.accountId, DEMO_CAPS)
      stub.setSpeech(true)
      stub.setHearing({ heard: 'Get me a chai.', intent: 'buy', item: 'chai' })
      const chai = yield* me.talk(robot.robotId)
      expect(chai.errand).toMatchObject({ state: 'running', item: 'chai' })
      stub.setHearing({ heard: 'Stop, come back.', intent: 'stop', item: null })
      const stopped = yield* me.talk(robot.robotId)
      expect(stopped.errand).toMatchObject({ id: chai.errand?.id, state: 'stopped', reason: 'stopped by the owner' })
      expect(stopped.line.text).toContain('Stopping right here')
      const again = yield* me.talk(robot.robotId)
      expect(again.errand).toBeNull()
      expect(again.line.text).toContain('not on an errand')
      // A stop while the chip is already paying: the intent ends, and Vita does not promise the payment stops.
      stub.setMode('pay')
      stub.setHearing({ heard: 'Get me a chai.', intent: 'buy', item: 'chai' })
      const paying = yield* me.talk(robot.robotId)
      const placed = yield* postTo(urls.appUrl)('/api/merchants/duck-cafe/counter', { itemId: 'chai' })
      const invoice = yield* Schema.decodeUnknownEffect(Minted)(yield* placed.json)
      expect((yield* scanErrand({ apiUrl: urls.apiUrl, ...robot, invoiceId: invoice.id })).state).toBe('signing')
      stub.setHearing({ heard: 'Stop!', intent: 'stop', item: null })
      const late = yield* me.talk(robot.robotId)
      expect(late.errand).toMatchObject({ id: paying.errand?.id, state: 'stopped', episodeState: 'signing' })
      expect(late.line.text).toContain('may still pay')
      // Off the menu: no intent, Vita lists the menu.
      stub.setHearing({ heard: 'Get me a coffee.', intent: 'buy', item: 'coffee' })
      const coffee = yield* me.talk(robot.robotId)
      expect(coffee).toMatchObject({ intent: 'buy', item: null, errand: null })
      expect(coffee.line.text).toContain('only has chai, samosa or thali')
    }).pipe(Effect.provide(freshConnections)),
    { timeout: 60000 },
  )
