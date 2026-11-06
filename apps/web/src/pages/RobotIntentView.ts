import { format, type Locale } from '@ethmumbai/i18n'
import { isOpenIntent, type NavCall, type NavTurnView } from '@ethmumbai/protocol/Intent'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { simulatorUrl } from '../api/Robot.ts'
import { Intent, Message, type Model } from './RobotConsole.ts'

// STYLES

const ownerBubbleClassName = 'max-w-[82%] self-end rounded-[20px_20px_6px_20px] bg-ink px-3.5 pt-2 pb-1.5 text-surface'
const robotBubbleClassName = 'max-w-[86%] self-start rounded-[20px_20px_20px_6px] bg-surface px-3.5 pt-2 pb-2'
const errorBubbleClassName = 'max-w-[86%] self-start rounded-[20px_20px_20px_6px] bg-error-soft px-3.5 py-2 text-error'
const stepClassName = 'self-center rounded-full bg-surface/60 px-3 py-1 text-center text-sm text-muted'
const walkingClassName = 'grid justify-items-center gap-2 self-center text-center text-sm text-muted'
const stopClassName =
  'min-h-11 cursor-pointer rounded-full bg-error-soft px-5 font-semibold text-error transition-transform active:scale-[0.96] disabled:opacity-60'
const simLinkClassName =
  'self-center rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-surface no-underline transition-transform active:scale-[0.96]'
const formClassName = 'grid grid-cols-[1fr_auto] gap-1.5'
const inputClassName =
  'min-h-12 w-full rounded-control border border-rule bg-surface px-3.5 text-base text-ink placeholder:text-muted disabled:opacity-60'
const sendClassName =
  'min-h-12 cursor-pointer rounded-control bg-ink px-5 font-semibold text-surface transition-transform active:scale-[0.96] disabled:opacity-60'

// VIEW

const textArg = (call: NavCall, name: string): string | null => {
  const value = call.args[name]
  return typeof value === 'string' ? value : null
}

/** One tool call of 0G's navigation, as the owner reads it: the duck's own words for say(), a step otherwise. */
const callMessage = (key: string, call: NavCall, locale: Locale, h: HtmlBuilder<Message>): Html => {
  if (call.name === 'say') {
    const text = textArg(call, 'text')
    return text === null ? h.empty : h.keyed('p')(key, [h.Class(robotBubbleClassName)], [text])
  }
  if (call.name === 'finish') return h.empty
  return h.keyed('p')(
    key,
    [h.Class(stepClassName)],
    [format(locale, 'thread.step', { tool: call.name, place: textArg(call, 'place') ?? 'other' })],
  )
}

const turnMessages = (turn: NavTurnView, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  ...turn.calls.map((call) => callMessage(`turn-${turn.step}-${call.id}`, call, locale, h)),
  turn.error === null
    ? h.empty
    : h.keyed('p')(
        `turn-${turn.step}-error`,
        [h.Class(stepClassName)],
        [format(locale, 'thread.turnError', { error: turn.error })],
      ),
]

/** How an intent ended when no errand came of it (the errand's own messages cover the rest). */
const intentEnd = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const { intent } = model
  if (!Intent.guards.Open(intent) || intent.intent.episodeId !== null) return h.empty
  const view = intent.intent
  if (view.state === 'stopped')
    return h.p(
      [h.Class(robotBubbleClassName)],
      [
        view.reason === null
          ? format(locale, 'thread.intentStoppedNoReason', {})
          : format(locale, 'thread.intentStopped', { reason: view.reason }),
      ],
    )
  if (view.state === 'expired')
    return h.p([h.Class(robotBubbleClassName)], [format(locale, 'thread.intentExpired', {})])
  return h.empty
}

/** While the duck walks: say so, and let the owner stop it. */
const walking = (model: Model, name: string, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const { intent } = model
  if (!Intent.guards.Open(intent) || !isOpenIntent(intent.intent.state)) return h.empty
  return h.div(
    [h.Class(walkingClassName)],
    [
      h.p([h.Role('status')], [format(locale, 'thread.walking', { name })]),
      h.button(
        [
          h.Type('button'),
          h.Class(stopClassName),
          h.Disabled(intent.stopping),
          h.OnClick(Message.ClickedStopIntent({ intentId: intent.intent.id })),
        ],
        [format(locale, intent.stopping ? 'thread.stopping' : 'thread.stop', { name })],
      ),
    ],
  )
}

/** The intent in the conversation: the owner's instruction, 0G's navigation turns, the stop control, how it ended. */
export const intentMessages = (
  model: Model,
  name: string,
  locale: Locale,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Intent.match(model.intent, {
    Idle: () => [],
    Sending: ({ instruction }) => [h.keyed('p')('intent-ask', [h.Class(ownerBubbleClassName)], [instruction])],
    Failed: ({ error }) => [
      h.keyed('p')(
        'intent-failed',
        [h.Class(errorBubbleClassName), h.Role('alert')],
        [format(locale, 'thread.intentFailed', { message: error })],
      ),
    ],
    Open: ({ intent }) => [
      h.keyed('p')(`${intent.id}-ask`, [h.Class(ownerBubbleClassName)], [intent.instruction]),
      ...intent.turns.flatMap((turn) => turnMessages(turn, locale, h)),
      walking(model, name, locale, h),
      intentEnd(model, locale, h),
    ],
  })

/** The errand the intent turned into already shows the instruction, so its own "Buy …" bubble is skipped. */
export const fromIntent = (model: Model, episodeId: string): boolean =>
  Intent.guards.Open(model.intent) && model.intent.intent.episodeId === episodeId

export const simulatorLink = (robotId: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(simulatorUrl(robotId, null)), h.Target('_blank'), h.Rel('noopener'), h.Class(simLinkClassName)],
    [format(locale, 'thread.openSimulator', {})],
  )

/** A simulator robot also takes the owner's own words ("get me a chai"), sent as the same intent a Buy chip makes. */
export const instructionForm = (
  model: Model,
  name: string,
  busy: boolean,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.form(
    [h.Class(formClassName), h.OnSubmit(Message.SubmittedInstruction()), h.AriaBusy(busy)],
    [
      h.label([h.For('instruction'), h.Class('sr-only')], [format(locale, 'thread.instructionLabel', { name })]),
      h.input([
        h.Id('instruction'),
        h.Type('text'),
        h.Class(inputClassName),
        h.Maxlength(200),
        h.Autocomplete('off'),
        h.Placeholder(format(locale, 'thread.instructionPlaceholder', {})),
        h.Value(model.instruction),
        h.Disabled(busy),
        h.OnInput((value) => Message.UpdatedInstruction({ value })),
      ]),
      h.button([h.Type('submit'), h.Class(sendClassName), h.Disabled(busy)], [format(locale, 'thread.send', {})]),
    ],
  )
