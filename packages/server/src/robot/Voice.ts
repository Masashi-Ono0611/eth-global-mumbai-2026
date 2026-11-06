import { isOpenIntent } from '@ethmumbai/protocol/Intent'
import {
  VoiceSayRequest,
  type VoiceIntent,
  type VoiceLine,
  type VoiceSay,
  type VoiceTurn,
  VoiceTurnRequest,
  type VoiceWarm,
} from '@ethmumbai/protocol/Voice'
import { Clock, type Duration, Effect, Option, Redacted, Result, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { latestSignedGrant, spentInPeriod } from './Budget.ts'
import { decisionsOf } from './Decide.ts'
import { type ErrandDeps, LIVE_STATES } from './Errands.ts'
import { createIntent, endIntent, intentView, openIntent, ownRobot, settleIntents } from './Intents.ts'
import { readIntent } from './IntentRows.ts'
import { ErrandRefused, MERCHANT_ID, need } from './Start.ts'
import {
  answerLine,
  busyLine,
  fixedLines,
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
import { json, jsonError, nowSeconds, sha256Hex } from '../Respond.ts'
import { firstRow } from '../Sql.ts'

const LIVE = LIVE_STATES.map((state) => `'${state}'`).join(', ')

// Vita's voice in the robot conversation (protocol Voice.ts), always mounted. Three 0G Router calls, all with the
// Worker's key: `whisper-large-v3` transcribes the owner's clip and `0gm-1.0-35b-a3b` classifies the transcript, both
// on TeeML providers (each reply carries a TEE signature anyone can check with 0G's SDK), and `minimax-speech` speaks
// the line (no TEE; it only reads a sentence built by code). The voice models never decide: a `buy` turn calls
// `createIntent`, the one operation the Buy chips and typed text use, and the robot's scan then runs 0G's `decide`
// (TEE-proven) as for any errand. Audio, transcripts and prompts are never stored or logged; logs carry the robot,
// the turn's kind, latencies, the 0G request ids and the providers that answered.

/** The sealed (TeeML) speech-to-text model that transcribes the clip. 3/3 verbatim and TEE-verified on 7 Nov. */
export const TRANSCRIBE_MODEL = 'whisper-large-v3'
/**
 * The sealed (TeeML) model that classifies the transcript (text in, JSON out), 0G's own. 16/16 on the demo phrases on
 * 7 Nov, median 1.5 s with thinking off; whisper plus this is about 3.4 s against 2.5 s for the unsealed omni model.
 */
export const VOICE_MODEL = '0gm-1.0-35b-a3b'
/** Thinking is on by default for 0GM; off, the classification fits the turn (the field is per model). */
const VOICE_EXTRA = { chat_template_kwargs: { enable_thinking: false } }
/**
 * The 0G Router's text-to-speech model; the page pitches it up for the duck. 2.6 Turbo over 2.8 Turbo (7 Nov): the
 * whole MP3 in a median 3.6 s (at most 4.0 s) against 5.3 s (at most 6.9 s), the same voice and tempo.
 */
export const SPEECH_MODEL = 'minimax-speech-2.6-turbo'
/** How many fixed lines `…/voice/warm` asks the speech model for at once. */
const WARM_CONCURRENCY = 4
const SPEECH_VOICE = 'English_PlayfulGirl'
/** The demo kit's tempo (0.95) over its browser pitch-up (1.16), so the heard pace stays normal. */
const SPEECH_SPEED = 0.82
/** Shown when only the speech failed: the turn (and any intent it created) stands, Vita's line is shown as text. */
const SPEECH_FAILED = 'Vita could not speak this line; showing it as text'
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

const Transcription = Schema.Struct({
  text: Schema.String,
  x_0g_trace: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        request_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
        provider: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
})
const decodeTranscription = Schema.decodeUnknownOption(Schema.fromJsonString(Transcription))

/** The clip's bytes from its WAV data URI (the request schema already checked the shape). */
const wavBytes = (audio: string) => Uint8Array.from(atob(audio.slice(audio.indexOf(',') + 1)), (c) => c.charCodeAt(0))

/**
 * `POST {ZG_BASE_URL}/audio/transcriptions` (multipart, as OpenAI's): the clip's English transcript. A failure is a
 * reason that names the status or the shape, never the reply's text.
 */
const transcribe = Effect.fnUntraced(function* (zeroG: ZeroGConfig, audio: string) {
  const started = yield* Clock.currentTimeMillis
  const form = new FormData()
  form.append('model', TRANSCRIBE_MODEL)
  form.append('language', 'en')
  form.append('response_format', 'json')
  form.append('file', new Blob([wavBytes(audio)], { type: 'audio/wav' }), 'clip.wav')
  const reply = yield* Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const response = yield* client.execute(
      HttpClientRequest.post(`${zeroG.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`).pipe(
        HttpClientRequest.bearerToken(Redacted.value(zeroG.apiKey)),
        HttpClientRequest.bodyFormData(form),
      ),
    )
    return { status: response.status, text: yield* response.text }
  }).pipe(Effect.timeout(HEAR_TIMEOUT), Effect.result, Effect.provide(FetchHttpClient.layer))
  const latencyMs = (yield* Clock.currentTimeMillis) - started
  if (Result.isFailure(reply)) return { ok: false as const, error: 'the transcription did not answer', latencyMs }
  if (reply.success.status !== 200)
    return { ok: false as const, error: `0G answered ${reply.success.status} to the transcription`, latencyMs }
  const parsed = decodeTranscription(reply.success.text)
  if (Option.isNone(parsed)) return { ok: false as const, error: 'the transcription is not JSON text', latencyMs }
  const trace = parsed.value.x_0g_trace
  return {
    ok: true as const,
    text: parsed.value.text.trim(),
    requestId: trace?.request_id ?? null,
    provider: trace?.provider ?? null,
    latencyMs,
  }
})

