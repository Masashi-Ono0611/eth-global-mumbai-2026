import { format, type Locale } from '@ethmumbai/i18n'
import { Effect, Option, Schema } from 'effect'
import { Command, Submodel, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import type * as HttpClient from 'effect/http/HttpClient'
import { clockTime, EpisodeSummary, listEpisodes } from '../api/Episodes.ts'
import { isSignedOut } from '../api/Http.ts'
import { isZeroGDecision } from '../api/Robot.ts'
import { explorerTx, itemName, listRobots } from '../api/Wallet.ts'
import { episodeRouter, robotConsoleRouter, walletRouter } from '../route.ts'
import { teeMark, zeroGLine } from './ProofParts.ts'
import { failedView, loadingView, signedOutView } from './Shared.ts'

// STYLES

const pageClassName = 'grid gap-4 px-1 pt-4 pb-12'
const backClassName =
  'inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-full bg-surface px-3.5 font-semibold no-underline transition-transform active:scale-[0.96]'
const titleClassName = 'font-display text-[1.7rem] leading-tight font-bold text-balance'
const mutedClassName = 'text-[0.92rem] text-muted text-pretty'
const filterRowClassName = 'grid gap-1 text-[0.9rem] text-muted'
const selectClassName = 'min-h-11 w-full rounded-control border border-rule bg-surface px-3 text-base text-ink'
const listClassName = 'm-0 grid list-none gap-2 p-0 transition-opacity duration-150 starting:opacity-0'
const rowClassName = 'grid gap-1.5 rounded-card bg-surface p-4 wrap-break-word'
const rowTopClassName = 'flex items-baseline justify-between gap-3'
const itemClassName = 'min-w-0 font-display text-lg leading-tight font-bold'
const robotClassName = 'ms-1.5 inline-block font-sans text-[0.95rem] font-normal text-muted'
const timeClassName = 'shrink-0 text-[0.8rem] text-muted tabular-nums'
const stateClassName = 'font-semibold'
const linksClassName =
  'flex flex-wrap gap-x-4 gap-y-1 pt-1 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:font-semibold [&_a]:text-paid [&_a]:decoration-paid/40'

// MODEL

const RobotOption = Schema.Struct({ id: Schema.String, name: Schema.String })
const ListState = defineTaggedUnion({
  Loading: {},
  SignedOut: {},
  Loaded: { episodes: Schema.Array(EpisodeSummary) },
  Failed: { error: Schema.String },
})
export const Model = Schema.Struct({
  maybeRobotId: Schema.Option(Schema.String),
  robots: Schema.Array(RobotOption),
  state: ListState,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadEpisodes: { episodes: Schema.Array(EpisodeSummary) },
  FailedLoadEpisodes: { error: Schema.String, signedOut: Schema.Boolean },
  SucceededLoadRobots: { robots: Schema.Array(RobotOption) },
  FailedLoadRobots: {},
  ChangedRobotFilter: { value: Schema.String },
  ClickedReload: {},
})
export type Message = typeof Message.Type

// COMMAND

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const LoadEpisodes = Command.define('LoadEpisodes', {
  args: { robotId: Schema.NullOr(Schema.String) },
  messages: [Message.SucceededLoadEpisodes, Message.FailedLoadEpisodes],
  execute: ({ robotId }) =>
    listEpisodes(robotId).pipe(
      Effect.map(({ episodes }) => Message.SucceededLoadEpisodes({ episodes })),
      Effect.catch((failure) =>
        Effect.succeed(Message.FailedLoadEpisodes({ error: failure.error, signedOut: isSignedOut(failure) })),
      ),
    ),
})

/** The owner's robots, for the filter (the list still works without them). */
const LoadRobotOptions = Command.define('LoadRobotOptions', {
  messages: [Message.SucceededLoadRobots, Message.FailedLoadRobots],
  execute: listRobots.pipe(
    Effect.map(({ robots }) => Message.SucceededLoadRobots({ robots: robots.map(({ id, name }) => ({ id, name })) })),
    Effect.catch(() => Effect.succeed(Message.FailedLoadRobots())),
  ),
})

// INIT

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient>

/** `/wallet/episodes` (every robot) or `/robot/:robotId/episodes` (that robot's errands). */
export const init = (maybeRobotId: Option.Option<string>): UpdateReturn => ({
  model: { maybeRobotId, robots: [], state: ListState.Loading() },
  commands: [LoadEpisodes({ robotId: Option.getOrNull(maybeRobotId) }), LoadRobotOptions()],
})

// UPDATE

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadEpisodes: ({ episodes }) => ({
      model: modifyFields(model, { state: () => ListState.Loaded({ episodes }) }),
    }),
    FailedLoadEpisodes: ({ error, signedOut }) => ({
      model: modifyFields(model, { state: () => (signedOut ? ListState.SignedOut() : ListState.Failed({ error })) }),
    }),
    SucceededLoadRobots: ({ robots }) => ({ model: modifyFields(model, { robots: () => robots }) }),
    FailedLoadRobots: () => ({ model }),
    ChangedRobotFilter: ({ value }) => {
      const maybeRobotId = value === '' ? Option.none() : Option.some(value)
      return {
        model: modifyFields(model, { maybeRobotId: () => maybeRobotId, state: () => ListState.Loading() }),
        commands: [LoadEpisodes({ robotId: Option.getOrNull(maybeRobotId) })],
      }
    },
    ClickedReload: () => ({
      model: modifyFields(model, { state: () => ListState.Loading() }),
      commands: [LoadEpisodes({ robotId: Option.getOrNull(model.maybeRobotId) })],
    }),
  })

