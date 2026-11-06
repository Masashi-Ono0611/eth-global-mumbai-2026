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
import { explorerTx, listRobots } from '../api/Wallet.ts'
import { episodeRouter } from '../route.ts'
import { failedView, loadingView, ownerMain, signedOutView } from './Shared.ts'
import { styled } from '../Styled.ts'
import { episodeTable, filterRow, tableScroll } from './Episodes.styles.ts'

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

const filter = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const selected = Option.getOrElse(model.maybeRobotId, () => '')
  // The robot in the URL is an option even before the robot list arrives.
  const known = model.robots.some((robot) => robot.id === selected) || selected === ''
  const options = known ? model.robots : [...model.robots, { id: selected, name: selected }]
  return h.div(styled(h, filterRow()), [
    h.label([h.For('episode-robot')], [format(locale, 'episodes.filter', {})]),
    h.select(
      [h.Id('episode-robot'), h.Value(selected), h.OnChange((value) => Message.ChangedRobotFilter({ value }))],
      [
        h.keyed('option')('', [h.Value('')], [format(locale, 'episodes.allRobots', {})]),
        ...options.map((robot) => h.keyed('option')(robot.id, [h.Value(robot.id)], [robot.name])),
      ],
    ),
  ])
}

const brainLabel = (provider: string | null, locale: Locale) =>
  format(locale, isZeroGDecision(provider) ? 'console.brainZeroG' : 'console.brainRehearsal', {})

const row = (episode: EpisodeSummary, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const cell = (content: ReadonlyArray<Html | string>) => h.td([], content)
  return h.keyed('tr')(
    episode.id,
    [],
    [
      cell([clockTime(episode.createdAt, locale, inputs.timeZone)]),
      cell([episode.robotName]),
      cell([episode.item]),
      cell([format(locale, 'robot.state', { state: episode.state })]),
      cell(
        episode.decision === null
          ? ['—']
          : [
              format(locale, 'episodes.decision', {
                brain: brainLabel(episode.decision.provider, locale),
                action: episode.decision.action,
              }),
            ],
      ),
      cell(
        episode.payment === null
          ? ['—']
          : [
              episode.payment.txHash === null
                ? episode.payment.status
                : h.a([h.Href(explorerTx(episode.payment.txHash))], [episode.payment.status]),
            ],
      ),
      cell([
        episode.approval === null
          ? '—'
          : [episode.approval.status, episode.approval.world?.acr?.split('/').at(-1)]
              .filter((part): part is string => part !== undefined)
              .join(' · '),
      ]),
      cell([episode.evidence?.status ?? '—']),
      cell([h.a([h.Href(episodeRouter({ episodeId: episode.id }))], [format(locale, 'episodes.inspect', {})])]),
    ],
  )
}

const table = (episodes: ReadonlyArray<EpisodeSummary>, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  if (episodes.length === 0) return h.p([h.Class('hint')], [format(locale, 'episodes.empty', {})])
  const heading = (key: 'when' | 'robot' | 'item' | 'state' | 'decision' | 'payment' | 'world' | 'evidence' | 'open') =>
    h.th([], [format(locale, 'episodes.column', { column: key })])
  return h.div(styled(h, tableScroll()), [
    h.table(styled(h, episodeTable()), [
      h.thead(
        [],
        [
          h.tr(
            [],
            [
              heading('when'),
              heading('robot'),
              heading('item'),
              heading('state'),
              heading('decision'),
              heading('payment'),
              heading('world'),
              heading('evidence'),
              heading('open'),
            ],
          ),
        ],
      ),
      h.tbody(
        [],
        episodes.map((episode) => row(episode, inputs, h)),
      ),
    ]),
  ])
}

/** `/wallet/episodes`: every errand of the owner's robots with what decided it, what it paid and what proves it. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) =>
  ownerMain(
    format(inputs.locale, 'episodes.title', {}),
    h.div(
      [],
      [
        h.p([h.Class('lead')], [format(inputs.locale, 'episodes.explainer', {})]),
        filter(model, inputs.locale, h),
        ListState.match(model.state, {
          Loading: () => loadingView(inputs.locale, h),
          SignedOut: () => signedOutView(inputs.locale, h),
          Failed: ({ error }) => failedView(error, Message.ClickedReload(), inputs.locale, h),
          Loaded: ({ episodes }) => table(episodes, inputs, h),
        }),
      ],
    ),
    h,
  ),
)