/** Why a hearing failed, for the owner in plain words (the log keeps the technical reason). */
const unusable = Effect.fnUntraced(function* (error: string) {
  yield* Effect.logWarning(`voice: 0G hearing unusable: ${error}`)
  const said = error === 'heard nothing' ? 'Vita did not catch that' : 'Vita did not understand that'
  return yield* new ErrandRefused({ status: 502, error: said })
})

/**
 * What the owner said, in two sealed calls: whisper transcribes the clip, then 0GM classifies the transcript. Any
 * failure is a visible 502 and nothing starts; an empty transcript is not classified (Vita does not guess).
 */
export const hear = Effect.fnUntraced(function* (zeroG: ZeroGConfig, audio: string, items: VoiceFacts['items']) {
  const transcript = yield* transcribe(zeroG, audio)
  if (!transcript.ok) {
    yield* Effect.logWarning(`voice: 0G transcription failed: ${transcript.error}`)
    return yield* new ErrandRefused({ status: 502, error: `0G did not answer: ${transcript.error}` })
  }
  if (transcript.text.length === 0) return yield* unusable('heard nothing')
  const config: ZeroGConfig = {
    baseUrl: zeroG.baseUrl,
    apiKey: zeroG.apiKey,
    model: VOICE_MODEL,
    extraBody: VOICE_EXTRA,
  }
  const outcome = yield* zeroGChat(
    config,
    {
      temperature: 0,
      stream: false,
      messages: [
        { role: 'system', content: hearingPrompt(items) },
        { role: 'user', content: transcript.text },
      ],
    },
    { timeout: HEAR_TIMEOUT },
  ).pipe(Effect.provide(FetchHttpClient.layer))
  if (!outcome.ok) return yield* new ErrandRefused({ status: 502, error: `0G did not answer: ${outcome.error}` })
  const hearing = parseHearing(outcome.message, items)
  if (!hearing.ok) return yield* unusable(hearing.error)
  return {
    ...hearing,
    // What Vita heard is whisper's transcript, not the classifier's retelling of it.
    heard: transcript.text.slice(0, 200),
    transcribeRequestId: transcript.requestId,
    transcribeProvider: transcript.provider,
    transcribeMs: transcript.latencyMs,
    requestId: outcome.call.requestId,
    provider: outcome.call.provider,
    latencyMs: outcome.call.latencyMs,
  }
})

/**
 * `POST {ZG_BASE_URL}/audio/speech`: the line as MP3 bytes. A failure is `null` (the text still shows) and one warning
 * with the status only.
 */