// VIEW

type Inputs = { readonly locale: Locale; readonly timeZone: string }

const robotNameOf = (model: Model, robotId: string): string | null =>
  model.robots.find((robot) => robot.id === robotId)?.name ?? null

/** One robot's records go back to its conversation; all of them go back to the wallet. */
const back = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const robotId = Option.getOrNull(model.maybeRobotId)
  const name = robotId === null ? null : robotNameOf(model, robotId)
  return h.a(
    [h.Href(robotId === null ? walletRouter() : robotConsoleRouter({ robotId })), h.Class(backClassName)],
    [
      h.span([h.AriaHidden(true)], ['‹']),
      name === null || robotId === null
        ? format(locale, 'episodes.backToWallet', {})
        : format(locale, 'episode.back', { robot: name }),
    ],
  )
}

const filter = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const selected = Option.getOrElse(model.maybeRobotId, () => '')
  // The robot in the URL is an option even before the robot list arrives.
  const known = model.robots.some((robot) => robot.id === selected) || selected === ''
  const options = known ? model.robots : [...model.robots, { id: selected, name: selected }]
  return h.div(
    [h.Class(filterRowClassName)],
    [
      h.label([h.For('episode-robot')], [format(locale, 'episodes.filter', {})]),
      h.select(
        [
          h.Id('episode-robot'),
          h.Class(selectClassName),
          h.Value(selected),
          h.OnChange((value) => Message.ChangedRobotFilter({ value })),
        ],
        [
          h.keyed('option')('', [h.Value('')], [format(locale, 'episodes.allRobots', {})]),
          ...options.map((robot) => h.keyed('option')(robot.id, [h.Value(robot.id)], [robot.name])),
        ],
      ),
    ],
  )
}

const brainLabel = (provider: string | null, locale: Locale) =>
  format(locale, isZeroGDecision(provider) ? 'console.brainZeroG' : 'console.brainRehearsal', {})

/** What World said: approved at which assurance (`orb`), or how the approval ended. */
const worldLine = (episode: EpisodeSummary, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const { approval } = episode
  if (approval === null) return h.empty
  return h.p(
    [h.Class(mutedClassName)],
    [
      format(locale, 'episodes.world', {
        status: approval.status,
        level: approval.world?.acr?.split('/').at(-1) ?? '',
      }),
    ],
  )
}

/** One errand: what it was for, how it ended, who decided, what World said, where its record is, and its links. */
const row = (episode: EpisodeSummary, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const { decision, payment } = episode
  return h.keyed('li')(
    episode.id,
    [h.Class(rowClassName)],
    [
      h.div(
        [h.Class(rowTopClassName)],
        [
          h.p(
            [h.Class(itemClassName)],
            [itemName(episode.item), h.span([h.Class(robotClassName)], [episode.robotName])],
          ),
          h.time([h.Class(timeClassName)], [clockTime(episode.createdAt, locale, inputs.timeZone)]),
        ],
      ),
      h.p([h.Class(stateClassName)], [format(locale, 'episodes.state', { state: episode.state })]),
      decision === null
        ? h.empty
        : h.p(
            [h.Class(mutedClassName)],
            [
              format(locale, 'episodes.decision', {
                brain: brainLabel(decision.provider, locale),
                action: decision.action,
              }),
              teeMark(decision.tee?.verified ?? false, locale, h),
            ],
          ),
      worldLine(episode, locale, h),
      zeroGLine(episode.evidence, locale, h),
      h.div(
        [h.Class(linksClassName)],
        [
          h.a(
            [
              h.Href(episodeRouter({ episodeId: episode.id })),
              h.AriaLabel(
                format(locale, 'episodes.inspectFor', { item: itemName(episode.item), robot: episode.robotName }),
              ),
            ],
            [format(locale, 'episodes.inspect', {})],
          ),
          payment?.txHash === undefined || payment.txHash === null
            ? h.empty
            : h.a([h.Href(explorerTx(payment.txHash))], [format(locale, 'console.paymentTx', {})]),
        ],
      ),
    ],
  )
}

const list = (episodes: ReadonlyArray<EpisodeSummary>, inputs: Inputs, h: HtmlBuilder<Message>): Html =>
  episodes.length === 0
    ? h.p([h.Class(mutedClassName)], [format(inputs.locale, 'episodes.empty', {})])
    : h.ul(
        [h.Class(listClassName)],
        episodes.map((episode) => row(episode, inputs, h)),
      )

/** `/wallet/episodes`: every errand of the owner's robots with what decided it, what it paid and what proves it. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) =>
  h.main(
    [h.Id('main'), h.Class(pageClassName)],
    [
      back(model, inputs.locale, h),
      h.h1([h.Class(titleClassName)], [format(inputs.locale, 'episodes.title', {})]),
      h.p([h.Class(mutedClassName)], [format(inputs.locale, 'episodes.explainer', {})]),
      filter(model, inputs.locale, h),
      ListState.match(model.state, {
        Loading: () => loadingView(inputs.locale, h),
        SignedOut: () => signedOutView(inputs.locale, h),
        Failed: ({ error }) => failedView(error, Message.ClickedReload(), inputs.locale, h),
        Loaded: ({ episodes }) => list(episodes, inputs, h),
      }),
    ],
  ),
)
