import { format, type Locale } from '@ethmumbai/i18n'
import type { RadioGroup } from '@foldkit/ui'
import { clsx } from 'clsx'
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { type ConsoleRobot, invoiceIdFrom } from '../api/Robot.ts'
import { type Catalogue, usdc } from '../api/Wallet.ts'
import { BrainRadioGroup } from './RobotBrain.ts'
import { isIntentOpen, isLive, Message, type Model } from './RobotConsole.ts'
import { instructionForm } from './RobotIntentView.ts'
import * as RobotVoice from './RobotVoice.ts'
import { micView, statusView } from './RobotVoiceView.ts'

// STYLES

const dockClassName =
  'sticky bottom-0 grid gap-2 bg-gradient-to-b from-paper/0 via-paper via-[1rem] to-paper px-1 pt-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))]'
const dockHintClassName = 'pl-1.5 text-[0.85rem] text-muted'
const chipsClassName = 'grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-1.5'
const withMicClassName = 'grid grid-cols-[1fr_auto] items-end gap-2'
const chipClassName =
  'grid min-h-[3.25rem] cursor-pointer place-content-center justify-items-center rounded-2xl bg-surface px-2 text-center leading-tight font-semibold shadow-[0_1px_2px_rgb(31_45_54/0.08)] transition-[transform,opacity] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45'
const chipPriceClassName = 'text-[0.8rem] font-medium text-muted'
const askChipClassName = 'text-[0.75rem] font-semibold text-duck-deep'
const detailsClassName = 'px-1.5 text-sm text-muted [&_summary]:min-h-11 [&_summary]:cursor-pointer [&_summary]:py-2.5'
const invoiceInputClassName =
  'mt-1 min-h-11 w-full rounded-control border border-rule bg-surface px-3 text-base text-ink placeholder:text-muted'
const brainRowClassName = 'flex flex-wrap items-center gap-x-1 gap-y-0.5 pl-1.5'
const brainLabelClassName = 'pr-0.5 text-[0.78rem] text-muted'
const brainGroupClassName = 'flex flex-wrap gap-0.5'
// Small and quiet: the TEE brain is the default, the other one a tap away. Not duck yellow (that means "needs you").
const brainOptionClassName =
  'inline-flex min-h-9 cursor-pointer items-center rounded-full px-2.5 text-[0.78rem] font-medium text-muted transition-[transform,background-color,color] active:scale-[0.96] data-[checked]:bg-surface data-[checked]:font-semibold data-[checked]:text-ink data-[checked]:shadow-[0_1px_2px_rgb(31_45_54/0.08)]'
const bottomRowClassName = 'grid gap-0.5'

// VIEW

/** Paying the counter directly, folded away: for a real robot its open invoice now (`payNow`), and for any robot one
 *  exact invoice by the gate's payment link or its 26-character id (empty = the counter's open invoice). */
const invoiceDetails = (model: Model, payNow: Html, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const invoiceInvalid = model.invoiceInput.trim().length > 0 && invoiceIdFrom(model.invoiceInput) === null
  return h.details(
    [h.Class(detailsClassName)],
    [
      h.summary([], [format(locale, 'thread.specificQr', {})]),
      payNow,
      h.label([h.For('gate-invoice')], [format(locale, 'console.gateInvoice', {})]),
      h.input([
        h.Id('gate-invoice'),
        h.Type('text'),
        h.Class(clsx(invoiceInputClassName, { 'border-invalid': invoiceInvalid })),
        h.Value(model.invoiceInput),
        h.Placeholder(format(locale, 'console.gateInvoiceHint', {})),
        h.AriaInvalid(invoiceInvalid),
        h.AriaDescribedBy('gate-invoice-error'),
        h.OnInput((value) => Message.UpdatedInvoiceInput({ value })),
      ]),
      invoiceInvalid
        ? h.p(
            [h.Id('gate-invoice-error'), h.Role('alert'), h.Class('mt-1 text-error')],
            [format(locale, 'console.gateInvoiceInvalid', {})],
          )
        : h.empty,
    ],
  )
}

/**
 * Which 0G brain answers the next message (Kris, 7 Nov): the Worker's ZG_MODEL, whose provider is a TEE, or an
 * allowlisted model without one. The pick goes with each request; what answered is recorded per call. Hidden while
 * the Worker offers only one brain.
 */
const brainChoice = (model: Model, view: ConsoleRobot, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const brains = view.brains ?? []
  const first = brains[0]
  if (first === undefined || brains.length < 2) return h.empty
  const teeOf = (value: string) => (brains.find((brain) => brain.model === value)?.tee === true ? 'yes' : 'no')
  const options = ({ group, options: rendered }: RadioGroup.RenderInfo): Html =>
    h.div(
      [...group, h.Class(brainGroupClassName)],
      rendered.map((option) =>
        h.button(
          [...option.option, h.Class(brainOptionClassName)],
          [
            h.span(
              [...option.label],
              [format(locale, 'thread.brainOption', { model: option.value, tee: teeOf(option.value) })],
            ),
            h.span(
              [...option.description, h.Class('sr-only')],
              [format(locale, 'thread.brainNote', { tee: teeOf(option.value) })],
            ),
          ],
        ),
      ),
    )
  return h.div(
    [h.Class(brainRowClassName)],
    [
      h.span([h.Class(brainLabelClassName), h.AriaHidden(true)], [format(locale, 'thread.brainLabel', {})]),
      h.submodel({
        slotId: model.brainPicker.id,
        model: model.brainPicker,
        view: BrainRadioGroup.view,
        viewInputs: {
          options: brains.map((brain) => brain.model),
          selectedValue: Option.orElse(model.maybeBrain, () => Option.some(first.model)),
          ariaLabel: format(locale, 'thread.brainGroup', {}),
          orientation: 'Horizontal',
          hasOptionDescription: () => true,
          toView: options,
        },
        toParentMessage: (message) => Message.GotBrainPickerMessage({ message }),
      }),
    ],
  )
}

