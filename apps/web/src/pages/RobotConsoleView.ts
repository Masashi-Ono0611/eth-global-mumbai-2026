import { format, type Locale } from '@ethmumbai/i18n'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { EpisodeSummary, SeenCrop } from '../api/Episodes.ts'
import {
  type ConsoleRobot,
  type Decision,
  type ErrandDetail,
  isZeroGDecision,
  teeVerifiedOf,
  terminalStates,
  worldAuthorizeUrl,
} from '../api/Robot.ts'
import { type Catalogue, explorerTx, type GrantView, leftToday, usdc, itemName } from '../api/Wallet.ts'
import { duck } from '../Duck.ts'
import { allowanceSheet } from './RobotAllowanceSheet.ts'
import { episodeRouter, robotEpisodesRouter, walletRouter } from '../route.ts'
import { ConsoleState, Decline, Errand, Intent, Message, type Model } from './RobotConsole.ts'
import { dock } from './RobotDockView.ts'
import { seenBubble, teeMark, zeroGLine, type ZeroGRecord } from './ProofParts.ts'
import { type ErrandParts, fromIntent, intentAndErrand, simulatorLink } from './RobotIntentView.ts'
import { failedView, signedOutView } from './Shared.ts'
import { threadSkeleton } from '../Skeleton.ts'

// STYLES

const pageClassName = 'flex min-h-[calc(100svh-2rem)] flex-col transition-opacity duration-150 starting:opacity-0'
const headerClassName =
  'sticky top-0 z-10 grid grid-cols-[44px_44px_1fr_auto] items-center gap-2.5 border-b border-rule bg-paper/95 px-1 pt-1 pb-2.5 backdrop-blur'
const backClassName =
  'grid size-11 place-items-center rounded-full bg-surface text-xl no-underline transition-transform active:scale-[0.96]'
const faceClassName = 'relative grid size-11 place-items-center rounded-full bg-ink'
const faceAsleepClassName = 'relative grid size-11 place-items-center rounded-full bg-rule'
const nameClassName = 'block truncate pt-1 font-display text-xl leading-none font-bold'
const statusClassName = 'text-sm text-muted'
const allowanceClassName =
  'grid min-h-11 cursor-pointer justify-items-end rounded-[14px] bg-surface px-3 pt-1.5 pb-1 leading-tight transition-transform active:scale-[0.96]'
const allowanceAmountClassName = 'font-display text-lg leading-none font-extrabold'
const allowanceLabelClassName = 'text-xs text-muted'
const threadClassName = 'flex flex-1 flex-col gap-2 px-1 pt-3 pb-4'
const ownerBubbleClassName = 'max-w-[82%] self-end rounded-[20px_20px_6px_20px] bg-ink px-3.5 pt-2 pb-1.5 text-surface'
const robotBubbleClassName = 'max-w-[86%] self-start rounded-[20px_20px_20px_6px] bg-surface px-3.5 pt-2 pb-2'
const askBubbleClassName = 'max-w-[92%] self-start rounded-[20px_20px_20px_6px] bg-duck px-3.5 pt-2 pb-3'
const labelClassName = 'block text-[0.8rem] text-muted'
const askLabelClassName = 'block text-[0.8rem] text-duck-deep'
const quoteClassName = 'mt-1 block border-l-[2.5px] border-ink/25 pl-2.5 text-[0.94rem] text-ink/80'
const receiptAmountClassName = 'block font-display text-2xl leading-tight font-extrabold'
const paidClassName = 'inline-flex items-center gap-1 font-semibold text-paid'
const proofClassName = 'text-[0.92rem] font-semibold decoration-ink/30'
const systemClassName = 'self-center rounded-full bg-surface/60 px-3 py-1 text-center text-sm text-muted'
const errorBubbleClassName = 'max-w-[86%] self-start rounded-[20px_20px_20px_6px] bg-error-soft px-3.5 py-2 text-error'
const askButtonsClassName = 'mt-2.5 grid grid-cols-[1fr_auto] gap-2'
const approveClassName =
  'inline-flex min-h-12 items-center justify-center rounded-control bg-black px-3 font-semibold text-surface no-underline transition-transform active:scale-[0.96]'
const declineClassName =
  'min-h-12 cursor-pointer rounded-control bg-surface px-6 font-semibold transition-transform active:scale-[0.96] disabled:opacity-60'
// VIEW

/** The header pill: what is left today when the Worker reports the day, otherwise the daily allowance. */
const allowancePill = (grant: GrantView, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  const left = leftToday(grant)
  return left === null
    ? [
        h.span([h.Class(allowanceAmountClassName)], [usdc(grant.dailyCap)]),
        h.span([h.Class(allowanceLabelClassName)], [format(locale, 'thread.perDay', {})]),
      ]
    : [
        h.span([h.Class(allowanceAmountClassName)], [usdc(left)]),
        h.span([h.Class(allowanceLabelClassName)], [format(locale, 'thread.leftOf', { daily: usdc(grant.dailyCap) })]),
      ]
}

