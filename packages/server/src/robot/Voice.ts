import { isOpenIntent } from '@ethmumbai/protocol/Intent'
import {
  VoiceSayRequest,
  type VoiceIntent,
  type VoiceLine,
  type VoiceSay,
  type VoiceTurn,
  VoiceTurnRequest,
} from '@ethmumbai/protocol/Voice'
import { Clock, type Duration, Effect, Option, Redacted, Result, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import { latestSignedGrant, spentInPeriod } from './Budget.ts'
import { decisionsOf } from './Decide.ts'
import { type ErrandDeps, LIVE_STATES } from './Errands.ts'
import { createIntent, endIntent, intentView, openIntent, ownRobot, settleIntents } from './Intents.ts'
import { readIntent } from './IntentRows.ts'
import { ErrandRefused, MERCHANT_ID, need } from './Start.ts'
import {
  answerLine,
  busyLine,
  hearingPrompt,
  intentLine,
  notPairedLine,
  offMenuLine,
  parseHearing,
  stoppedLine,
  voiceInstruction,
  type VoiceFacts,
} from './VoiceLines.ts'
import { zeroGChat } from './ZeroGChat.ts'
import type { ZeroGConfig } from './ZeroGClient.ts'
import { requireSession } from '../auth/Session.ts'
import type { RobotRow } from '../chip/Lease.ts'
import { findItem, findMerchant, type Merchant } from '../merchant/Catalogue.ts'
import { json, jsonError, nowSeconds } from '../Respond.ts'
import { firstRow } from '../Sql.ts'

const LIVE = LIVE_STATES.map((state) => `'${state}'`).join(', ')

// Vita's voice in the robot conversation (protocol Voice.ts), behind VOICE_ENABLED. Two 0G Router calls, both with
// the Worker's key: the omni model hears the owner's clip, and `minimax-speech` speaks the line. The voice model never
// decides: a `buy` turn calls `createIntent`, the one operation the Buy chips and typed text use, and the robot's scan
// then runs 0G's `decide` (glm-5.3, TEE-proven) as for any errand. Audio, transcripts and prompts are never stored or
// logged; logs carry the robot, the turn's kind, latency and the 0G request id.

/** The omni model that hears (audio in, JSON out, one call). Measured 8/8 in the reply shape in the demo kit. */
export const VOICE_MODEL = 'qwen3.5-omni-plus'
/** The 0G Router's text-to-speech model; the page pitches it up for the duck. */
export const SPEECH_MODEL = 'minimax-speech-2.8-turbo'
const SPEECH_VOICE = 'English_PlayfulGirl'
/** The demo kit's tempo (0.95) over its browser pitch-up (1.16), so the heard pace stays normal. */
const SPEECH_SPEED = 0.82
/** Shown when only the speech failed: the turn (and any intent it created) stands, Vita's line is shown as text. */
const SPEECH_FAILED = '0G speech did not answer; showing the line as text'
const HEAR_TIMEOUT = '15 seconds'
const SPEECH_TIMEOUT = '15 seconds'

/** The menu and the robot's real limits, for answers (Budget.ts is the same source the errand uses). */
const factsOf = Effect.fnUntraced(function* (deps: ErrandDeps, robot: RobotRow, merchant: Merchant) {
  const grant = yield* latestSignedGrant(deps.database, robot.id)
  if (Option.isNone(grant)) return { items: merchant.items, limits: Option.none() } satisfies VoiceFacts
  const spentToday = yield* spentInPeriod(deps.database, grant.value, yield* nowSeconds)
  return {
    items: merchant.items,
    limits: Option.some({ perPayment: grant.value.perPaymentCap, daily: grant.value.dailyCap, spentToday }),
  } satisfies VoiceFacts
})

/** The omni model's view of the clip; any failure is a visible 502 and nothing starts. */
const hear = Effect.fnUntraced(function* (zeroG: ZeroGConfig, audio: string, items: VoiceFacts['items']) {
  const config: ZeroGConfig = { baseUrl: zeroG.baseUrl, apiKey: zeroG.apiKey, model: VOICE_MODEL }
  const outcome = yield* zeroGChat(
    config,
    {
      temperature: 0,
      stream: false,
      messages: [
        { role: 'system', content: hearingPrompt(items) },
        {
          role: 'user',
          content: [
            { type: 'input_audio', input_audio: { data: audio, format: 'wav' } },
            { type: 'text', text: 'The owner just said this. Answer with the JSON object only.' },
          ],
        },
      ],
    },
    { timeout: HEAR_TIMEOUT },
  ).pipe(Effect.provide(FetchHttpClient.layer))
  if (!outcome.ok) return yield* new ErrandRefused({ status: 502, error: `0G did not answer: ${outcome.error}` })
  const hearing = parseHearing(outcome.message, items)
  if (!hearing.ok) {
    yield* Effect.logWarning(`voice: 0G hearing unusable: ${hearing.error}`)
    return yield* new ErrandRefused({ status: 502, error: `0G did not understand the clip: ${hearing.error}` })
  }
  return { ...hearing, requestId: outcome.call.requestId, latencyMs: outcome.call.latencyMs }
})

/**
 * `POST {ZG_BASE_URL}/audio/speech`: the line as MP3, as a data URI. A failure is `null` (the text still shows) and one
 * warning with the status only.
 */
const speak = Effect.fnUntraced(function* (zeroG: ZeroGConfig, line: VoiceLine, timeout: Duration.Input) {
  const started = yield* Clock.currentTimeMillis
  const reply = yield* Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const response = yield* client.execute(
      HttpClientRequest.post(`${zeroG.baseUrl.replace(/\/+$/, '')}/audio/speech`).pipe(
        HttpClientRequest.bearerToken(Redacted.value(zeroG.apiKey)),
        HttpClientRequest.bodyText(
          JSON.stringify({ model: SPEECH_MODEL, input: line.text, voice: SPEECH_VOICE, speed: SPEECH_SPEED }),
          'application/json',
        ),
      ),
    )
    const bytes = new Uint8Array(yield* response.arrayBuffer)
    return { status: response.status, type: response.headers['content-type'] ?? '', bytes }
  }).pipe(Effect.timeout(timeout), Effect.result, Effect.provide(FetchHttpClient.layer))
  const latencyMs = (yield* Clock.currentTimeMillis) - started
  if (Result.isFailure(reply) || reply.success.status !== 200 || !reply.success.type.startsWith('audio/')) {
    const status = Result.isFailure(reply) ? 'no answer' : `${reply.success.status} ${reply.success.type}`
    yield* Effect.logWarning(`voice: 0G speech failed (${status})`).pipe(Effect.annotateLogs({ latencyMs }))
    return null
  }
  yield* Effect.logInfo('voice speech').pipe(Effect.annotateLogs({ latencyMs, bytes: reply.success.bytes.length }))
  return { audio: `data:audio/mpeg;base64,${Base64.encode(reply.success.bytes)}` }
})