/** One chip per catalogue item, its name over its price ("asks you" for a restricted one). A real robot fetches it
 *  (its own scan pays the counter); a simulator buys it now. */
const itemChips = (
  view: ConsoleRobot,
  catalogue: Catalogue,
  disabled: boolean,
  fetch: boolean,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class(chipsClassName)],
    catalogue.items.map((item) =>
      h.keyed('button')(
        `${fetch ? 'ask' : 'buy'}-${item.itemId}`,
        [
          h.Type('button'),
          h.Class(chipClassName),
          h.Disabled(disabled),
          h.AriaDescribedBy('dock-hint'),
          h.AriaLabel(
            fetch
              ? format(locale, 'thread.askChip', { item: item.name.toLowerCase() })
              : format(locale, 'thread.buyChip', { item: item.name, amount: usdc(item.amount) }),
          ),
          h.OnClick(
            fetch ? Message.ClickedAskFor({ item: item.itemId }) : Message.ClickedStartErrand({ item: item.itemId }),
          ),
        ],
        [
          item.name,
          item.restricted
            ? h.span([h.Class(askChipClassName)], [format(locale, 'thread.asksYou', {})])
            : h.span([h.Class(chipPriceClassName)], [`${usdc(item.amount)} USDC`]),
        ],
      ),
    ),
  )

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

/** What the dock says: why it is resting (no allowance, an errand out, stopped) or what to do. Talking is not an
 *  errand: the voice says its own state under the mic. */
const dockHint = (
  name: string,
  noAllowance: boolean,
  errandBusy: boolean,
  stopped: boolean,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.p(
    [h.Class(noAllowance || errandBusy || stopped ? dockHintClassName : 'sr-only'), h.Id('dock-hint')],
    [
      format(
        locale,
        noAllowance
          ? 'thread.dockNoAllowance'
          : errandBusy
            ? 'thread.dockBusy'
            : stopped
              ? 'thread.dockStopped'
              : 'thread.dockReady',
        { name },
      ),
    ],
  )

/** The conversation's keyboard: the buy chips (and, for a simulator, the owner's own words), disabled while the robot is
 *  out or without any allowance, with the reason. */
export const dock = (
  model: Model,
  view: ConsoleRobot,
  catalogue: Catalogue,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html => {
  // Never granted: nothing can be paid. Stopped (revoked, expired): the errand still runs and Arc refuses it on-chain,
  // which is the proof the revoke worked (spec §0 "done").
  const noAllowance = view.grant === null
  const stopped = view.grant !== null && view.grant.status !== 'active'
  const voiceBusy =
    RobotVoice.Status.guards.Starting(model.voice.status) ||
    RobotVoice.Status.guards.Listening(model.voice.status) ||
    RobotVoice.Status.guards.Thinking(model.voice.status)
  // While the owner talks the chips rest (dimmed), so a tap cannot race the spoken request.
  const errandBusy = isLive(model.errand) || isIntentOpen(model.intent)
  const busy = errandBusy || voiceBusy
  const sim = view.robot.kind === 'sim'
  const voiceSlot = (slot: string, voiceView: typeof micView) => voiceIn(model, view, slot, voiceView, locale, h)
  // Vita's voice sits beside the row a spoken request stands for: "Get me" for a real robot, Buy for a simulator.
  const withMic = (row: Html): Html =>
    RobotVoice.Status.guards.Unavailable(model.voice.status)
      ? row
      : h.div(
          [h.Class('grid gap-1')],
          [h.div([h.Class(withMicClassName)], [row, voiceSlot('mic', micView)]), voiceSlot('status', statusView)],
        )
  return h.div(
    [h.Class(dockClassName)],
    [
      dockHint(view.robot.name, noAllowance, errandBusy, stopped, locale, h),
      // One row of items: a real robot fetches (its scan pays), a simulator buys. Paying a real robot's counter
      // directly is folded away below.
      withMic(itemChips(view, catalogue, busy || noAllowance, !sim, locale, h)),
      instructionForm(model, view.robot.name, busy || noAllowance, locale, h),
      h.div(
        [h.Class(bottomRowClassName)],
        [
          invoiceDetails(
            model,
            sim
              ? h.empty
              : h.div(
                  [h.Class('grid gap-1 pb-1')],
                  [
                    h.p([], [format(locale, 'thread.buyRowHint', {})]),
                    itemChips(view, catalogue, busy || noAllowance, false, locale, h),
                  ],
                ),
            locale,
            h,
          ),
          brainChoice(model, view, locale, h),
        ],
      ),
    ],
  )
}