const speak = Effect.fnUntraced(function* (zeroG: ZeroGConfig, text: string, timeout: Duration.Input) {
  const started = yield* Clock.currentTimeMillis
  const reply = yield* Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const response = yield* client.execute(
      HttpClientRequest.post(`${zeroG.baseUrl.replace(/\/+$/, '')}/audio/speech`).pipe(
        HttpClientRequest.bearerToken(Redacted.value(zeroG.apiKey)),
        HttpClientRequest.bodyText(
          JSON.stringify({ model: SPEECH_MODEL, input: text, voice: SPEECH_VOICE, speed: SPEECH_SPEED }),
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
  return reply.success.bytes
})

/** Where a line's text and its speech live in the private bucket, by the hash of everything that shapes the audio. */
const speechKey = (text: string) => sha256Hex(`${SPEECH_MODEL}|${SPEECH_VOICE}|${SPEECH_SPEED}|${text}`)
/** A line is saved per robot: a speech key plays only for the robot whose conversation produced that line. */
const linePath = (robotId: string, key: string) => `voice/${robotId}/lines/${key}.txt`
const audioPath = (key: string) => `voice/speech/${key}.mp3`

/**
 * The line's speech, without waiting for it: the text is saved under its hash and the browser fetches the audio from
 * `GET …/voice/speech/:key`, so Vita's words show while the voice is made. A save failure leaves the line as text.
 */
const speechFor = Effect.fnUntraced(function* (media: ReadWriteBucketClient, robotId: string, line: VoiceLine) {
  const key = yield* speechKey(line.text)
  const saved = yield* media
    .put(linePath(robotId, key), line.text, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } })
    .pipe(Effect.result)
  if (Result.isFailure(saved)) {
    yield* Effect.logWarning('voice: the line could not be saved for speech')
    return { speech: null, speechError: SPEECH_FAILED }
  }
  return { speech: { url: `/api/robots/${robotId}/voice/speech/${key}` }, speechError: null }
})

/** 0G's latest recorded reason for the intent's episode: the `decide` call's own words, shown as a quote, never spoken. */
const reasonOf = Effect.fnUntraced(function* (deps: ErrandDeps, episodeId: string | null) {
  if (episodeId === null) return null
  const decisions = yield* decisionsOf(deps.database, episodeId)
  return decisions.findLast((decision) => decision.reason !== null)?.reason ?? null
})

/** A `buy` turn: the shared intent operation (with the brain the owner picked), or why it cannot start, as Vita's words. */
const buy = Effect.fnUntraced(function* (
  deps: ErrandDeps,
  robot: RobotRow,
  merchant: Merchant,
  item: string | null,
  model: string | null | undefined,
) {
  const known = item === null ? Option.none() : findItem(merchant, item)
  if (Option.isNone(known)) return { errand: null, line: offMenuLine(merchant.items) }
  const instruction = voiceInstruction(known.value)
  return yield* createIntent(deps, { robot, instruction, item: known.value.itemId, model }).pipe(
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

const turn = (deps: VoiceDeps) =>
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
        ? yield* buy(deps, robot, merchant, hearing.item, body.model)
        : hearing.intent === 'stop'
          ? yield* stop(deps, robot)
          : { errand: null, line: answerLine(hearing.topic, yield* factsOf(deps, robot, merchant)) }
    const spoken = yield* speechFor(deps.media, robot.id, answer.line)
    yield* Effect.logInfo('voice turn').pipe(
      Effect.annotateLogs({
        robotId: robot.id,
        intent: hearing.intent satisfies VoiceIntent,
        errandId: answer.errand?.id ?? null,
        transcribeRequestId: hearing.transcribeRequestId,
        transcribeProvider: hearing.transcribeProvider,
        transcribeMs: hearing.transcribeMs,
        requestId: hearing.requestId,
        provider: hearing.provider,
        hearMs: hearing.latencyMs,
        spoken: spoken.speech !== null,
      }),
    )
    return yield* json({
      heard: hearing.heard,
      intent: hearing.intent,
      item: hearing.intent === 'buy' ? hearing.item : null,
      errand: answer.errand,
      line: answer.line,
      ...spoken,
    } satisfies VoiceTurn)
  }).pipe(Effect.catchTag('ErrandRefused', ({ status, error }) => jsonError(status, error)))

const say = (deps: VoiceDeps) =>
  Effect.gen(function* () {
    const robot = yield* ownRobot(deps)
    const body = yield* need(
      yield* HttpServerRequest.schemaBodyJson(VoiceSayRequest).pipe(Effect.option),
      400,
      'expected {"intentId": string}',
    )
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
    const spoken = yield* speechFor(deps.media, robot.id, line)
    yield* Effect.logInfo('voice say').pipe(
      Effect.annotateLogs({
        robotId: robot.id,
        intentId: intent.id,
        state: errand.episodeState ?? errand.state,
        open: isOpenIntent(errand.state),
        spoken: spoken.speech !== null,
      }),
    )
    return yield* json({ errand, line, decisionReason, ...spoken } satisfies VoiceSay)
  }).pipe(Effect.catchTag('ErrandRefused', ({ status, error }) => jsonError(status, error)))

const SpeechPath = Schema.Struct({ key: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)) })

/**
 * `GET …/voice/speech/:key` (owner): the line's MP3. Made once by `minimax-speech` on the 0G Router and kept in the
 * private bucket, so a line Vita said before plays at once. Only lines the voice routes saved can be spoken.
 */
