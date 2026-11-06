import { Array, Option } from 'effect'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { type Catalogue, type CounterInvoice, type Item, usdc } from './api.ts'
import { Message } from './message.ts'
import { APPROVAL_ABOVE, CLOSING_MILLIS, type Link, type Model, Screen, Tap, Till } from './model.ts'

type H = HtmlBuilder<Message>

/** What the friend at the counter needs to know about the invoice on the screen. */
type Shown = 'waiting' | 'closing' | 'paid' | 'expired'

// STYLES

const tillClassName = 'mx-auto grid max-w-2xl gap-6 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-12'
const titleClassName = 'm-0 text-[clamp(1.6rem,4vw,2.2rem)] leading-tight font-bold'
const hintClassName = 'm-0 text-muted'
const eyebrowClassName = 'm-0 text-sm font-semibold tracking-wide uppercase opacity-70'
const panelClassName: Record<Shown, string> = {
  waiting: 'grid justify-items-center gap-3 rounded-3xl border border-rule bg-white p-6 text-center',
  closing: 'grid justify-items-center gap-3 rounded-3xl border border-stopped/40 bg-white p-6 text-center',
  paid: 'grid justify-items-center gap-3 rounded-3xl bg-paid p-6 text-center text-white',
  expired: 'grid justify-items-center gap-3 rounded-3xl border border-rule bg-white p-6 text-center text-muted',
}
const quietPanelClassName =
  'grid justify-items-center gap-3 rounded-3xl border border-dashed border-rule p-6 text-center'
const billClassName = 'm-0 text-2xl font-bold tabular-nums'
const pillClassName: Record<Shown, string> = {
  waiting: 'rounded-full bg-accent/10 px-4 py-1 text-base font-bold text-accent',
  closing: 'rounded-full bg-stopped/10 px-4 py-1 text-base font-bold text-stopped',
  paid: 'rounded-full bg-white px-4 py-1 text-base font-bold text-paid',
  expired: 'rounded-full bg-rule px-4 py-1 text-base font-bold text-ink',
}
const paidMarkClassName = 'm-0 text-7xl leading-none font-bold'
const detailClassName = 'm-0 max-w-md'
const approvalClassName = 'm-0 max-w-md rounded-xl bg-accent/10 px-4 py-3 text-accent'
const alertClassName = 'm-0 font-semibold text-stopped'
const menuClassName = 'grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-3 sm:gap-4'
const menuItemClassName =
  'grid min-h-11 cursor-pointer touch-manipulation content-start gap-1 rounded-2xl border border-rule bg-white p-4 text-start sm:p-6 select-none hover:border-ink active:scale-[0.98] disabled:cursor-progress disabled:opacity-50'
const menuNameClassName = 'text-lg font-semibold sm:text-xl'
const menuPriceClassName = 'text-sm whitespace-nowrap text-muted tabular-nums sm:text-base'
const badgeClassName =
  'mt-1 justify-self-start rounded-lg bg-accent/10 px-2 py-1 text-xs leading-snug font-semibold text-accent'
const buttonClassName =
  'min-h-12 cursor-pointer touch-manipulation rounded-full bg-ink px-6 font-semibold text-paper active:scale-[0.98]'

// VIEW

const price = (amount: string) => `${usdc(amount)} USDC`
const needsApproval = (amount: string) => BigInt(amount) > APPROVAL_ABOVE

const shownOf = (invoice: CounterInvoice, readAt: number): Shown => {
  if (invoice.status === 'paid' || invoice.status === 'used') {
    return 'paid'
  }
  if (invoice.status === 'expired') {
    return 'expired'
  }
  return invoice.expiresAt * 1000 - readAt < CLOSING_MILLIS ? 'closing' : 'waiting'
}

const statusText: Record<Shown, string> = {
  waiting: 'Waiting for payment',
  closing: 'Off the screen',
  paid: 'Paid',
  expired: 'Expired',
}

const detailText: Record<Shown, string> = {
  waiting: 'The duck pays by scanning the QR code on the counter screen.',
  closing: 'Under a minute left, so the duck will not take it. Tap an item for a fresh bill.',
  paid: 'Settled in USDC on Arc. Tap an item for the next bill.',
  expired: 'Nobody paid in time. Tap an item for a fresh bill.',
}

