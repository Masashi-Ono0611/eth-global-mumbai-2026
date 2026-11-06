import { Effect, Option, Schema } from 'effect'
import { Command, Update } from 'foldkit'
import { Dialog, Listbox } from '@foldkit/ui'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import type * as HttpClient from 'effect/http/HttpClient'
import { isSignedOut } from '../api/Http.ts'
import {
  ConsoleRobot,
  ErrandDetail,
  loadConsoleRobot,
  createIntent,
  loadEpisodeApproval,
  loadIntent,
  loadLive,
  stopIntent,
  loadErrand,
  terminalStates,
} from '../api/Robot.ts'
import { EpisodeSummary, listEpisodes } from '../api/Episodes.ts'
import { Catalogue, denyApproval, loadActivity, loadCatalogue } from '../api/Wallet.ts'
import { format } from '@ethmumbai/i18n'
import { LiveFrame } from '@ethmumbai/protocol/Frame'
import { IntentView, isOpenIntent } from '@ethmumbai/protocol/Intent'
import type { Passkeys } from '../Passkey.ts'
import * as Allowance from './Allowance.ts'
import * as RobotVoice from './RobotVoice.ts'
import { sheetFolds } from '../Sheet.ts'
import { BrainListbox, initBrainPicker, RequestModel, requestModel } from './RobotBrain.ts'

// MODEL

export { ConsoleState, Decline, Errand, Intent } from './RobotConsoleState.ts'
import { ConsoleState, Decline, Errand, Intent } from './RobotConsoleState.ts'
export const Model = Schema.Struct({
  robotId: Schema.String,
  state: ConsoleState,
  errand: Errand,
  decline: Decline,
  allowance: Allowance.Model,
  allowanceSheet: Dialog.Model,
  intent: Intent,
  instruction: Schema.String,
  voice: RobotVoice.Model,
  /** The open intent whose live camera loop is running, so one intent never gets two loops. */
  maybeLiveIntentId: Schema.Option(Schema.String),
  /** The 0G brain the owner picked for the next messages (RobotBrain.ts); none = the Worker's ZG_MODEL. */
  maybeBrain: Schema.Option(Schema.String),
  brainPicker: Listbox.Model,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadConsole: {
    robot: ConsoleRobot,
    catalogue: Catalogue,
    history: Schema.Array(EpisodeSummary),
    amounts: Schema.Record(Schema.String, Schema.String),
    maybeLatestEpisode: Schema.Option(Schema.String),
  },
  FailedLoadConsole: { error: Schema.String, signedOut: Schema.Boolean },
  /** "Get me a chai": an intent the robot's own scan claims (a real chip robot's camera, or the simulator). */
  ClickedAskFor: { item: Schema.String },
  SucceededLoadErrand: { episodeId: Schema.String, detail: ErrandDetail },
  FailedLoadErrand: { episodeId: Schema.String },
  CompletedFindApproval: { episodeId: Schema.String, maybeApprovalUrl: Schema.Option(Schema.String) },
  ClickedRefresh: {},
  ClickedDecline: { approvalId: Schema.String },
  SucceededDecline: {},
  FailedDecline: { error: Schema.String },
  ClickedAllowance: {},
  UpdatedInstruction: { value: Schema.String },
  SubmittedInstruction: {},
  SucceededCreateIntent: { intent: IntentView },
  FailedCreateIntent: { error: Schema.String },
  SucceededLoadIntent: { intent: IntentView },
  FailedLoadIntent: { intentId: Schema.String },
  SucceededLoadLive: { intentId: Schema.String, maybeLive: Schema.Option(LiveFrame) },
  FailedLoadLive: { intentId: Schema.String },
  ClickedStopIntent: { intentId: Schema.String },
  SucceededStopIntent: { intent: IntentView },
  FailedStopIntent: { error: Schema.String },
  GotAllowanceSheetMessage: { message: Dialog.Message },
  GotAllowanceMessage: { message: Allowance.Message },
  GotVoiceMessage: { message: RobotVoice.Message },
  GotBrainPickerMessage: { message: Listbox.Message },
})
export type Message = typeof Message.Type

// COMMAND

/**
 * The robot, the merchant's items and the robot's latest errand (to resume it after a reload).
 * @internal Exported for the scene tests; the page update is its only production caller.
 */