const speech = (deps: VoiceDeps) =>
  Effect.gen(function* () {
    const robot = yield* ownRobot(deps)
    const path = yield* need(yield* HttpRouter.schemaPathParams(SpeechPath).pipe(Effect.option), 404, 'unknown line')
    const { key } = path
    const audioHeaders = { 'cache-control': 'private, max-age=86400' }
    // This robot's conversation must have produced the line before any audio, cached or new, is served.
    const lineObject = yield* deps.media.get(linePath(robot.id, key)).pipe(Effect.option)
    if (Option.isNone(lineObject)) return yield* jsonError(502, 'R2 did not answer')
    if (lineObject.value === null) return yield* jsonError(404, 'unknown line')
    const saved = yield* deps.media.get(audioPath(key)).pipe(Effect.option)
    if (Option.isSome(saved) && saved.value !== null)
      return HttpServerResponse.stream(saved.value.body, { contentType: 'audio/mpeg', headers: audioHeaders })
    const zeroG = yield* need(deps.zeroG, 503, 'not configured: ZG_API_KEY')
    const text = yield* lineObject.value.text().pipe(Effect.option)
    if (Option.isNone(text)) return yield* jsonError(502, 'R2 did not answer')
    const bytes = yield* speak(zeroG, text.value, SPEECH_TIMEOUT)
    if (bytes === null) return yield* jsonError(502, SPEECH_FAILED)
    yield* deps.media.put(audioPath(key), bytes, { httpMetadata: { contentType: 'audio/mpeg' } }).pipe(Effect.ignore)
    return HttpServerResponse.uint8Array(bytes, { contentType: 'audio/mpeg', headers: audioHeaders })
  }).pipe(Effect.catchTag('ErrandRefused', ({ status, error }) => jsonError(status, error)))

/** One fixed line's speech in the bucket: already there, made now, or not made (the line still shows as text). */
const ensureSpeech = Effect.fnUntraced(function* (media: ReadWriteBucketClient, zeroG: ZeroGConfig, text: string) {
  const path = audioPath(yield* speechKey(text))
  const there = yield* media.head(path).pipe(Effect.option)
  if (Option.isSome(there) && there.value !== null) return 'ready' as const
  const bytes = yield* speak(zeroG, text, SPEECH_TIMEOUT)
  if (bytes === null) return 'failed' as const
  const saved = yield* media.put(path, bytes, { httpMetadata: { contentType: 'audio/mpeg' } }).pipe(Effect.result)
  return Result.isSuccess(saved) ? ('made' as const) : ('failed' as const)
})

/**
 * `POST …/voice/warm` (owner): makes the speech of every fixed line (`fixedLines`) that is not in the bucket yet, so
 * those lines play at once instead of after the 3 to 4 s the speech model takes. The page calls it when the conversation
 * opens; a line made once serves every robot (the speech path is the text's hash). A line that fails stays as it was and
 * is made on its first play, as before.
 */
const warm = (deps: VoiceDeps) =>
  Effect.gen(function* () {
    yield* ownRobot(deps)
    const zeroG = yield* need(deps.zeroG, 503, 'not configured: ZG_API_KEY')
    const merchant = yield* need(findMerchant(MERCHANT_ID), 500, 'merchant catalogue is missing')
    const lines = fixedLines(merchant.items)
    const results = yield* Effect.forEach(lines, (line) => ensureSpeech(deps.media, zeroG, line.text), {
      concurrency: WARM_CONCURRENCY,
    })
    const count = (result: (typeof results)[number]) => results.filter((each) => each === result).length
    const answer = { lines: lines.length, ready: count('ready'), made: count('made'), failed: count('failed') }
    yield* Effect.logInfo('voice warm').pipe(Effect.annotateLogs(answer))
    return yield* json(answer satisfies VoiceWarm)
  }).pipe(Effect.catchTag('ErrandRefused', ({ status, error }) => jsonError(status, error)))

/** The voice routes need the private bucket too: a line's text and its speech live there. */
export interface VoiceDeps extends ErrandDeps {
  readonly media: ReadWriteBucketClient
}

/** The owner's voice routes (session + Origin); `RobotAgent` always mounts them (no flag). */
export const voiceRoutes = (deps: VoiceDeps) =>
  HttpRouter.addAll([
    HttpRouter.route('POST', '/api/robots/:robotId/voice', requireSession(turn(deps))),
    HttpRouter.route('POST', '/api/robots/:robotId/voice/say', requireSession(say(deps))),
    HttpRouter.route('POST', '/api/robots/:robotId/voice/warm', requireSession(warm(deps))),
    HttpRouter.route('GET', '/api/robots/:robotId/voice/speech/:key', requireSession(speech(deps))),
  ])
