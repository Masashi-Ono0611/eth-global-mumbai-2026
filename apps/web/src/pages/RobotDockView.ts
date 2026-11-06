import { format, type Locale } from '@ethmumbai/i18n'
import { Option } from 'effect'
import { childAttributes, type Html, type HtmlBuilder } from 'foldkit/html'
import type { ConsoleRobot } from '../api/Robot.ts'
import type { Catalogue } from '../api/Wallet.ts'
import { arrowUp, check, chevronDown } from '../Icon.ts'
import { BrainListbox } from './RobotBrain.ts'
import { isIntentOpen, isLive, Message, type Model } from './RobotConsole.ts'
import * as RobotVoice from './RobotVoice.ts'
import { micView, statusView } from './RobotVoiceView.ts'

// STYLES

/** Solid paper, so the thread never shows through the controls; a fixed 24 px fade above it softens the edge. */
const dockClassName =
  'sticky bottom-0 z-10 grid gap-2 bg-paper px-1 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6 before:bg-gradient-to-b before:from-paper/0 before:to-paper'
const dockHintClassName = 'px-1.5 text-[0.85rem] leading-snug text-muted'
const pillsClassName =
  '-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
const pillClassName =
  'inline-flex min-h-11 shrink-0 cursor-pointer snap-start items-center gap-1.5 rounded-full bg-surface px-4 text-[0.95rem] font-semibold shadow-[0_1px_2px_rgb(31_45_54/0.08)] transition-[transform,opacity] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45'
const pillAsksClassName = 'text-[0.75rem] font-semibold text-duck-deep'
const composerClassName =
  'rounded-card border border-rule bg-surface shadow-[0_1px_2px_rgb(31_45_54/0.06)] transition-[border-color,box-shadow] focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/20'
const composerRowClassName = 'flex items-center gap-1 pr-1.5'
const inputClassName =
  'min-h-12 w-full min-w-0 flex-1 bg-transparent px-4 text-base text-ink placeholder:text-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-60'
/** Vita's mic and Send, side by side at the composer's right edge. */
const actionsClassName = 'flex shrink-0 items-center gap-1.5'
const toolbarClassName = 'flex items-center justify-between gap-2 pr-1.5 pb-1.5 pl-1'
const sendClassName =
  'grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-surface transition-[transform,opacity] active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-25'
const brainWrapperClassName = 'relative min-w-0'
const brainButtonClassName =
  'inline-flex min-h-11 max-w-full cursor-pointer items-center gap-1.5 rounded-full px-3 text-[0.9rem] font-semibold text-ink transition-colors hover:bg-paper data-[open]:bg-paper data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'
const brainNameClassName = 'truncate'
const teeTagClassName =
  'inline-flex shrink-0 items-center rounded-full bg-paid/10 px-1.5 text-[0.72rem] font-semibold text-paid'
const chevronClassName = 'size-3.5 shrink-0 text-muted'
const brainItemsClassName =
  'z-30 w-72 max-w-[calc(100vw-1rem)] rounded-card bg-surface p-1.5 shadow-[0_10px_32px_rgb(31_45_54/0.18)] ring-1 ring-black/5 outline-none'
const brainItemClassName =
  'group grid cursor-pointer grid-cols-[1fr_auto] items-center gap-x-3 rounded-[14px] px-3 py-2.5 data-[active]:bg-paper'
const brainItemNameClassName = 'flex items-center gap-1.5 font-semibold'
const brainItemNoteClassName = 'block text-[0.85rem] leading-snug text-muted'
const brainCheckClassName = 'invisible size-4 text-ink group-data-[selected]:visible'

/** The menu opens above its button, over the thread (the composer sits at the bottom of the screen). */
const BRAIN_ANCHOR = { placement: 'top-start' as const, gap: 8, padding: 8 }

// VIEW

type Brain = Readonly<{ model: string; tee: boolean }>