export const LoadConsole = Command.define('LoadConsole', {
  args: { robotId: Schema.String },
  messages: [Message.SucceededLoadConsole, Message.FailedLoadConsole],
  execute: ({ robotId }) =>
    Effect.gen(function* () {
      const [robot, catalogue, activity, { episodes }] = yield* Effect.all(
        [loadConsoleRobot(robotId), loadCatalogue, loadActivity, listEpisodes(robotId)],
        { concurrency: 4 },
      )
      const amounts = Object.fromEntries(
        activity.episodes.flatMap((episode) =>
          episode.amount === null ? [] : [[episode.id, episode.amount] as const],
        ),
      )
      const latest = activity.episodes.find((episode) => episode.robotId === robotId)
      return Message.SucceededLoadConsole({
        robot,
        catalogue,
        history: episodes.toReversed(),
        amounts,
        // Resume only an errand that is still running; an ended one is already in the history.
        maybeLatestEpisode: Option.fromNullishOr(
          latest !== undefined && !terminalStates.has(latest.state) ? latest.id : undefined,
        ),
      })
    }).pipe(
      Effect.catch((failure) =>
        Effect.succeed(Message.FailedLoadConsole({ error: failure.error, signedOut: isSignedOut(failure) })),
      ),
    ),
})

/**
 * Reads the errand after `delayMillis`: the console polls while the errand is live (spec §6 moves lazily on reads).
 * @internal Exported for the scene tests; the page update is its only production caller.
 */
export const PollErrand = Command.define('PollErrand', {
  args: { robotId: Schema.String, episodeId: Schema.String, delayMillis: Schema.Number },
  messages: [Message.SucceededLoadErrand, Message.FailedLoadErrand],
  execute: ({ robotId, episodeId, delayMillis }) =>
    Effect.sleep(delayMillis).pipe(
      Effect.andThen(loadErrand(robotId, episodeId)),
      Effect.map((detail) => Message.SucceededLoadErrand({ episodeId, detail })),
      Effect.catch(() => Effect.succeed(Message.FailedLoadErrand({ episodeId }))),
    ),
})

/** The approval page of an errand waiting for the owner (a resumed errand carries no link of its own). */
const FindApproval = Command.define('FindApproval', {
  args: { episodeId: Schema.String },
  messages: [Message.CompletedFindApproval],
  execute: ({ episodeId }) =>
    loadEpisodeApproval(episodeId).pipe(
      Effect.map(({ approvalUrl }) =>
        Message.CompletedFindApproval({ episodeId, maybeApprovalUrl: Option.some(approvalUrl) }),
      ),
      Effect.catch(() => Effect.succeed(Message.CompletedFindApproval({ episodeId, maybeApprovalUrl: Option.none() }))),
    ),
})

/** The conversation's "No": the errand ends `denied` and nothing is signed (spec §9).
 * @internal Exported for the scene tests; the page update is its only production caller. */
export const DeclineInThread = Command.define('DeclineInThread', {
  args: { approvalId: Schema.String },
  messages: [Message.SucceededDecline, Message.FailedDecline],
  execute: ({ approvalId }) =>
    Effect.match(denyApproval(approvalId), {
      onSuccess: () => Message.SucceededDecline(),
      onFailure: (failure) => Message.FailedDecline({ error: failure.error }),
    }),
})

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const SendIntent = Command.define('SendIntent', {
  args: { robotId: Schema.String, instruction: Schema.String, item: Schema.NullOr(Schema.String), model: RequestModel },
  messages: [Message.SucceededCreateIntent, Message.FailedCreateIntent],
  execute: ({ robotId, instruction, item, model }) =>
    Effect.match(createIntent(robotId, instruction, item, model), {
      onSuccess: (intent) => Message.SucceededCreateIntent({ intent }),
      onFailure: (failure) => Message.FailedCreateIntent({ error: failure.error }),
    }),
})

/** Reads the intent after `delayMillis`, while the duck walks. @internal Exported for the scene tests. */
export const PollIntent = Command.define('PollIntent', {
  args: { robotId: Schema.String, intentId: Schema.String, delayMillis: Schema.Number },
  messages: [Message.SucceededLoadIntent, Message.FailedLoadIntent],
  execute: ({ robotId, intentId, delayMillis }) =>
    Effect.sleep(delayMillis).pipe(
      Effect.andThen(loadIntent(robotId, intentId)),
      Effect.map((intent) => Message.SucceededLoadIntent({ intent })),
      Effect.catch(() => Effect.succeed(Message.FailedLoadIntent({ intentId }))),
    ),
})

