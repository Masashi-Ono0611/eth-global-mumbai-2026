import { Effect, Option, Schema } from 'effect'
import { Command, Update } from 'foldkit'
import { Dialog } from '@foldkit/ui'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import type * as HttpClient from 'effect/http/HttpClient'
import { isSignedOut } from '../api/Http.ts'
import {
  ConsoleRobot,
  ErrandDetail,
  invoiceIdFrom,
  loadConsoleRobot,
  createIntent,
  loadEpisodeApproval,
  loadIntent,
  stopIntent,
  loadErrand,
  startErrand,
  terminalStates,
} from '../api/Robot.ts'
import { EpisodeSummary, listEpisodes } from '../api/Episodes.ts'
import { Catalogue, denyApproval, loadActivity, loadCatalogue } from '../api/Wallet.ts'
import { format } from '@ethmumbai/i18n'
import { IntentView, isOpenIntent } from '@ethmumbai/protocol/Intent'
import type { Passkeys } from '../Passkey.ts'
import * as Allowance from './Allowance.ts'
import { sheetFolds } from '../Sheet.ts'

// MODEL

export const ConsoleState = defineTaggedUnion({
  Loading: {},
  SignedOut: {},
  Loaded: {
    robot: ConsoleRobot,
    catalogue: Catalogue,
    /** The robot's errands, oldest first: the conversation's history. */
    history: Schema.Array(EpisodeSummary),
    /** What each errand paid or asked for (USDC base units), by errand id. */
    amounts: Schema.Record(Schema.String, Schema.String),
  },
  Failed: { error: Schema.String },
})
export const Decline = defineTaggedUnion({ Idle: {}, Declining: {}, Failed: { error: Schema.String } })
/** A simulator robot's errand intent: the owner's instruction, while 0G walks the duck to the counter (sim-plan.md). */
export const Intent = defineTaggedUnion({
  Idle: {},
  Sending: { instruction: Schema.String },
  Open: { intent: IntentView, stopping: Schema.Boolean },
  Failed: { error: Schema.String },
})
export type Intent = typeof Intent.Type
export const Errand = defineTaggedUnion({
  Idle: {},
  Starting: { item: Schema.String },
  Running: {
    episodeId: Schema.String,
    maybeDetail: Schema.Option(ErrandDetail),
    maybeApprovalUrl: Schema.Option(Schema.String),
  },
  Refused: { error: Schema.String },
})
export type Errand = typeof Errand.Type
export const Model = Schema.Struct({
  robotId: Schema.String,
  state: ConsoleState,
  errand: Errand,
  invoiceInput: Schema.String,
  decline: Decline,
  allowance: Allowance.Model,
  allowanceSheet: Dialog.Model,
  intent: Intent,
  instruction: Schema.String,
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
  ClickedStartErrand: { item: Schema.String },
  /** "Get me a chai": an intent the robot's own scan claims (a real chip robot's camera, or the simulator). */
  ClickedAskFor: { item: Schema.String },
  UpdatedInvoiceInput: { value: Schema.String },
  SucceededStartErrand: { episodeId: Schema.String, maybeApprovalUrl: Schema.Option(Schema.String) },
  FailedStartErrand: { error: Schema.String },
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
  ClickedStopIntent: { intentId: Schema.String },
  SucceededStopIntent: { intent: IntentView },
  FailedStopIntent: { error: Schema.String },
  GotAllowanceSheetMessage: { message: Dialog.Message },
  GotAllowanceMessage: { message: Allowance.Message },
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

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const StartErrand = Command.define('StartErrand', {
  args: { robotId: Schema.String, item: Schema.String, invoiceId: Schema.NullOr(Schema.String) },
  messages: [Message.SucceededStartErrand, Message.FailedStartErrand],
  execute: ({ robotId, item, invoiceId }) =>
    startErrand(robotId, item, invoiceId).pipe(
      Effect.map((created) =>
        Message.SucceededStartErrand({
          episodeId: created.episodeId,
          maybeApprovalUrl: Option.fromNullishOr(created.approvalUrl),
        }),
      ),
      Effect.catch((failure) => Effect.succeed(Message.FailedStartErrand({ error: failure.error }))),
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

/**
 * The approval page of an errand waiting for the owner, after a reload lost the link from the errand's creation.
 * @internal Exported for the scene tests; the page update is its only production caller.
 */
export const FindApproval = Command.define('FindApproval', {
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
  args: { robotId: Schema.String, instruction: Schema.String, item: Schema.NullOr(Schema.String) },
  messages: [Message.SucceededCreateIntent, Message.FailedCreateIntent],
  execute: ({ robotId, instruction, item }) =>
    Effect.match(createIntent(robotId, instruction, item), {
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
    invoiceInput: '',
    decline: Decline.Idle(),
    allowance: Allowance.init(robotId, Option.none(), false),
    allowanceSheet: Dialog.init({ id: 'allowance' }),
    intent: Intent.Idle(),
    instruction: '',
  },
  commands: [LoadConsole({ robotId })],
})

// UPDATE

export const isLive = (errand: Errand) =>
  Errand.guards.Starting(errand) ||
  (Errand.guards.Running(errand) &&
    Option.match(errand.maybeDetail, {
      onNone: () => true,
      onSome: (detail) => !terminalStates.has(detail.episode.state),
    }))

/** The duck is out on an instruction (it has not ended), so no new errand starts. */
export const isIntentOpen = (intent: Intent) =>
  Intent.guards.Sending(intent) || (Intent.guards.Open(intent) && isOpenIntent(intent.intent.state))

/** A catalogue item's display name, for the instruction a Buy chip sends. */
const itemNameOf = (model: Model, itemId: string): string =>
  ConsoleState.guards.Loaded(model.state)
    ? (model.state.catalogue.items.find((entry) => entry.itemId === itemId)?.name ?? itemId)
    : itemId

const isSim = (model: Model) => ConsoleState.guards.Loaded(model.state) && model.state.robot.robot.kind === 'sim'

const INTENT_POLL_MILLIS = 2000

/** A simulator robot gets an intent (the owner's words, and the item from a Buy chip); the duck walks and scans. */
const sendIntent = (model: Model, instruction: string, item: string | null): UpdateReturn =>
  isLive(model.errand) || isIntentOpen(model.intent) || instruction.trim().length === 0
    ? { model }
    : {
        model: modifyFields(model, { intent: () => Intent.Sending({ instruction }), instruction: () => '' }),
        commands: [SendIntent({ robotId: model.robotId, instruction: instruction.trim(), item })],
      }

/** A fresh read of the intent: once the duck's scan made an errand, the errand's own messages take over. */
const intentRead = (model: Model, intent: IntentView): UpdateReturn => {
  const stopping = Intent.guards.Open(model.intent) && model.intent.stopping && isOpenIntent(intent.state)
  const next = modifyFields(model, { intent: () => Intent.Open({ intent, stopping }) })
  const poll = isOpenIntent(intent.state)
    ? [PollIntent({ robotId: model.robotId, intentId: intent.id, delayMillis: INTENT_POLL_MILLIS })]
    : []
  const episodeId = intent.episodeId
  const following = Errand.guards.Running(model.errand) && model.errand.episodeId === episodeId
  if (episodeId === null || following) return { model: next, commands: poll }
  return {
    model: modifyFields(next, { errand: () => running(episodeId, Option.none()) }),
    commands: [...poll, PollErrand({ robotId: model.robotId, episodeId, delayMillis: 0 })],
  }
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
    ClickedStartErrand: ({ item }) =>
      isSim(model)
        ? sendIntent(
            model,
            format('en', 'thread.instructionFor', { item: itemNameOf(model, item).toLowerCase() }),
            item,
          )
        : isLive(model.errand)
          ? { model }
          : {
              model: modifyFields(model, { errand: () => Errand.Starting({ item }) }),
              commands: [StartErrand({ robotId: model.robotId, item, invoiceId: invoiceIdFrom(model.invoiceInput) })],
            },
    UpdatedInvoiceInput: ({ value }) => ({ model: modifyFields(model, { invoiceInput: () => value }) }),
    SucceededStartErrand: ({ episodeId, maybeApprovalUrl }) => ({
      model: modifyFields(model, { errand: () => running(episodeId, maybeApprovalUrl), invoiceInput: () => '' }),
      commands: [PollErrand({ robotId: model.robotId, episodeId, delayMillis: 0 })],
    }),
    FailedStartErrand: ({ error }) => ({ model: modifyFields(model, { errand: () => Errand.Refused({ error }) }) }),
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
  })
