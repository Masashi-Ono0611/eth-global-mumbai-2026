import { Dialog } from '@foldkit/ui'
import { Clock, Effect, Option, Schema } from 'effect'
import { Command, Update } from 'foldkit'
import type * as HttpClient from 'effect/http/HttpClient'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { EpisodeSummary, listEpisodes } from '../api/Episodes.ts'
import { isSignedOut } from '../api/Http.ts'
import { loadEpisodeApproval, terminalStates } from '../api/Robot.ts'
import {
  ActivityView,
  denyApproval,
  type EpisodeActivity,
  listRobots,
  loadActivity,
  loadWallet,
  RobotView,
  WalletView,
} from '../api/Wallet.ts'
import { Clipboard } from '../Clipboard.ts'
import { sheetFolds } from '../Sheet.ts'
import { Copy } from '../Receive.ts'
import * as Telegram from '../Telegram.ts'

// MODEL

/** A robot waiting for the owner: its errand, the approval to answer and 0G's reason for asking. */
const NeedsYou = Schema.Struct({
  episodeId: Schema.String,
  approvalId: Schema.String,
  robotId: Schema.String,
  robotName: Schema.String,
  item: Schema.String,
  amount: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
})
export type NeedsYou = typeof NeedsYou.Type

export const Home = Schema.Struct({
  wallet: WalletView,
  activity: ActivityView,
  robots: Schema.Array(RobotView),
  episodes: Schema.Array(EpisodeSummary),
  needsYou: Schema.Array(NeedsYou),
  /** USDC base units paid by robots in the 24 hours before the load. */
  spentLastDay: Schema.String,
  /** Whether Telegram is linked, for the first-steps card; none without a bot (or when the read failed). */
  maybeTelegramLinked: Schema.Option(Schema.Boolean),
})
export type Home = typeof Home.Type

export const WalletState = defineTaggedUnion({
  Loading: {},
  SignedOut: {},
  Loaded: { home: Home },
  Failed: { error: Schema.String },
})
export const Decline = defineTaggedUnion({
  Idle: {},
  Declining: { approvalId: Schema.String },
  Failed: { approvalId: Schema.String, error: Schema.String },
})
export const Model = Schema.Struct({
  state: WalletState,
  copy: Copy,
  decline: Decline,
  receiveSheet: Dialog.Model,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadWallet: { home: Home },
  FailedLoadWallet: { error: Schema.String, signedOut: Schema.Boolean },
  ClickedReload: {},
  ClickedReceive: {},
  GotReceiveSheetMessage: { message: Dialog.Message },
  ClickedCopyAddress: { address: Schema.String },
  CompletedCopyAddress: { copied: Schema.Boolean },
  ClickedDecline: { approvalId: Schema.String },
  SucceededDecline: {},
  FailedDecline: { approvalId: Schema.String, error: Schema.String },
})
export type Message = typeof Message.Type

// COMMAND

const DAY_MILLIS = 86_400_000
/** While an errand runs, or a new robot waits for its chip, the page re-reads on this period.
 * @internal Exported for the scene tests. */
export const POLL_MILLIS = 3000

const spentSince = (episodes: ReadonlyArray<EpisodeActivity>, since: number): string =>
  episodes
    .filter((episode) => episode.state === 'paid' && episode.amount !== null && episode.createdAt >= since)
    .reduce((total, episode) => total + BigInt(episode.amount ?? '0'), 0n)
    .toString()

/**
 * The balance, the payments, the robots, every errand (for each robot's last line) and the approvals waiting for the
 * owner. `delayMillis` paces the re-reads while something is live.
 * @internal Exported for the scene tests; the page update is its only production caller.
 */
