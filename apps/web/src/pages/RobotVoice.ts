import { IntentView, isOpenIntent } from '@ethmumbai/protocol/Intent'
import { VoiceLine, VoiceSay, VoiceTurn } from '@ethmumbai/protocol/Voice'
import { Effect, Option, Schema } from 'effect'
import { Command, Dom, type Update } from 'foldkit'
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

const FailReason = Schema.Literals(['blocked', 'unsupported', 'zeroG', 'tooShort', 'speech'])
type FailReason = typeof FailReason.Type

export const Status = defineTaggedUnion({
  /** This release has no voice routes, or the check has not answered yet: no mic button. */
  Unavailable: {},
  Idle: {},
  /** The button is held and the mic permission or the stream is starting. */
  Starting: { holdId: Schema.Number },
  /** The mic is open while the button is held, at most LISTEN_LIMIT_MILLIS. */
  Listening: { holdId: Schema.Number },
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
  /** `turn`: a spoken request and Vita's answer (shown before the live errand's messages); `narration`: Vita saying
   *  the errand's new state (shown after them), so the thread reads in order. */
  kind: Schema.Literals(['turn', 'narration']),
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
  /** Counts accepted presses: each hold's id, so its mic, its stop and its time limit never touch another hold. */
  holds: Schema.Number,
  /** The brain picked in the composer (none = ZG_MODEL), sent with a spoken buy as a typed message sends it. */
  maybeBrain: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  CompletedCheckVoice: { available: Schema.Boolean },
  PressedTalk: {},
  ReleasedTalk: {},
  CompletedLimitListening: { holdId: Schema.Number },
  /** `holdId` names the hold the mic opened for: a late answer for an earlier hold never touches a newer one. */
  CompletedStartListening: { holdId: Schema.Number },
  FailedStartListening: {
    holdId: Schema.Number,
    reason: Schema.Literals(['blocked', 'unsupported', 'superseded', 'hidden']),
  },
  /** `closed`: a guard had closed the mic already (page hidden, past its time): nothing to send, no error. */
  CompletedStopListening: { maybeAudio: Schema.Option(Schema.String), closed: Schema.Boolean },
  SucceededVoiceTurn: { turn: VoiceTurn },
  FailedVoiceTurn: { error: Schema.String },
  SucceededSayIntent: { say: VoiceSay },
  FailedSayIntent: { error: Schema.String },
  CompletedPlaySpeech: { played: Schema.Boolean },
  CompletedShowNewest: {},
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
  args: { holdId: Schema.Number },
  messages: [Message.CompletedStartListening, Message.FailedStartListening],
  execute: ({ holdId }) =>
    startListening(holdId).pipe(
      Effect.as(Message.CompletedStartListening({ holdId })),
      Effect.catch((failure) => Effect.succeed(Message.FailedStartListening({ holdId, reason: failure.reason }))),
    ),
})

/** @internal Exported for the voice tests; this page's update is its only production caller. */
export const StopListening = Command.define('StopListening', {
  messages: [Message.CompletedStopListening],
  execute: stopListening.pipe(
    Effect.map(({ maybeAudio, closed }) => Message.CompletedStopListening({ maybeAudio, closed })),
  ),
})

/** The longest the mic stays open, even while held (the Worker takes about 15 s of audio). */
const LISTEN_LIMIT_MILLIS = 14_000

/** Sends a hold that goes past LISTEN_LIMIT_MILLIS after the mic opened; a later hold makes this one stale.
 * @internal Exported for the voice tests; this page's update is its only production caller.
 */
export const LimitListening = Command.define('LimitListening', {
  args: { holdId: Schema.Number },
  messages: [Message.CompletedLimitListening],
  execute: ({ holdId }) =>
    Effect.sleep(LISTEN_LIMIT_MILLIS).pipe(Effect.as(Message.CompletedLimitListening({ holdId }))),
})

