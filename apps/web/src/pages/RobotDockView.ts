import { format, type Locale } from '@ethmumbai/i18n'
import { clsx } from 'clsx'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { type ConsoleRobot, invoiceIdFrom } from '../api/Robot.ts'
import { type Catalogue, usdc } from '../api/Wallet.ts'
import { isIntentOpen, isLive, Message, type Model } from './RobotConsole.ts'
import { instructionForm } from './RobotIntentView.ts'

// STYLES

const dockClassName =
  'sticky bottom-0 grid gap-2 bg-gradient-to-b from-paper/0 via-paper to-paper px-1 pt-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))]'
const dockHintClassName = 'pl-1.5 text-[0.85rem] text-muted'
const chipsClassName = 'grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-1.5'
const chipClassName =
  'grid min-h-[3.25rem] cursor-pointer place-content-center justify-items-center rounded-2xl bg-surface leading-tight font-semibold shadow-[0_1px_2px_rgb(31_45_54/0.08)] transition-[transform,opacity] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45'
const chipPriceClassName = 'text-[0.8rem] font-medium text-muted'
const askChipClassName = 'text-[0.75rem] font-semibold text-duck-deep'
const detailsClassName = 'px-1.5 text-sm text-muted [&_summary]:min-h-11 [&_summary]:cursor-pointer [&_summary]:py-2.5'
const invoiceInputClassName =
  'mt-1 min-h-11 w-full rounded-control border border-rule bg-surface px-3 text-base text-ink placeholder:text-muted'

// VIEW

/** Pay one exact invoice: the gate's payment link or its 26-character id; empty = the counter's open invoice. */
const invoiceDetails = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const invoiceInvalid = model.invoiceInput.trim().length > 0 && invoiceIdFrom(model.invoiceInput) === null
  return h.details(
    [h.Class(detailsClassName)],
    [
      h.summary([], [format(locale, 'thread.specificQr', {})]),
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

/** A real robot's "Get me …" row: an intent that waits for the duck's own scan (its Buy row pays the counter now). */
const askChips = (
  view: ConsoleRobot,
  catalogue: Catalogue,
  disabled: boolean,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('grid gap-1')],
    [
      h.p([h.Class(dockHintClassName)], [format(locale, 'thread.askRowHint', { name: view.robot.name })]),
      h.div(
        [h.Class(chipsClassName)],
        catalogue.items.map((item) =>
          h.keyed('button')(
            `ask-${item.itemId}`,
            [
              h.Type('button'),
              h.Class(chipClassName),
              h.Disabled(disabled),
              h.OnClick(Message.ClickedAskFor({ item: item.itemId })),
            ],
            [format(locale, 'thread.askChip', { item: item.name.toLowerCase() })],
          ),
        ),
      ),
      h.p([h.Class(dockHintClassName)], [format(locale, 'thread.buyRowHint', {})]),
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
  const busy = isLive(model.errand) || isIntentOpen(model.intent)
  const sim = view.robot.kind === 'sim'
  return h.div(
    [h.Class(dockClassName)],
    [
      h.p(
        [h.Class(dockHintClassName), h.Id('dock-hint')],
        [
          format(
            locale,
            noAllowance
              ? 'thread.dockNoAllowance'
              : busy
                ? 'thread.dockBusy'
                : stopped
                  ? 'thread.dockStopped'
                  : 'thread.dockReady',
            {
              name: view.robot.name,
            },
          ),
        ],
      ),
      instructionForm(model, view.robot.name, busy || noAllowance, locale, h),
      sim ? h.empty : askChips(view, catalogue, busy || noAllowance, locale, h),
      h.div(
        [h.Class(chipsClassName)],
        catalogue.items.map((item) =>
          h.keyed('button')(
            item.itemId,
            [
              h.Type('button'),
              h.Class(chipClassName),
              h.Disabled(busy || noAllowance),
              h.AriaDescribedBy('dock-hint'),
              h.AriaLabel(format(locale, 'thread.buyChip', { item: item.name, amount: usdc(item.amount) })),
              h.OnClick(Message.ClickedStartErrand({ item: item.itemId })),
            ],
            [
              item.name,
              item.restricted
                ? h.span([h.Class(askChipClassName)], [format(locale, 'thread.asksYou', {})])
                : h.span([h.Class(chipPriceClassName)], [usdc(item.amount)]),
            ],
          ),
        ),
      ),
      invoiceDetails(model, locale, h),
    ],
  )
}