const showing = (h: H, invoice: CounterInvoice, readAt: number): Html => {
  const shown = shownOf(invoice, readAt)
  return h.section(
    [h.Class(panelClassName[shown]), h.AriaLabel('On the counter screen')],
    [
      h.p([h.Class(eyebrowClassName)], ['On the counter screen']),
      shown === 'paid' ? h.p([h.Class(paidMarkClassName), h.AriaHidden(true)], ['✓']) : h.empty,
      h.h2([h.Class(billClassName)], [`${invoice.name} · ${price(invoice.amount)}`]),
      h.p([h.Role('status'), h.Class(pillClassName[shown])], [statusText[shown]]),
      h.p([h.Class(detailClassName)], [detailText[shown]]),
      shown === 'waiting' && needsApproval(invoice.amount)
        ? h.p(
            [h.Class(approvalClassName)],
            [
              `Over ${usdc(APPROVAL_ABOVE.toString())} USDC: the duck first asks its owner to approve with World ID. This can take a minute.`,
            ],
          )
        : h.empty,
    ],
  )
}

const quiet = (h: H, text: string): Html =>
  h.section(
    [h.Class(quietPanelClassName), h.AriaLabel('On the counter screen')],
    [h.p([h.Class(eyebrowClassName)], ['On the counter screen']), h.p([h.Role('status')], [text])],
  )

const screenView = (h: H, screen: Screen): Html =>
  Screen.match(screen, {
    Reading: () => quiet(h, 'Reading the counter screen…'),
    Blank: () => quiet(h, 'Nothing on the screen yet. Tap an item to show its bill.'),
    Showing: ({ invoice, readAt }) => showing(h, invoice, readAt),
  })

const itemName = (catalogue: Catalogue, itemId: string) =>
  Option.match(
    Array.findFirst(catalogue.items, (item) => item.itemId === itemId),
    { onNone: () => itemId, onSome: (item) => item.name },
  )

const tapLine = (h: H, catalogue: Catalogue, tap: Tap): Html =>
  Tap.match(tap, {
    Idle: () => h.empty,
    Placing: ({ itemId }) => h.p([h.AriaLive('polite')], [`Putting ${itemName(catalogue, itemId)} on the screen…`]),
    Refused: ({ itemId, reason }) =>
      h.p(
        [h.Role('alert'), h.Class(alertClassName)],
        [`Could not put ${itemName(catalogue, itemId)} on the screen: ${reason}`],
      ),
  })

const linkLine = (h: H, link: Link): Html =>
  link === 'silent'
    ? h.p([h.Role('alert'), h.Class(alertClassName)], ['The app did not answer. Asking again.'])
    : h.empty

const menuItem = (h: H, item: Item, busy: boolean): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class(menuItemClassName),
      h.Disabled(busy),
      h.OnClick(Message.ClickedItem({ itemId: item.itemId })),
    ],
    [
      h.span([h.Class(menuNameClassName)], [item.name]),
      h.span([h.Class(menuPriceClassName)], [price(item.amount)]),
      needsApproval(item.amount) ? h.span([h.Class(badgeClassName)], ['Needs owner approval · World ID']) : h.empty,
    ],
  )

/** The counter's menu. Restricted items are never sold at the counter: they need the owner's approval elsewhere. */
const menu = (h: H, catalogue: Catalogue, tap: Tap): Html =>
  h.section(
    [h.Class(menuClassName), h.AriaLabel('Menu')],
    Array.map(
      Array.filter(catalogue.items, (item) => !item.restricted),
      (item) => menuItem(h, item, Tap.guards.Placing(tap)),
    ),
  )

const readyView = (h: H, ready: Extract<Till, { _tag: 'Ready' }>): Html =>
  h.div(
    [h.Class('contents')],
    [
      menu(h, ready.catalogue, ready.tap),
      tapLine(h, ready.catalogue, ready.tap),
      linkLine(h, ready.link),
      screenView(h, ready.screen),
    ],
  )

export const view = (model: Model, h: H): Document => {
  const name = Till.guards.Ready(model.till) ? model.till.catalogue.name : 'Till'
  return {
    title: `${name} till`,
    body: h.main(
      [h.Class(tillClassName)],
      [
        h.header(
          [h.Class('grid gap-1')],
          [
            h.h1([h.Class(titleClassName)], [`${name} 🦆`]),
            h.p([h.Class(hintClassName)], ['Till · tap an item to put its bill on the counter screen']),
          ],
        ),
        Till.match(model.till, {
          Loading: () => h.p([h.Role('status')], ['Opening the till…']),
          Broken: ({ reason }) =>
            h.section(
              [h.Class(quietPanelClassName)],
              [
                h.h2([h.Class(billClassName)], ['The till could not start']),
                h.p([h.Class(detailClassName)], [reason]),
                h.button(
                  [h.Type('button'), h.Class(buttonClassName), h.OnClick(Message.ClickedTryAgain())],
                  ['Try again'],
                ),
              ],
            ),
          Ready: (ready) => readyView(h, ready),
        }),
      ],
    ),
  }
}