/** 0G's latest recorded reason for the intent's episode: the `decide` call's own words, shown as a quote, never spoken. */
const reasonOf = Effect.fnUntraced(function* (deps: ErrandDeps, episodeId: string | null) {
  if (episodeId === null) return null
  const decisions = yield* decisionsOf(deps.database, episodeId)
  return decisions.findLast((decision) => decision.reason !== null)?.reason ?? null
})

/** A `buy` turn: the shared intent operation, or the reason it cannot start, as Vita's words. */
const buy = Effect.fnUntraced(function* (deps: ErrandDeps, robot: RobotRow, merchant: Merchant, item: string | null) {
  const known = item === null ? Option.none() : findItem(merchant, item)
  if (Option.isNone(known)) return { errand: null, line: offMenuLine(merchant.items) }
  const instruction = voiceInstruction(known.value)
  return yield* createIntent(deps, { robot, instruction, item: known.value.itemId }).pipe(
    Effect.map((errand) => ({ errand, line: intentLine(errand, known) })),
    Effect.catchTag('ErrandRefused', (refused) =>
      refused.status === 409
        ? Effect.succeed({ errand: null, line: refused.error === 'robot is not paired' ? notPairedLine() : busyLine() })
        : Effect.fail(refused),
    ),
  )
})

/** Whether any errand of this robot is still under way (it may still pay whatever happens to its intents). */
const errandUnderWay = Effect.fnUntraced(function* (deps: ErrandDeps, robotId: string) {
  const live = yield* firstRow(
    deps.database.prepare(`SELECT state FROM episodes WHERE robot_id = ? AND state IN (${LIVE}) LIMIT 1`).bind(robotId),
    Schema.Struct({ state: Schema.String }),
  )
  return Option.isSome(live)
})

/**
 * A `stop` turn: ends the robot's open intent. Ending it cannot recall an errand already under way (this one's, or an
 * earlier one's), so the line warns while any is (the owner's Stop on Arc is the button with the passkey).
 */