const allowancePillLabel = (grant: GrantView, locale: Locale): string => {
  const left = leftToday(grant)
  return left === null
    ? format(locale, 'allowance.open', { amount: usdc(grant.dailyCap) })
    : format(locale, 'allowance.openLeft', { left: usdc(left), daily: usdc(grant.dailyCap) })
}

const header = (view: ConsoleRobot, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const online = view.lease.online
  return h.header(
    [h.Class(headerClassName)],
    [
      h.a(
        [h.Href(walletRouter()), h.Class(backClassName), h.AriaLabel(format(locale, 'thread.back', {}))],
        [h.span([h.AriaHidden(true)], ['‹'])],
      ),
      h.span([h.Class(online ? faceClassName : faceAsleepClassName)], [duck('size-8', !online, h)]),
      h.div(
        [h.Class('min-w-0')],
        [
          h.h1([h.Class(nameClassName), h.Title(view.robot.name)], [view.robot.name]),
          h.span(
            [h.Class(statusClassName), h.Role('status')],
            [format(locale, online ? 'home.connected' : 'thread.offline', {})],
          ),
        ],
      ),
      view.grant === null || view.grant.status !== 'active'
        ? h.button(
            [
              h.Type('button'),
              h.Class(allowanceClassName),
              h.AriaLabel(format(locale, 'allowance.openNone', {})),
              h.OnClick(Message.ClickedAllowance()),
            ],
            [h.span([h.Class(allowanceLabelClassName)], [format(locale, 'thread.noAllowance', {})])],
          )
        : h.button(
            [
              h.Type('button'),
              h.Class(allowanceClassName),
              h.AriaLabel(allowancePillLabel(view.grant, locale)),
              h.OnClick(Message.ClickedAllowance()),
            ],
            [...allowancePill(view.grant, locale, h)],
          ),
    ],
  )
}