/** The robot's latest live frame, read every ~500 ms while its intent is open (the intent poll is only every 2 s).
 * @internal Exported for the scene tests. */
export const PollLive = Command.define('PollLive', {
  args: { robotId: Schema.String, intentId: Schema.String, delayMillis: Schema.Number },
  messages: [Message.SucceededLoadLive, Message.FailedLoadLive],
  execute: ({ robotId, intentId, delayMillis }) =>
    Effect.sleep(delayMillis).pipe(
      Effect.andThen(loadLive(robotId)),
      Effect.map((maybeLive) => Message.SucceededLoadLive({ intentId, maybeLive })),
      Effect.catch(() => Effect.succeed(Message.FailedLoadLive({ intentId }))),
    ),
})

/** The owner stops the duck; the sim halts on its next turn. @internal Exported for the scene tests. */
export const HaltIntent = Command.define('HaltIntent', {
  args: { robotId: Schema.String, intentId: Schema.String },
  messages: [Message.SucceededStopIntent, Message.FailedStopIntent],
  execute: ({ robotId, intentId }) =>
    Effect.match(stopIntent(robotId, intentId), {
      onSuccess: (intent) => Message.SucceededStopIntent({ intent }),
      onFailure: (failure) => Message.FailedStopIntent({ error: failure.error }),
    }),
})

type Services = HttpClient.HttpClient | Passkeys

// INIT

type UpdateReturn = Update.Return<Model, Message, Services>
const POLL_MILLIS = 1500

export const init = (robotId: string): UpdateReturn => ({
  model: {
    robotId,
    state: ConsoleState.Loading(),
    errand: Errand.Idle(),
    decline: Decline.Idle(),
    allowance: Allowance.init(robotId, Option.none(), false),
    allowanceSheet: Dialog.init({ id: 'allowance', isAnimated: true }),
    intent: Intent.Idle(),
    instruction: '',
    voice: RobotVoice.init(robotId),
    maybeLiveIntentId: Option.none(),
    maybeBrain: Option.none(),
    brainPicker: initBrainPicker(),
  },
  commands: [LoadConsole({ robotId }), ...Command.mapMessages([RobotVoice.CheckVoice({ robotId })], toVoice)],
})

// UPDATE

export const isLive = (errand: Errand) =>
  Errand.guards.Running(errand) &&
  Option.match(errand.maybeDetail, {
    onNone: () => true,
    onSome: (detail) => !terminalStates.has(detail.episode.state),
  })

/** The duck is out on an instruction (it has not ended), so no new errand starts. */
export const isIntentOpen = (intent: Intent) =>
  Intent.guards.Sending(intent) || (Intent.guards.Open(intent) && isOpenIntent(intent.intent.state))

/** A catalogue item's display name, for the instruction a Get me pill sends. */
const itemNameOf = (model: Model, itemId: string): string =>
  ConsoleState.guards.Loaded(model.state)
    ? (model.state.catalogue.items.find((entry) => entry.itemId === itemId)?.name ?? itemId)
    : itemId

/** Who a message goes to and which brain answers it (the owner's pick, else the Worker's ZG_MODEL). */
const addressed = (model: Model) => ({ robotId: model.robotId, model: requestModel(model.maybeBrain) })

const INTENT_POLL_MILLIS = 2000
/** How often the open intent's live frame is read: about two frames a second at most reach the chat. */
const LIVE_POLL_MILLIS = 500

/** A live read for the open intent: show the frame, and read again while the intent stays open; else stop the loop. */
const liveRead = (
  model: Model,
  intentId: string,
  maybeLive: Option.Option<LiveFrame>,
  delayMillis: number,
): UpdateReturn => {
  const { intent } = model
  if (!Intent.guards.Open(intent) || intent.intent.id !== intentId || !isOpenIntent(intent.intent.state))
    return { model: modifyFields(model, { maybeLiveIntentId: () => Option.none() }) }
  const live = Option.isSome(maybeLive) ? maybeLive.value : (intent.intent.live ?? null)
  return {
    model: modifyFields(model, { intent: () => Intent.Open({ ...intent, intent: { ...intent.intent, live } }) }),
    commands: [PollLive({ robotId: model.robotId, intentId, delayMillis })],
  }
}