export const LoadWallet = Command.define('LoadWallet', {
  args: { delayMillis: Schema.Number },
  messages: [Message.SucceededLoadWallet, Message.FailedLoadWallet],
  execute: ({ delayMillis }) =>
    Effect.gen(function* () {
      yield* Effect.sleep(delayMillis)
      const [wallet, activity, { robots }, { episodes }, maybeTelegramLinked] = yield* Effect.all(
        [
          loadWallet,
          loadActivity,
          listRobots,
          listEpisodes(null),
          Telegram.loadLinked.pipe(Effect.orElseSucceed(Option.none)),
        ],
        { concurrency: 5 },
      )
      const waiting = episodes.filter((episode) => episode.state === 'awaiting_approval')
      const approvals = yield* Effect.all(
        waiting.map((episode) => Effect.option(loadEpisodeApproval(episode.id))),
        { concurrency: 4 },
      )
      const needsYou = waiting.flatMap((episode, index) =>
        Option.match(approvals[index] ?? Option.none(), {
          onNone: () => [],
          onSome: (approval) => [
            {
              episodeId: episode.id,
              approvalId: approval.id,
              robotId: episode.robotId,
              robotName: episode.robotName,
              item: episode.item,
              amount: activity.episodes.find((row) => row.id === episode.id)?.amount ?? null,
              reason: episode.decision?.reason ?? null,
            },
          ],
        }),
      )
      const now = yield* Clock.currentTimeMillis
      const spentLastDay = spentSince(activity.episodes, now - DAY_MILLIS)
      return Message.SucceededLoadWallet({
        home: { wallet, activity, robots, episodes, needsYou, spentLastDay, maybeTelegramLinked },
      })
    }).pipe(
      Effect.catch((failure) =>
        Effect.succeed(Message.FailedLoadWallet({ error: failure.error, signedOut: isSignedOut(failure) })),
      ),
    ),
})

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const CopyAddress = Command.define('CopyAddress', {
  args: { address: Schema.String },
  messages: [Message.CompletedCopyAddress],
  execute: ({ address }) =>
    Effect.gen(function* () {
      const clipboard = yield* Clipboard
      yield* clipboard.copy(address)
    }).pipe(
      Effect.as(Message.CompletedCopyAddress({ copied: true })),
      Effect.catch(() => Effect.succeed(Message.CompletedCopyAddress({ copied: false }))),
    ),
})

/** "No" to a waiting approval: the errand ends `denied` and nothing is signed (spec §9).
 * @internal Exported for the scene tests; the page update is its only production caller. */
export const DeclineApproval = Command.define('DeclineApproval', {
  args: { approvalId: Schema.String },
  messages: [Message.SucceededDecline, Message.FailedDecline],
  execute: ({ approvalId }) =>
    denyApproval(approvalId).pipe(
      Effect.as(Message.SucceededDecline()),
      Effect.catch((failure) => Effect.succeed(Message.FailedDecline({ approvalId, error: failure.error }))),
    ),
})

// INIT

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient | Clipboard>

export const init = (): UpdateReturn => ({
  model: {
    state: WalletState.Loading(),
    copy: Copy.Idle(),
    decline: Decline.Idle(),
    receiveSheet: Dialog.init({ id: 'receive', isAnimated: true }),
  },
  commands: [LoadWallet({ delayMillis: 0 })],
})

// UPDATE

/** Something on the page will change without the owner doing anything: re-read it. */
const isLive = (home: Home): boolean =>
  home.episodes.some((episode) => !terminalStates.has(episode.state)) ||
  home.robots.some((robot) => robot.status === 'unpaired' && robot.pairingCode !== null)

const receiveSheet = sheetFolds<Model, Message>({
  read: (model) => model.receiveSheet,
  write: (model, sheet) => modifyFields(model, { receiveSheet: () => sheet }),
  toParentMessage: (message) => Message.GotReceiveSheetMessage({ message }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadWallet: ({ home }) => ({
      model: modifyFields(model, { state: () => WalletState.Loaded({ home }) }),
      commands: isLive(home) ? [LoadWallet({ delayMillis: POLL_MILLIS })] : [],
    }),
    FailedLoadWallet: ({ error, signedOut }) => ({
      model: modifyFields(model, {
        state: () => (signedOut ? WalletState.SignedOut() : WalletState.Failed({ error })),
      }),
    }),
    ClickedReload: () => ({
      model: modifyFields(model, { state: () => WalletState.Loading() }),
      commands: [LoadWallet({ delayMillis: 0 })],
    }),
    ClickedReceive: () => receiveSheet.open(model),
    GotReceiveSheetMessage: ({ message: sheetMessage }) => receiveSheet.fold(model, sheetMessage),
    ClickedCopyAddress: ({ address }) => ({ model, commands: [CopyAddress({ address })] }),
    CompletedCopyAddress: ({ copied }) => ({
      model: modifyFields(model, { copy: () => (copied ? Copy.Copied() : Copy.Failed()) }),
    }),
    ClickedDecline: ({ approvalId }) =>
      Decline.guards.Declining(model.decline)
        ? { model }
        : {
            model: modifyFields(model, { decline: () => Decline.Declining({ approvalId }) }),
            commands: [DeclineApproval({ approvalId })],
          },
    SucceededDecline: () => ({
      model: modifyFields(model, { decline: () => Decline.Idle() }),
      commands: [LoadWallet({ delayMillis: 0 })],
    }),
    FailedDecline: ({ approvalId, error }) => ({
      model: modifyFields(model, { decline: () => Decline.Failed({ approvalId, error }) }),
    }),
  })