/** @internal Exported for the voice tests; this page's update is its only production caller. */
export const SendVoiceTurn = Command.define('SendVoiceTurn', {
  args: { robotId: Schema.String, audio: Schema.String, model: Schema.NullOr(Schema.String) },
  messages: [Message.SucceededVoiceTurn, Message.FailedVoiceTurn],
  execute: ({ robotId, audio, model }) =>
    Effect.match(sendVoiceTurn(robotId, audio, model), {
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
  execute: ({ url }) => playSpeech(url).pipe(Effect.map((played) => Message.CompletedPlaySpeech({ played }))),
})

/** Scrolls to the end of the page, so the newest bubble shows above the dock.
 * @internal Exported for the voice tests; this page's update is its only production caller.
 */
export const ShowNewest = Command.define('ShowNewest', {
  messages: [Message.CompletedShowNewest],
  execute: Dom.scrollIntoView('#main', { block: 'end' }).pipe(Effect.ignore, Effect.as(Message.CompletedShowNewest())),
})

// INIT

export const init = (robotId: string): Model => ({
  robotId,
  status: Status.Unavailable(),
  entries: [],
  maybeFollowing: Option.none(),
  holds: 0,
  maybeBrain: Option.none(),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, HttpClient.HttpClient>

const stateKey = (intent: IntentView) => `${intent.state}/${intent.episodeState ?? ''}`

const nextId = (model: Model) => (model.entries.at(-1)?.id ?? 0) + 1

/** The owner is mid-turn (holding the mic, or the clip is with 0G): state lines then join the thread silently. */
const inTurn = (status: Status) =>
  Status.guards.Starting(status) || Status.guards.Listening(status) || Status.guards.Thinking(status)

/** Vita's line joins the conversation; with speech it plays, otherwise the line stands as text (and says why). */
const vitaSays = (
  model: Model,
  kind: Entry['kind'],
  line: VoiceLine,
  spoken: { readonly speech: { readonly url: string } | null; readonly speechError: string | null },
  maybeReason: Option.Option<string>,
): UpdateReturn => {
  const entry: Entry = {
    id: nextId(model),
    speaker: 'vita',
    kind,
    text: line.text,
    line: Option.some(line),
    maybeReason,
  }
  const entries = [...model.entries, entry]
  // Mid-turn, or while Vita still speaks a line: the new line joins the thread silently (never two voices at once).
  if (inTurn(model.status) || Status.guards.Speaking(model.status))
    return { model: modifyFields(model, { entries: () => entries }), commands: [ShowNewest()] }
  if (spoken.speech === null)
    return {
      model: modifyFields(model, {
        entries: () => entries,
        status: () =>
          spoken.speechError === null ? Status.Idle() : Status.Failed({ reason: 'speech', detail: spoken.speechError }),
      }),
      commands: [ShowNewest()],
    }
  return {
    model: modifyFields(model, { entries: () => entries, status: () => Status.Speaking() }),
    commands: [PlaySpeech({ url: spoken.speech.url }), ShowNewest()],
  }
}

const heardTurn = (model: Model, turn: VoiceTurn): UpdateReturn => {
  const owner: Entry = {
    id: nextId(model),
    speaker: 'owner',
    kind: 'turn',
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
    modifyFields(withOwner, { maybeFollowing: () => following, status: () => Status.Idle() }),
    'turn',
    turn.line,
    turn,
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

/** The owner may talk when Vita is idle, after a failure, or over her speech (the press cuts her off). */
const canTalk = (status: Status) =>
  Status.guards.Idle(status) || Status.guards.Failed(status) || Status.guards.Speaking(status)

const send = (model: Model): UpdateReturn => ({
  model: modifyFields(model, { status: () => Status.Thinking() }),
  commands: [StopListening()],
})
const idle = (model: Model): UpdateReturn => ({ model: modifyFields(model, { status: () => Status.Idle() }) })

/** Press: the mic opens for as long as the button is held. */
const pressed = (model: Model): UpdateReturn => {
  if (!canTalk(model.status)) return { model }
  const holdId = model.holds + 1
  return {
    model: modifyFields(model, { holds: () => holdId, status: () => Status.Starting({ holdId }) }),
    commands: [StartListening({ holdId })],
  }
}

/** Release: send what was said; a release before the mic opened records nothing. */
const released = (model: Model): UpdateReturn =>
  Status.guards.Listening(model.status) ? send(model) : Status.guards.Starting(model.status) ? idle(model) : { model }

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    CompletedCheckVoice: ({ available }) => ({
      model: modifyFields(model, { status: () => (available ? Status.Idle() : Status.Unavailable()) }),
    }),
    PressedTalk: () => pressed(model),
    CompletedStartListening: ({ holdId }) => {
      const { status } = model
      if ((Status.guards.Starting(status) || Status.guards.Listening(status)) && status.holdId !== holdId) {
        return { model }
      }
      return Status.guards.Starting(status)
        ? {
            model: modifyFields(model, { status: () => Status.Listening({ holdId: status.holdId }) }),
            commands: [LimitListening({ holdId: status.holdId })],
          }
        : { model, commands: [StopListening()] }
    },
    FailedStartListening: ({ holdId, reason }) =>
      !Status.guards.Starting(model.status) || model.status.holdId !== holdId || reason === 'superseded'
        ? { model }
        : reason === 'hidden'
          ? idle(model)
          : failed(model, reason, ''),
    ReleasedTalk: () => released(model),
    CompletedLimitListening: ({ holdId }) =>
      Status.guards.Listening(model.status) && model.status.holdId === holdId ? send(model) : { model },
    CompletedStopListening: ({ maybeAudio, closed }) =>
      Status.guards.Thinking(model.status)
        ? Option.match(maybeAudio, {
            onNone: () => (closed ? idle(model) : failed(model, 'tooShort', '')),
            onSome: (audio) => ({
              model,
              commands: [SendVoiceTurn({ robotId: model.robotId, audio, model: Option.getOrNull(model.maybeBrain) })],
            }),
          })
        : { model },
    SucceededVoiceTurn: ({ turn }) => heardTurn(model, turn),
    FailedVoiceTurn: ({ error }) => failed(model, 'zeroG', error),
    SucceededSayIntent: ({ say }) =>
      vitaSays(model, 'narration', say.line, say, Option.fromNullishOr(say.decisionReason)),
    FailedSayIntent: ({ error }) => (inTurn(model.status) ? { model } : failed(model, 'speech', error)),
    CompletedShowNewest: () => ({ model }),
    CompletedPlaySpeech: ({ played }) =>
      Status.guards.Speaking(model.status)
        ? played
          ? { model: modifyFields(model, { status: () => Status.Idle() }) }
          : failed(model, 'speech', 'the speech did not play')
        : { model },
  })