/** The owner's words, or a Get me pill's item, become an intent: the duck walks (simulator) or waits for its scan. */
const sendIntent = (model: Model, instruction: string, item: string | null): UpdateReturn =>
  isLive(model.errand) || isIntentOpen(model.intent) || instruction.trim().length === 0
    ? { model }
    : {
        model: modifyFields(model, { intent: () => Intent.Sending({ instruction }), instruction: () => '' }),
        commands: [SendIntent({ ...addressed(model), instruction: instruction.trim(), item })],
      }

/** A fresh read of the intent: once the duck's scan made an errand, the errand's own messages take over. */
const intentStep = (model: Model, intent: IntentView): UpdateReturn => {
  const stopping = Intent.guards.Open(model.intent) && model.intent.stopping && isOpenIntent(intent.state)
  // The first read that carries a live frame starts the faster live loop for this intent (once).
  const startLive =
    isOpenIntent(intent.state) &&
    (intent.live ?? null) !== null &&
    !Option.exists(model.maybeLiveIntentId, (id) => id === intent.id)
  const next = modifyFields(model, {
    intent: () => Intent.Open({ intent, stopping }),
    maybeLiveIntentId: () => (startLive ? Option.some(intent.id) : model.maybeLiveIntentId),
  })
  const poll = isOpenIntent(intent.state)
    ? [
        PollIntent({ robotId: model.robotId, intentId: intent.id, delayMillis: INTENT_POLL_MILLIS }),
        ...(startLive
          ? [PollLive({ robotId: model.robotId, intentId: intent.id, delayMillis: LIVE_POLL_MILLIS })]
          : []),
      ]
    : []
  const episodeId = intent.episodeId
  const following = Errand.guards.Running(model.errand) && model.errand.episodeId === episodeId
  if (episodeId === null || following) return { model: next, commands: poll }
  return {
    model: modifyFields(next, { errand: () => running(episodeId, Option.none()) }),
    commands: [...poll, PollErrand({ robotId: model.robotId, episodeId, delayMillis: 0 })],
  }
}

const toVoice = (message: RobotVoice.Message) => Message.GotVoiceMessage({ message })

/** Vita's voice: a spoken buy's intent joins the conversation like a "Get me" chip's; Vita speaks its new states. */
const voiceChild = {
  read: (model: Model) => Option.some(model.voice),
  write: (model: Model, next: RobotVoice.Model) => modifyFields(model, { voice: () => next }),
  toParentMessage: toVoice,
  foldOutMessage: RobotVoice.OutMessage.match<Update.Step<Model, Message, Services>>({
    StartedIntent:
      ({ intent }) =>
      (model) =>
        intentRead(model, intent),
  }),
}
const foldVoice = Update.foldChild({ update: RobotVoice.update, ...voiceChild })

const intentRead = (model: Model, intent: IntentView): UpdateReturn => {
  const followed = Update.foldChildStep({ update: RobotVoice.followIntent(intent), ...voiceChild })(model)
  const read = intentStep(followed.model, intent)
  return { model: read.model, commands: [...(followed.commands ?? []), ...(read.commands ?? [])] }
}

/** Stop the duck once; its next turn sees the stopped intent and halts. */
const haltIntent = (model: Model, intentId: string): UpdateReturn => {
  const { intent } = model
  if (!Intent.guards.Open(intent) || intent.stopping) return { model }
  return {
    model: modifyFields(model, { intent: () => Intent.Open({ intent: intent.intent, stopping: true }) }),
    commands: [HaltIntent({ robotId: model.robotId, intentId })],
  }
}

const running = (episodeId: string, maybeApprovalUrl: Option.Option<string>) =>
  Errand.Running({ episodeId, maybeDetail: Option.none(), maybeApprovalUrl })

/** A read of the running errand: keep polling while it is live, reload the conversation once it has ended. */
const loadedErrand = (model: Model, episodeId: string, detail: ErrandDetail): UpdateReturn => {
  const { errand } = model
  if (!Errand.guards.Running(errand) || errand.episodeId !== episodeId) {
    return { model }
  }
  const live = !terminalStates.has(detail.episode.state)
  const findApproval =
    detail.episode.state === 'awaiting_approval' && Option.isNone(errand.maybeApprovalUrl)
      ? [FindApproval({ episodeId })]
      : []
  return {
    model: modifyFields(model, {
      errand: () => Errand.Running({ ...errand, maybeDetail: Option.some(detail) }),
    }),
    commands: live
      ? [PollErrand({ robotId: model.robotId, episodeId, delayMillis: POLL_MILLIS }), ...findApproval]
      : [LoadConsole({ robotId: model.robotId })],
  }
}