const teeTag = (tee: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  tee ? h.span([h.Class(teeTagClassName)], [format(locale, 'thread.brainTee', {})]) : h.empty

/**
 * Which 0G brain answers the next message (Kris, 7 Nov), as a model menu like other AI clients': the Worker's ZG_MODEL,
 * whose provider is a TEE, or an allowlisted model without one. The pick goes with each request; what answered is
 * recorded per call. Hidden while the Worker offers only one brain.
 */
const brainMenu = (
  model: Model,
  brains: ReadonlyArray<Brain>,
  first: Brain,
  disabled: boolean,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html => {
  const selected = Option.getOrElse(model.maybeBrain, () => first.model)
  const teeOf = (value: string) => brains.find((brain) => brain.model === value)?.tee === true
  return h.submodel({
    slotId: model.brainPicker.id,
    model: model.brainPicker,
    view: BrainListbox.view,
    viewInputs: {
      anchor: BRAIN_ANCHOR,
      items: brains.map((brain) => brain.model),
      maybeSelectedValue: Option.some(selected),
      isDisabled: disabled,
      itemToConfig: (value) => ({
        className: brainItemClassName,
        content: h.div(
          [h.Class('contents')],
          [
            h.span(
              [],
              [
                h.span([h.Class(brainItemNameClassName)], [value, teeTag(teeOf(value), locale, h)]),
                h.span(
                  [h.Class(brainItemNoteClassName)],
                  [format(locale, 'thread.brainNote', { tee: teeOf(value) ? 'yes' : 'no' })],
                ),
              ],
            ),
            check(brainCheckClassName, h),
          ],
        ),
      }),
      buttonContent: h.span(
        [h.Class('flex min-w-0 items-center gap-1.5')],
        [
          h.span([h.Class(brainNameClassName)], [selected]),
          teeTag(teeOf(selected), locale, h),
          chevronDown(chevronClassName, h),
        ],
      ),
      buttonClassName: brainButtonClassName,
      buttonAttributes: childAttributes([
        h.AriaLabel(format(locale, 'thread.brainButton', { model: selected, tee: teeOf(selected) ? 'yes' : 'no' })),
      ]),
      itemsClassName: brainItemsClassName,
      itemsAttributes: childAttributes([h.AriaLabel(format(locale, 'thread.brainGroup', {}))]),
      className: brainWrapperClassName,
    },
    toParentMessage: (message) => Message.GotBrainPickerMessage({ message }),
  })
}

/** The owner's words, sent as the same intent a Get me pill makes; a round Send arrow and, with a choice, the brain menu. */
const composer = (
  model: Model,
  view: ConsoleRobot,
  blocked: boolean,
  described: boolean,
  mic: Html,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html => {
  const name = view.robot.name
  const brains = view.brains ?? []
  const first = brains[0]
  const input = h.input([
    h.Id('instruction'),
    h.Type('text'),
    h.Class(inputClassName),
    h.Maxlength(200),
    h.Autocomplete('off'),
    h.EnterKeyHint('send'),
    h.Placeholder(format(locale, 'thread.instructionPlaceholder', { name })),
    h.Value(model.instruction),
    h.Disabled(blocked),
    ...(described ? [h.AriaDescribedBy('dock-hint')] : []),
    h.OnInput((value) => Message.UpdatedInstruction({ value })),
  ])
  const send = h.button(
    [
      h.Type('submit'),
      h.Class(sendClassName),
      h.AriaLabel(format(locale, 'thread.send', {})),
      h.Disabled(blocked || model.instruction.trim().length === 0),
    ],
    [arrowUp('size-5', h)],
  )
  const withMenu = first !== undefined && brains.length > 1
  return h.form(
    [h.Class(composerClassName), h.OnSubmit(Message.SubmittedInstruction()), h.AriaBusy(blocked)],
    [
      h.label([h.For('instruction'), h.Class('sr-only')], [format(locale, 'thread.instructionLabel', { name })]),
      withMenu
        ? h.div(
            [h.Class('grid')],
            [
              h.div([h.Class('pt-1')], [input]),
              h.div(
                [h.Class(toolbarClassName)],
                [brainMenu(model, brains, first, blocked, locale, h), h.div([h.Class(actionsClassName)], [mic, send])],
              ),
            ],
          )
        : h.div([h.Class(composerRowClassName)], [input, mic, send]),
    ],
  )
}

/** "Get me a chai": one pill per item, the same intent for a real robot (it waits for the duck's scan) and a simulator. */
const suggestions = (
  catalogue: Catalogue,
  blocked: boolean,
  described: boolean,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class(pillsClassName)],
    catalogue.items.map((item) =>
      h.keyed('button')(
        `ask-${item.itemId}`,
        [
          h.Type('button'),
          h.Class(pillClassName),
          h.Disabled(blocked),
          ...(described ? [h.AriaDescribedBy('dock-hint')] : []),
          h.OnClick(Message.ClickedAskFor({ item: item.itemId })),
        ],
        [
          format(locale, 'thread.askChip', { item: item.name.toLowerCase() }),
          item.restricted ? h.span([h.Class(pillAsksClassName)], [format(locale, 'thread.asksYou', {})]) : h.empty,
        ],
      ),
    ),
  )

/** Why the dock rests, when it does: no allowance, an errand out, or a stopped allowance (which still sends). */
const hint = (noAllowance: boolean, busy: boolean, stopped: boolean) =>
  noAllowance ? 'thread.dockNoAllowance' : busy ? 'thread.dockBusy' : stopped ? 'thread.dockStopped' : null

/** One of Vita's voice views mounted in the conversation (the mic, its status line, the spoken bubbles). */
export const voiceIn = (
  model: Model,
  view: ConsoleRobot,
  slot: string,
  voiceView: typeof micView,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: `voice-${slot}-${view.robot.id}`,
    model: model.voice,
    view: voiceView,
    viewInputs: { name: view.robot.name, locale },
    toParentMessage: (message) => Message.GotVoiceMessage({ message }),
  })

/** The conversation's keyboard: Get me pills and the composer. A line says why only while the robot can't be sent. */
export const dock = (
  model: Model,
  view: ConsoleRobot,
  catalogue: Catalogue,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html => {
  // Never granted: nothing can be paid. Stopped (revoked, expired): the errand still runs and Arc refuses it on-chain,
  // which is the proof the revoke worked (spec §0 "done"), so the dock says so but stays open.
  const noAllowance = view.grant === null
  const stopped = view.grant !== null && view.grant.status !== 'active'
  const busy = isLive(model.errand) || isIntentOpen(model.intent)
  // While the owner talks the pills and the composer rest, so a tap cannot race the spoken request; the voice says its
  // own state under the mic, so the dock line stays for the errand.
  const talking =
    RobotVoice.Status.guards.Starting(model.voice.status) ||
    RobotVoice.Status.guards.Listening(model.voice.status) ||
    RobotVoice.Status.guards.Thinking(model.voice.status)
  const blocked = busy || noAllowance || talking
  const line = hint(noAllowance, busy, stopped)
  const pills = suggestions(catalogue, blocked, line !== null, locale, h)
  const voiceOn = !RobotVoice.Status.guards.Unavailable(model.voice.status)
  const mic = voiceOn ? voiceIn(model, view, 'mic', micView, locale, h) : h.empty
  return h.div(
    [h.Class(dockClassName)],
    [
      line === null
        ? h.empty
        : h.p([h.Class(dockHintClassName), h.Id('dock-hint')], [format(locale, line, { name: view.robot.name })]),
      pills,
      composer(model, view, blocked, line !== null, mic, locale, h),
      voiceOn ? voiceIn(model, view, 'status', statusView, locale, h) : h.empty,
    ],
  )
}
