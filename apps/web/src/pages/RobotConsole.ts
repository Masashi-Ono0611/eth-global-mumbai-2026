import { Effect, Option, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
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
  loadEpisodeApproval,
  loadErrand,
  startErrand,
  terminalStates,
} from '../api/Robot.ts'
import { EpisodeSummary, listEpisodes } from '../api/Episodes.ts'
import { Catalogue, denyApproval, loadActivity, loadCatalogue } from '../api/Wallet.ts'

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

/** "No" to the waiting approval: the errand ends `denied` and nothing is signed (spec §9).
 * @internal Exported for the scene tests; the page update is its only production caller. */
export const DeclineApproval = Command.define('DeclineApproval', {
  args: { approvalId: Schema.String },
  messages: [Message.SucceededDecline, Message.FailedDecline],
  execute: ({ approvalId }) =>
    denyApproval(approvalId).pipe(
      Effect.as(Message.SucceededDecline()),
      Effect.catch((failure) => Effect.succeed(Message.FailedDecline({ error: failure.error }))),
    ),
})

type Services = HttpClient.HttpClient

// INIT

type UpdateReturn = Update.Return<Model, Message, Services>
const POLL_MILLIS = 1500

export const init = (robotId: string): UpdateReturn => ({
  model: { robotId, state: ConsoleState.Loading(), errand: Errand.Idle(), invoiceInput: '', decline: Decline.Idle() },
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

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadConsole: ({ robot, catalogue, history, amounts, maybeLatestEpisode }) => {
      const loaded = modifyFields(model, {
        state: () => ConsoleState.Loaded({ robot, catalogue, history, amounts }),
      })
      const resume = Errand.guards.Idle(model.errand) ? maybeLatestEpisode : Option.none()
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
      isLive(model.errand)
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
    ClickedDecline: ({ approvalId }) =>
      Decline.guards.Declining(model.decline)
        ? { model }
        : {
            model: modifyFields(model, { decline: () => Decline.Declining() }),
            commands: [DeclineApproval({ approvalId })],
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
    FailedDecline: ({ error }) => ({ model: modifyFields(model, { decline: () => Decline.Failed({ error }) }) }),
  })