const stop = Effect.fnUntraced(function* (deps: ErrandDeps, robot: RobotRow) {
  yield* settleIntents(deps.database, robot.id)
  const open = yield* openIntent(deps.database, robot.id)
  if (Option.isSome(open)) yield* endIntent(deps.database, open.value.id, 'stopped', 'stopped by the owner')
  const paying = yield* errandUnderWay(deps, robot.id)
  if (Option.isNone(open)) return { errand: null, line: stoppedLine(false, paying) }
  const stopped = yield* need(yield* readIntent(deps.database, open.value.id), 500, 'intent lost')
  return { errand: yield* intentView(deps.database, stopped), line: stoppedLine(true, paying) }
})

const turn = (deps: ErrandDeps) =>
  Effect.gen(function* () {
    const robot = yield* ownRobot(deps)
    const body = yield* need(
      yield* HttpServerRequest.schemaBodyJson(VoiceTurnRequest).pipe(Effect.option),
      400,
      'expected {"audio": "data:audio/wav;base64,…"} (at most about 15 s)',
    )
    const zeroG = yield* need(deps.zeroG, 503, 'not configured: ZG_API_KEY')
    const merchant = yield* need(findMerchant(MERCHANT_ID), 500, 'merchant catalogue is missing')
    const hearing = yield* hear(zeroG, body.audio, merchant.items)
    const answer: { readonly errand: VoiceTurn['errand']; readonly line: VoiceLine } =
      hearing.intent === 'buy'
        ? yield* buy(deps, robot, merchant, hearing.item)
        : hearing.intent === 'stop'
          ? yield* stop(deps, robot)
          : { errand: null, line: answerLine(hearing.topic, yield* factsOf(deps, robot, merchant)) }
    const speech = yield* speak(zeroG, answer.line, SPEECH_TIMEOUT)
    yield* Effect.logInfo('voice turn').pipe(
      Effect.annotateLogs({
        robotId: robot.id,
        intent: hearing.intent satisfies VoiceIntent,
        errandId: answer.errand?.id ?? null,
        requestId: hearing.requestId,
        hearMs: hearing.latencyMs,
        spoken: speech !== null,
      }),
    )
    return yield* json({
      heard: hearing.heard,
      intent: hearing.intent,
      item: hearing.intent === 'buy' ? hearing.item : null,
      errand: answer.errand,
      line: answer.line,
      speech,
      speechError: speech === null ? SPEECH_FAILED : null,
    } satisfies VoiceTurn)
  }).pipe(Effect.catchTag('ErrandRefused', ({ status, error }) => jsonError(status, error)))

const say = (deps: ErrandDeps) =>
  Effect.gen(function* () {
    const robot = yield* ownRobot(deps)
    const body = yield* need(
      yield* HttpServerRequest.schemaBodyJson(VoiceSayRequest).pipe(Effect.option),
      400,
      'expected {"intentId": string}',
    )
    const zeroG = yield* need(deps.zeroG, 503, 'not configured: ZG_API_KEY')
    const merchant = yield* need(findMerchant(MERCHANT_ID), 500, 'merchant catalogue is missing')
    yield* settleIntents(deps.database, robot.id)
    const intent = yield* need(
      Option.filter(yield* readIntent(deps.database, body.intentId), (row) => row.robot_id === robot.id),
      404,
      'unknown intent',
    )
    const errand = yield* intentView(deps.database, intent)
    const item = errand.item === null ? Option.none() : findItem(merchant, errand.item)
    const line = intentLine(errand, item)
    const decisionReason = yield* reasonOf(deps, errand.episodeId)
    const speech = yield* speak(zeroG, line, SPEECH_TIMEOUT)
    yield* Effect.logInfo('voice say').pipe(
      Effect.annotateLogs({
        robotId: robot.id,
        intentId: intent.id,
        state: errand.episodeState ?? errand.state,
        open: isOpenIntent(errand.state),
        spoken: speech !== null,
      }),
    )
    return yield* json({
      errand,
      line,
      decisionReason,
      speech,
      speechError: speech === null ? SPEECH_FAILED : null,
    } satisfies VoiceSay)
  }).pipe(Effect.catchTag('ErrandRefused', ({ status, error }) => jsonError(status, error)))

/** The owner's voice routes (session + Origin); `RobotAgent` mounts them only while `VOICE_ENABLED` is `true`. */
export const voiceRoutes = (deps: ErrandDeps) =>
  HttpRouter.addAll([
    HttpRouter.route('POST', '/api/robots/:robotId/voice', requireSession(turn(deps))),
    HttpRouter.route('POST', '/api/robots/:robotId/voice/say', requireSession(say(deps))),
  ])