const allowanceSheet = sheetFolds<Model, Message>({
  read: (model) => model.allowanceSheet,
  write: (model, sheet) => modifyFields(model, { allowanceSheet: () => sheet }),
  toParentMessage: (message) => Message.GotAllowanceSheetMessage({ message }),
})

/** Arc took the grant or the revoke: close the sheet and re-read the robot. */
const afterAllowance = Allowance.OutMessage.match<Update.Step<Model, Message, Services>>({
  Granted: () => (model) => {
    const closed = allowanceSheet.close(model)
    return { ...closed, commands: [...(closed.commands ?? []), LoadConsole({ robotId: model.robotId })] }
  },
  Stopped: () => (model) => {
    const closed = allowanceSheet.close(model)
    return { ...closed, commands: [...(closed.commands ?? []), LoadConsole({ robotId: model.robotId })] }
  },
})

const allowanceChild = {
  read: (model: Model) => Option.some(model.allowance),
  write: (model: Model, next: Allowance.Model) => modifyFields(model, { allowance: () => next }),
  toParentMessage: (message: Allowance.Message) => Message.GotAllowanceMessage({ message }),
  foldOutMessage: afterAllowance,
}
const foldAllowance = Update.foldChild({ update: Allowance.update, ...allowanceChild })

/** The owner's pick goes with every next message (Get me, typed words) until changed. */
const foldBrainPicker = Update.foldChild({
  update: BrainListbox.update,
  read: (model: Model) => Option.some(model.brainPicker),
  write: (model: Model, next: Listbox.Model) => modifyFields(model, { brainPicker: () => next }),
  toParentMessage: (message: Listbox.Message) => Message.GotBrainPickerMessage({ message }),
  foldOutMessage: Listbox.OutMessage.match<Update.Step<Model, Message, Services>>({
    Selected:
      ({ value }) =>
      (model) => ({
        model: modifyFields(model, {
          maybeBrain: () => Option.some(value),
          // A spoken buy goes with the same brain as the typed message beside the mic.
          voice: () => modifyFields(model.voice, { maybeBrain: () => Option.some(value) }),
        }),
      }),
  }),
})
const configureAllowance = (model: Model, catalogue: Catalogue, robot: ConsoleRobot) =>
  Update.foldChildStep({
    update: Allowance.configure(
      Option.fromNullishOr(catalogue.payTo),
      robot.grant !== null && robot.grant.status === 'active',
    ),
    ...allowanceChild,
  })(model)

type Of<Tag extends Message['_tag']> = Extract<Message, { readonly _tag: Tag }>

/** The owner's answers in the conversation: No to a waiting approval, and the allowance sheet. */
const ownerHandlers = (model: Model) => ({
  ClickedDecline: ({ approvalId }: Of<'ClickedDecline'>) =>
    Decline.guards.Declining(model.decline)
      ? { model }
      : {
          model: modifyFields(model, { decline: () => Decline.Declining() }),
          commands: [DeclineInThread({ approvalId })],
        },
  SucceededDecline: () => {
    const { errand } = model
    return {
      model: modifyFields(model, { decline: () => Decline.Idle() }),
      commands: Errand.guards.Running(errand)
        ? [PollErrand({ robotId: model.robotId, episodeId: errand.episodeId, delayMillis: 0 })]
        : [],
    }
  },
  FailedDecline: ({ error }: Of<'FailedDecline'>) => ({
    model: modifyFields(model, { decline: () => Decline.Failed({ error }) }),
  }),
  ClickedAllowance: () => allowanceSheet.open(model),
})

