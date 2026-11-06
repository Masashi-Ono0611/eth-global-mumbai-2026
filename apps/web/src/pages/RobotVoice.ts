import { IntentView, isOpenIntent } from '@ethmumbai/protocol/Intent'
import { VoiceLine, VoiceSay, VoiceTurn } from '@ethmumbai/protocol/Voice'
import { Effect, Option, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import type * as HttpClient from 'effect/http/HttpClient'
import { sayIntent, sendVoiceTurn, voiceAvailable } from '../api/Voice.ts'
import { playSpeech, startListening, stopListening } from '../Microphone.ts'

// Vita's voice in the robot conversation (issue #5, Kris's voice mock). Hold to talk: the clip goes to the Worker, which
// asks the 0G Router what the owner wants; a spoken buy creates the same errand intent as a "Get me" chip, so the
// conversation follows it as it follows any intent (OutMessage.StartedIntent). Vita's lines come from the Worker, built
// from the errand's real state; this page only shows them and plays the speech.

// MODEL

const FailReason = Schema.Literals(['blocked', 'unsupported', 'zeroG', 'tooShort'])
type FailReason = typeof FailReason.Type

export const Status = defineTaggedUnion({
  /** This release has no voice routes, or the check has not answered yet: no mic button. */
  Unavailable: {},
  Idle: {},
  /** The button is held and the mic permission or the stream is starting. */
  Starting: { pressedAt: Schema.Number },
  /** The mic is open while the button is held, at most LISTEN_LIMIT_MILLIS. */
  Listening: { pressedAt: Schema.Number },
  /** The clip is with the Worker and 0G. */
  Thinking: {},
  Speaking: {},
  Failed: { reason: FailReason, detail: Schema.String },
})
export type Status = typeof Status.Type

/** One bubble of the spoken exchange: what Vita heard from the owner, or Vita's line (with its catchphrases). */
export const Entry = Schema.Struct({
  id: Schema.Number,
  speaker: Schema.Literals(['owner', 'vita']),
  text: Schema.String,
  line: Schema.Option(VoiceLine),
  /** 0G's own reason, shown as a quote under Vita's line, never spoken (VoiceSay.decisionReason). */
  maybeReason: Schema.Option(Schema.String),
})
export type Entry = typeof Entry.Type

export const Model = Schema.Struct({
  robotId: Schema.String,
  status: Status,
  entries: Schema.Array(Entry),
  /** The intent a spoken buy started, and the state Vita last spoke for it (`state/episodeState`). */
  maybeFollowing: Schema.Option(Schema.Struct({ intentId: Schema.String, spokenState: Schema.String })),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  CompletedCheckVoice: { available: Schema.Boolean },
  /** `at`: the event's timeStamp (ms), which tells this hold's time limit from an earlier one's. */
  PressedTalk: { at: Schema.Number },
  ReleasedTalk: {},
  CompletedLimitListening: { pressedAt: Schema.Number },
  CompletedStartListening: {},
  FailedStartListening: { reason: Schema.Literals(['blocked', 'unsupported']) },
  CompletedStopListening: { maybeAudio: Schema.Option(Schema.String) },
  SucceededVoiceTurn: { turn: VoiceTurn },
  FailedVoiceTurn: { error: Schema.String },
  SucceededSayIntent: { say: VoiceSay },
  FailedSayIntent: { error: Schema.String },
  CompletedPlaySpeech: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ StartedIntent: { intent: IntentView } })
export type OutMessage = typeof OutMessage.Type

// COMMAND

export const CheckVoice = Command.define('CheckVoice', {
  messages: [Message.CompletedCheckVoice],
  execute: voiceAvailable.pipe(
    Effect.map((available) => Message.CompletedCheckVoice({ available })),
    Effect.catch(() => Effect.succeed(Message.CompletedCheckVoice({ available: false }))),
  ),
})

/** @internal Exported for the voice tests; this page's update is its only production caller. */
export const StartListening = Command.define('StartListening', {
  messages: [Message.CompletedStartListening, Message.FailedStartListening],
  execute: startListening.pipe(
    Effect.as(Message.CompletedStartListening()),
    Effect.catch((failure) => Effect.succeed(Message.FailedStartListening({ reason: failure.reason }))),
  ),
})

/** @internal Exported for the voice tests; this page's update is its only production caller. */
export const StopListening = Command.define('StopListening', {
  messages: [Message.CompletedStopListening],
  execute: stopListening.pipe(Effect.map((maybeAudio) => Message.CompletedStopListening({ maybeAudio }))),
})

/** The longest the mic stays open, even while held (the Worker takes about 15 s of audio). */
const LISTEN_LIMIT_MILLIS = 14_000

/** Sends a hold that goes past LISTEN_LIMIT_MILLIS; a later press makes this one stale.
 * @internal Exported for the voice tests; this page's update is its only production caller.
 */
export const LimitListening = Command.define('LimitListening', {
  args: { pressedAt: Schema.Number },
  messages: [Message.CompletedLimitListening],
  execute: ({ pressedAt }) =>
    Effect.sleep(LISTEN_LIMIT_MILLIS).pipe(Effect.as(Message.CompletedLimitListening({ pressedAt }))),
})

/** @internal Exported for the voice tests; this page's update is its only production caller. */
export const SendVoiceTurn = Command.define('SendVoiceTurn', {
  args: { robotId: Schema.String, audio: Schema.String },
  messages: [Message.SucceededVoiceTurn, Message.FailedVoiceTurn],
  execute: ({ robotId, audio }) =>
    Effect.match(sendVoiceTurn(robotId, audio), {
      onSuccess: (turn) => Message.SucceededVoiceTurn({ turn }),
      onFailure: (failure) => Message.FailedVoiceTurn({ error: failure.error }),
    }),
})

/** @internal Exported for the voice tests; this page's update is its only production caller. */
export const SayIntent = Command.define('SayIntent', {
  args: { robotId: Schema.String, intentId: Schema.String },
  messages: [Message.SucceededSayIntent, Message.FailedSayIntent],
  execute: ({ robotId, intentId }) =>
    Effect.match(sayIntent(robotId, intentId), {
      onSuccess: (say) => Message.SucceededSayIntent({ say }),
      onFailure: (failure) => Message.FailedSayIntent({ error: failure.error }),
    }),
})

/** @internal Exported for the voice tests; this page's update is its only production caller. */
export const PlaySpeech = Command.define('PlaySpeech', {
  args: { url: Schema.String },
  messages: [Message.CompletedPlaySpeech],
  execute: ({ url }) => playSpeech(url).pipe(Effect.as(Message.CompletedPlaySpeech())),
})

// INIT

export const init = (robotId: string): Model => ({
  robotId,
  status: Status.Unavailable(),
  entries: [],
  maybeFollowing: Option.none(),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, HttpClient.HttpClient>

const stateKey = (intent: IntentView) => `${intent.state}/${intent.episodeState ?? ''}`

const nextId = (model: Model) => (model.entries.at(-1)?.id ?? 0) + 1

/** Vita's line joins the conversation; with speech it plays, otherwise the line stands as text. */
const vitaSays = (
  model: Model,
  line: VoiceLine,
  speech: { readonly url: string } | null,
  maybeReason: Option.Option<string>,
): UpdateReturn => {
  const entry: Entry = { id: nextId(model), speaker: 'vita', text: line.text, line: Option.some(line), maybeReason }
  const entries = [...model.entries, entry]
  return speech === null
    ? { model: modifyFields(model, { entries: () => entries, status: () => Status.Idle() }) }
    : {
        model: modifyFields(model, { entries: () => entries, status: () => Status.Speaking() }),
        commands: [PlaySpeech({ url: speech.url })],
      }
}

const heardTurn = (model: Model, turn: VoiceTurn): UpdateReturn => {
  const owner: Entry = {
    id: nextId(model),
    speaker: 'owner',
    text: turn.heard,
    line: Option.none(),
    maybeReason: Option.none(),
  }
  const withOwner = modifyFields(model, { entries: () => [...model.entries, owner] })
  const errand = turn.errand
  const following =
    errand !== null && isOpenIntent(errand.state)
      ? Option.some({ intentId: errand.id, spokenState: stateKey(errand) })
      : withOwner.maybeFollowing
  const said = vitaSays(
    modifyFields(withOwner, { maybeFollowing: () => following }),
    turn.line,
    turn.speech,
    Option.none(),
  )
  return errand === null ? said : { ...said, outMessage: OutMessage.StartedIntent({ intent: errand }) }
}

/** The conversation read the intent again: Vita speaks a state of the intent she started once, when it changes. */
export const followIntent =
  (intent: IntentView) =>
  (model: Model): UpdateReturn => {
    const key = stateKey(intent)
    return Option.match(model.maybeFollowing, {
      onNone: () => ({ model }),
      onSome: (following) =>
        following.intentId !== intent.id || following.spokenState === key
          ? { model }
          : {
              model: modifyFields(model, {
                maybeFollowing: () =>
                  isOpenIntent(intent.state) ? Option.some({ ...following, spokenState: key }) : Option.none(),
              }),
              commands: [SayIntent({ robotId: model.robotId, intentId: intent.id })],
            },
    })
  }

const failed = (model: Model, reason: FailReason, detail: string): UpdateReturn => ({
  model: modifyFields(model, { status: () => Status.Failed({ reason, detail }) }),
})

const canTalk = (status: Status) => Status.guards.Idle(status) || Status.guards.Failed(status)

const send = (model: Model): UpdateReturn => ({
  model: modifyFields(model, { status: () => Status.Thinking() }),
  commands: [StopListening()],
})
const idle = (model: Model): UpdateReturn => ({ model: modifyFields(model, { status: () => Status.Idle() }) })

/** Press: the mic opens for as long as the button is held. */
const pressed = (model: Model, at: number): UpdateReturn =>
  canTalk(model.status)
    ? {
        model: modifyFields(model, { status: () => Status.Starting({ pressedAt: at }) }),
        commands: [StartListening(), LimitListening({ pressedAt: at })],
      }
    : { model }

/** Release: send what was said; a release before the mic opened records nothing. */
const released = (model: Model): UpdateReturn =>
  Status.guards.Listening(model.status) ? send(model) : Status.guards.Starting(model.status) ? idle(model) : { model }

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    CompletedCheckVoice: ({ available }) => ({
      model: modifyFields(model, { status: () => (available ? Status.Idle() : Status.Unavailable()) }),
    }),
    PressedTalk: ({ at }) => pressed(model, at),
    CompletedStartListening: () => {
      const { status } = model
      return Status.guards.Starting(status)
        ? {
            model: modifyFields(model, { status: () => Status.Listening({ pressedAt: status.pressedAt }) }),
          }
        : { model, commands: [StopListening()] }
    },
    FailedStartListening: ({ reason }) => failed(model, reason, ''),
    ReleasedTalk: () => released(model),
    CompletedLimitListening: ({ pressedAt }) =>
      Status.guards.Listening(model.status) && model.status.pressedAt === pressedAt ? send(model) : { model },
    CompletedStopListening: ({ maybeAudio }) =>
      Status.guards.Thinking(model.status)
        ? Option.match(maybeAudio, {
            onNone: () => failed(model, 'tooShort', ''),
            onSome: (audio) => ({ model, commands: [SendVoiceTurn({ robotId: model.robotId, audio })] }),
          })
        : { model },
    SucceededVoiceTurn: ({ turn }) => heardTurn(model, turn),
    FailedVoiceTurn: ({ error }) => failed(model, 'zeroG', error),
    SucceededSayIntent: ({ say }) =>
      Status.guards.Listening(model.status) || Status.guards.Starting(model.status)
        ? { model }
        : vitaSays(model, say.line, say.speech, Option.fromNullishOr(say.decisionReason)),
    FailedSayIntent: () => ({ model }),
    CompletedPlaySpeech: () =>
      Status.guards.Speaking(model.status)
        ? { model: modifyFields(model, { status: () => Status.Idle() }) }
        : { model },
  })
