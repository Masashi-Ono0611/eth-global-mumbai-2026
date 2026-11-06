import { Schema } from 'effect'
import { Id } from './Base32.ts'
import { IntentView } from './Intent.ts'

// Vita's voice in the robot conversation (behind APP_VOICE_ENABLED). The owner holds to talk; the Worker sends the clip
// to the 0G Router's omni model, which only says what it heard and what kind of turn it is. The voice never decides a
// purchase: a `buy` turn creates the same errand intent as a Buy chip, and 0G's `decide` stays the only decision.
// Everything Vita says about an errand is built by code from the intent's real state, never by the voice model.

/** A WAV clip is at most this many characters as a data URI (about 15 s of 16 kHz mono 16-bit PCM). */
const VOICE_AUDIO_MAX = 700_000

/** `POST /api/robots/:robotId/voice` (owner session + Origin): one push-to-talk clip. */
export const VoiceTurnRequest = Schema.Struct({
  audio: Schema.String.check(
    Schema.isMaxLength(VOICE_AUDIO_MAX),
    Schema.isPattern(/^data:audio\/wav;base64,[A-Za-z0-9+/]+={0,2}$/),
  ),
})
export type VoiceTurnRequest = typeof VoiceTurnRequest.Type

export const VoiceIntent = Schema.Literals(['buy', 'question', 'stop'])
export type VoiceIntent = typeof VoiceIntent.Type

/** Vita's line: the words to show and speak, split so the page can light up the catchphrase. */
export const VoiceLine = Schema.Struct({
  /** The whole line, as spoken: opener, answer, closer. */
  text: Schema.String,
  opener: Schema.String,
  closer: Schema.String,
})
export type VoiceLine = typeof VoiceLine.Type

/**
 * Where the line's speech plays from: `GET /api/robots/:robotId/voice/speech/:key` (owner), made by `minimax-speech` on
 * the 0G Router on first play and kept, so the text shows at once and a repeated line plays at once. Null when the line
 * could not be saved for speech (the text stands, with `speechError`).
 */
const VoiceSpeech = Schema.NullOr(Schema.Struct({ url: Schema.String }))

/** The answer to one clip. */
export const VoiceTurn = Schema.Struct({
  /** What Vita heard (the omni model's English transcript), shown as the owner's bubble. Never stored or logged. */
  heard: Schema.String,
  intent: VoiceIntent,
  /** The catalogue item of a `buy` turn. */
  item: Schema.NullOr(Schema.String),
  /** The intent a `buy` turn created (the same one a Buy chip creates), or the one a `stop` turn stopped. */
  errand: Schema.NullOr(IntentView),
  line: VoiceLine,
  speech: VoiceSpeech,
  /** Set when the line cannot be spoken: the page shows it (the turn and its intent stand). */
  speechError: Schema.NullOr(Schema.String),
})
export type VoiceTurn = typeof VoiceTurn.Type

/** `POST /api/robots/:robotId/voice/say` (owner): Vita's line for an intent's current state, built from that state. */
export const VoiceSayRequest = Schema.Struct({ intentId: Id })
export type VoiceSayRequest = typeof VoiceSayRequest.Type

export const VoiceSay = Schema.Struct({
  errand: IntentView,
  line: VoiceLine,
  /** 0G's own reason for its latest decision (model text): the page shows it as a quote; Vita never speaks it. */
  decisionReason: Schema.NullOr(Schema.String),
  speech: VoiceSpeech,
  speechError: Schema.NullOr(Schema.String),
})
export type VoiceSay = typeof VoiceSay.Type