const ownerBubble = (key: string, item: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('p')(`${key}-ask`, [h.Class(ownerBubbleClassName)], [format(locale, 'thread.buy', { item })])

/** 0G's decision in words, its reason quoted verbatim; a decision from the rehearsal brain says so. */
const decisionBubble = (
  key: string,
  action: string,
  reason: string | null,
  provider: string | null,
  tee: boolean,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed('p')(
    `${key}-decision`,
    [h.Class(robotBubbleClassName)],
    [
      h.span(
        [h.Class(labelClassName)],
        [
          format(locale, isZeroGDecision(provider) ? 'thread.zeroGDecided' : 'thread.rehearsalDecided', {
            action,
          }),
          teeMark(tee, locale, h),
        ],
      ),
      reason === null ? h.empty : h.q([h.Class(quoteClassName)], [reason]),
    ],
  )

const receipt = (
  key: string,
  episodeId: string,
  amount: string | undefined,
  txHash: string | null,
  record: ZeroGRecord | null,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed('div')(
    `${key}-receipt`,
    [h.Class(robotBubbleClassName)],
    [
      h.span([h.Class(paidClassName)], [format(locale, 'thread.paidWithChip', {})]),
      amount === undefined ? h.empty : h.span([h.Class(receiptAmountClassName)], [`${usdc(amount)} USDC`]),
      h.span(
        [h.Class('flex flex-wrap gap-x-3')],
        [
          txHash === null
            ? h.empty
            : h.a([h.Href(explorerTx(txHash)), h.Class(proofClassName)], [format(locale, 'thread.onArc', {})]),
          h.a([h.Href(episodeRouter({ episodeId })), h.Class(proofClassName)], [format(locale, 'thread.proof', {})]),
        ],
      ),
      zeroGLine(record, locale, h),
    ],
  )

/** How an errand ended, in the robot's words; only states the errand actually reached. */
const outcome = (
  key: string,
  episode: { readonly id: string; readonly state: string; readonly result: string | null },
  amount: string | undefined,
  txHash: string | null,
  record: ZeroGRecord | null,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html => {
  if (episode.state === 'paid') return receipt(key, episode.id, amount, txHash, record, locale, h)
  const ended = (text: string, failed: boolean) =>
    h.keyed('div')(
      `${key}-end`,
      [h.Class(failed ? errorBubbleClassName : robotBubbleClassName)],
      [h.p([], [text]), zeroGLine(record, locale, h)],
    )
  const reason = episode.result ?? '—'
  switch (episode.state) {
    case 'denied':
      return ended(format(locale, 'thread.denied', {}), false)
    case 'walked_away':
      return ended(format(locale, 'thread.walkedAway', {}), false)
    case 'safe_stop':
      return ended(format(locale, 'thread.safeStop', { reason }), true)
    case 'refused':
      return ended(format(locale, 'thread.refused', { reason }), true)
    case 'failed':
      return ended(format(locale, 'thread.failed', { reason }), true)
    case 'expired':
      return ended(format(locale, 'thread.expired', {}), true)
    default:
      return h.empty
  }
}

/** The crop the robot scanned, with what the invoice said, as its first message of the errand. */
const seen = (
  key: string,
  episodeId: string,
  crop: SeenCrop | null,
  item: string,
  amount: string | null,
  robot: ConsoleRobot['robot'],
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  crop === null
    ? h.empty
    : seenBubble(
        key,
        episodeId,
        crop,
        amount === null ? null : format(locale, 'thread.invoice', { item: itemName(item), amount: usdc(amount) }),
        robot.kind === 'sim',
        robot.name,
        locale,
        h,
      )

const historyMessages = (
  episode: EpisodeSummary,
  amounts: Readonly<Record<string, string>>,
  robot: ConsoleRobot['robot'],
  locale: Locale,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  ownerBubble(episode.id, episode.item, locale, h),
  seen(
    episode.id,
    episode.id,
    episode.observation ?? null,
    episode.item,
    amounts[episode.id] ?? null,
    robot,
    locale,
    h,
  ),
  episode.decision === null
    ? h.empty
    : decisionBubble(
        episode.id,
        episode.decision.action,
        episode.decision.reason,
        episode.decision.provider,
        episode.decision.tee?.verified ?? false,
        locale,
        h,
      ),
  outcome(episode.id, episode, amounts[episode.id], episode.payment?.txHash ?? null, episode.evidence, locale, h),
]

/** The approval in the conversation: the robot asks, Approve goes to World, No declines it here. */
const askBubble = (model: Model, approvalId: string, item: string, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const declining = Decline.guards.Declining(model.decline)
  return h.keyed('div')(
    `${approvalId}-ask`,
    [h.Class(askBubbleClassName)],
    [
      h.span([h.Class(askLabelClassName)], [format(locale, 'thread.needsOk', {})]),
      h.p([], [format(locale, 'thread.askOk', { item: itemName(item) })]),
      h.div(
        [h.Class(askButtonsClassName)],
        [
          h.a([h.Href(worldAuthorizeUrl(approvalId)), h.Class(approveClassName)], [format(locale, 'home.approve', {})]),
          h.button(
            [
              h.Type('button'),
              h.Class(declineClassName),
              h.Disabled(declining),
              h.OnClick(Message.ClickedDecline({ approvalId })),
            ],
            [format(locale, declining ? 'home.declining' : 'home.decline', {})],
          ),
        ],
      ),
      Decline.guards.Failed(model.decline)
        ? h.p(
            [h.Role('alert'), h.Class('mt-2 text-error')],
            [format(locale, 'home.declineFailed', { message: model.decline.error })],
          )
        : h.empty,
    ],
  )
}

/** The step a live errand is on, as the robot would say it. */
const liveStep = (state: string, locale: Locale): string | null => {
  switch (state) {
    case 'queued':
    case 'deciding':
      return format(locale, 'thread.deciding', {})
    case 'signing':
      return format(locale, 'thread.signing', {})
    case 'settling':
      return format(locale, 'thread.settling', {})
    default:
      return null
  }
}

const decisionOf = (decision: Decision, key: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  decisionBubble(
    `${key}-${decision.id}`,
    decision.action,
    decision.reason,
    decision.provider,
    teeVerifiedOf(decision.tee_json ?? null),
    locale,
    h,
  )

const robotOf = (model: Model): ConsoleRobot['robot'] | null =>
  ConsoleState.guards.Loaded(model.state) ? model.state.robot.robot : null

const liveMessages = (
  model: Model,
  episodeId: string,
  detail: ErrandDetail,
  maybeApprovalUrl: Option.Option<string>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): ErrandParts => {
  const { episode } = detail
  const step = liveStep(episode.state, locale)
  const robot = robotOf(model)
  const crop = detail.observation ?? null
  const approvalId = Option.map(maybeApprovalUrl, (url) => url.split('/').at(-1) ?? url)
  const ended = terminalStates.has(episode.state) && episode.state_changed_at != null
  const body = [
    fromIntent(model, episodeId) ? h.empty : ownerBubble(episodeId, episode.item, locale, h),
    crop !== null && robot !== null
      ? seen(episodeId, episodeId, crop, episode.item, detail.payment?.invoice.amount ?? null, robot, locale, h)
      : detail.payment === null
        ? h.empty
        : h.keyed('p')(
            `${episodeId}-invoice`,
            [h.Class(robotBubbleClassName)],
            [
              h.span([h.Class(labelClassName)], [format(locale, 'thread.atCounter', {})]),
              format(locale, 'thread.invoice', {
                item: itemName(episode.item),
                amount: usdc(detail.payment.invoice.amount),
              }),
            ],
          ),
    ...detail.decisions.map((decision) => decisionOf(decision, episodeId, locale, h)),
    episode.state === 'awaiting_approval'
      ? Option.match(approvalId, {
          onNone: () =>
            h.keyed('p')(`${episodeId}-wait`, [h.Class(systemClassName)], [format(locale, 'home.lineWaiting', {})]),
          onSome: (id) => askBubble(model, id, episode.item, locale, h),
        })
      : h.empty,
    step === null ? h.empty : h.keyed('p')(`${episodeId}-step`, [h.Class(systemClassName), h.Role('status')], [step]),
  ]
  return {
    body,
    outcome: [
      outcome(
        episodeId,
        episode,
        detail.payment?.invoice.amount,
        detail.payment?.txHash ?? null,
        detail.evidence,
        locale,
        h,
      ),
    ],
    span:
      episode.created_at === undefined
        ? null
        : { start: episode.created_at, end: ended ? (episode.state_changed_at ?? 0) * 1000 : Infinity },
  }
}

const untimed = (body: ReadonlyArray<Html>): ErrandParts => ({ body, outcome: [], span: null })

const errandMessages = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ErrandParts =>
  Errand.match(model.errand, {
    Idle: () => untimed([]),
    Starting: ({ item }) =>
      untimed([
        ownerBubble('starting', item, locale, h),
        h.keyed('p')(
          'starting-step',
          [h.Class(systemClassName), h.Role('status')],
          [format(locale, 'thread.deciding', {})],
        ),
      ]),
    Refused: ({ error }) =>
      untimed([
        h.keyed('p')(
          'refused',
          [h.Class(errorBubbleClassName), h.Role('alert')],
          [format(locale, 'thread.couldNotStart', { message: error })],
        ),
      ]),
    Running: ({ episodeId, maybeDetail, maybeApprovalUrl }) =>
      Option.match(maybeDetail, {
        onNone: () =>
          untimed([
            h.keyed('p')(
              `${episodeId}-loading`,
              [h.Class(systemClassName), h.Role('status')],
              [format(locale, 'common.loading', {})],
            ),
          ]),
        onSome: (detail) => liveMessages(model, episodeId, detail, maybeApprovalUrl, locale, h),
      }),
  })

const loadedView = (
  model: Model,
  view: ConsoleRobot,
  catalogue: Catalogue,
  history: ReadonlyArray<EpisodeSummary>,
  amounts: Readonly<Record<string, string>>,
  locale: Locale,
  timeZone: string,
  h: HtmlBuilder<Message>,
): Html => {
  const liveId = Errand.guards.Running(model.errand) ? model.errand.episodeId : null
  const past = history.filter((episode) => episode.id !== liveId)
  return h.div(
    [h.Class(pageClassName)],
    [
      header(view, locale, h),
      h.section(
        [
          h.Class(threadClassName),
          h.AriaLabel(format(locale, 'thread.conversation', { name: view.robot.name })),
          h.AriaLive('polite'),
        ],
        [
          view.robot.kind === 'sim' ? simulatorLink(view.robot.id, locale, h) : h.empty,
          past.length === 0 && Errand.guards.Idle(model.errand) && Intent.guards.Idle(model.intent)
            ? h.p([h.Class(systemClassName)], [format(locale, 'thread.empty', { name: view.robot.name })])
            : h.a(
                [h.Href(robotEpisodesRouter({ robotId: view.robot.id })), h.Class(systemClassName)],
                [format(locale, 'thread.records', { name: view.robot.name })],
              ),
          ...past.flatMap((episode) => historyMessages(episode, amounts, view.robot, locale, h)),
          ...intentAndErrand(
            model,
            errandMessages(model, locale, h),
            view.robot.name,
            view.robot.kind === 'sim',
            locale,
            h,
          ),
        ],
      ),
      dock(model, view, catalogue, locale, h),
      allowanceSheet(model, view, catalogue, locale, timeZone, h),
    ],
  )
}

/** `/robot/:id`: the robot as a conversation (DESIGN.md "Components"): its errands as messages, buy chips as the
 *  keyboard, the approval asked inline. */
export const robotConsoleView = Submodel.defineView<
  Model,
  Message,
  { readonly locale: Locale; readonly timeZone: string }
>((model, { locale, timeZone }, h) =>
  h.main(
    [h.Id('main')],
    [
      ConsoleState.match(model.state, {
        Loading: () => threadSkeleton(locale, h),
        SignedOut: () => signedOutView(locale, h),
        Failed: ({ error }) => failedView(error, Message.ClickedRefresh(), locale, h),
        Loaded: ({ robot, catalogue, history, amounts }) =>
          loadedView(model, robot, catalogue, history, amounts, locale, timeZone, h),
      }),
    ],
  ),
)