/** The simulator's intent: the owner's instruction, its polling while the duck walks, and Stop. */
const intentHandlers = (model: Model) => ({
  UpdatedInstruction: ({ value }: Of<'UpdatedInstruction'>) => ({
    model: modifyFields(model, { instruction: () => value }),
  }),
  SubmittedInstruction: () => sendIntent(model, model.instruction, null),
  ClickedAskFor: ({ item }: Of<'ClickedAskFor'>) =>
    sendIntent(model, format('en', 'thread.instructionFor', { item: itemNameOf(model, item).toLowerCase() }), item),
  SucceededCreateIntent: ({ intent }: Of<'SucceededCreateIntent'>) => intentRead(model, intent),
  FailedCreateIntent: ({ error }: Of<'FailedCreateIntent'>) => ({
    model: modifyFields(model, { intent: () => Intent.Failed({ error }) }),
  }),
  SucceededLoadIntent: ({ intent }: Of<'SucceededLoadIntent'>) => intentRead(model, intent),
  FailedLoadIntent: ({ intentId }: Of<'FailedLoadIntent'>) =>
    Intent.guards.Open(model.intent) && model.intent.intent.id === intentId
      ? { model, commands: [PollIntent({ robotId: model.robotId, intentId, delayMillis: INTENT_POLL_MILLIS * 2 })] }
      : { model },
  SucceededLoadLive: ({ intentId, maybeLive }: Of<'SucceededLoadLive'>) =>
    liveRead(model, intentId, maybeLive, LIVE_POLL_MILLIS),
  FailedLoadLive: ({ intentId }: Of<'FailedLoadLive'>) =>
    liveRead(model, intentId, Option.none(), LIVE_POLL_MILLIS * 4),
  ClickedStopIntent: ({ intentId }: Of<'ClickedStopIntent'>) => haltIntent(model, intentId),
  SucceededStopIntent: ({ intent }: Of<'SucceededStopIntent'>) => ({
    model: modifyFields(model, { intent: () => Intent.Open({ intent, stopping: false }) }),
  }),
  FailedStopIntent: ({ error }: Of<'FailedStopIntent'>) => ({
    model: modifyFields(model, { intent: () => Intent.Failed({ error }) }),
  }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadConsole: ({ robot, catalogue, history, amounts, maybeLatestEpisode }) => {
      // The allowance's step returns only a model (no Commands), so the load's own Commands stay as they are.
      const loaded = configureAllowance(
        modifyFields(model, { state: () => ConsoleState.Loaded({ robot, catalogue, history, amounts }) }),
        catalogue,
        robot,
      ).model
      const resume = Errand.guards.Idle(model.errand) ? maybeLatestEpisode : Option.none()
      const openIntentId = Intent.guards.Idle(model.intent) ? (robot.openIntentId ?? null) : null
      if (openIntentId !== null && Option.isNone(resume)) {
        return {
          model: loaded,
          commands: [PollIntent({ robotId: model.robotId, intentId: openIntentId, delayMillis: 0 })],
        }
      }
      return Option.match(resume, {
        onNone: () => ({ model: loaded }),
        onSome: (episodeId) => ({
          model: modifyFields(loaded, { errand: () => running(episodeId, Option.none()) }),
          commands: [PollErrand({ robotId: model.robotId, episodeId, delayMillis: 0 })],
        }),
      })
    },
    FailedLoadConsole: ({ error, signedOut }) => ({
      model: modifyFields(model, {
        state: () => (signedOut ? ConsoleState.SignedOut() : ConsoleState.Failed({ error })),
      }),
    }),
    SucceededLoadErrand: ({ episodeId, detail }) => loadedErrand(model, episodeId, detail),
    CompletedFindApproval: ({ episodeId, maybeApprovalUrl }) => {
      const { errand } = model
      if (!Errand.guards.Running(errand) || errand.episodeId !== episodeId) {
        return { model }
      }
      return { model: modifyFields(model, { errand: () => Errand.Running({ ...errand, maybeApprovalUrl }) }) }
    },
    FailedLoadErrand: ({ episodeId }) =>
      Errand.guards.Running(model.errand) && model.errand.episodeId === episodeId
        ? { model, commands: [PollErrand({ robotId: model.robotId, episodeId, delayMillis: POLL_MILLIS * 2 })] }
        : { model },
    ClickedRefresh: () => ({ model, commands: [LoadConsole({ robotId: model.robotId })] }),
    ...ownerHandlers(model),
    ...intentHandlers(model),
    GotAllowanceSheetMessage: ({ message: sheetMessage }) => allowanceSheet.fold(model, sheetMessage),
    GotAllowanceMessage: ({ message: allowanceMessage }) => foldAllowance(model, allowanceMessage),
    GotVoiceMessage: ({ message: voiceMessage }) => foldVoice(model, voiceMessage),
    GotBrainPickerMessage: ({ message: pickerMessage }) => foldBrainPicker(model, pickerMessage),
  })
