import { Option } from 'effect'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { type Catalogue, type Invoice, type Item, usdc } from './api.ts'
import { Message } from './message.ts'
import { type Hitch, type Model, Sale, Till } from './model.ts'
import { qrDataUrl } from './qr.ts'

type H = HtmlBuilder<Message>

const price = (amount: string) => `${usdc(amount)} USDC`

const button = (h: H, label: string, onClick: Message, kind: 'primary' | 'quiet' = 'primary') =>
  h.button([h.Type('button'), h.Class(`button ${kind}`), h.OnClick(onClick)], [label])

/** The counter's menu. Restricted items are never sold at the counter: they need the owner's approval elsewhere. */
const menu = (h: H, catalogue: Catalogue): Html =>
  h.section(
    [h.Class('menu'), h.AriaLabel('Menu')],
    catalogue.items
      .filter((item) => !item.restricted)
      .map((item) =>
        h.button(
          [h.Type('button'), h.Class('menu-item'), h.OnClick(Message.ClickedItem({ itemId: item.itemId }))],
          [h.span([h.Class('menu-name')], [item.name]), h.span([h.Class('menu-price')], [price(item.amount)])],
        ),
      ),
  )

const hitchText: Record<Hitch, string> = {
  unverified: 'A status arrived without a valid signature. Ignoring it and asking again.',
  offline: 'The app did not answer. Asking again.',
}

const qr = (h: H, item: Item, invoice: Invoice, hitch: Option.Option<Hitch>): Html =>
  h.section(
    [h.Class('sale')],
    [
      h.h2([], [`${item.name} · ${price(invoice.amount)}`]),
      h.img([
        h.Class('qr'),
        h.Src(qrDataUrl(invoice.url)),
        h.Alt(`QR code for the x402 payment link of invoice ${invoice.id}`),
        h.Width('320'),
        h.Height('320'),
      ]),
      h.p([h.Class('hint')], ['Scan to pay in USDC on Arc (x402).']),
      h.p([h.Role('status'), h.Class('waiting')], ['Waiting for payment…']),
      Option.match(hitch, {
        onNone: () => h.empty,
        onSome: (problem) => h.p([h.Role('alert'), h.Class('problem')], [hitchText[problem]]),
      }),
      h.a([h.Href(invoice.url), h.Class('link'), h.Target('_blank'), h.Rel('noopener')], [invoice.url]),
      button(h, 'Cancel sale', Message.ClickedNextCustomer(), 'quiet'),
    ],
  )

const outcome = (h: H, title: string, detail: string, tone: 'paid' | 'stopped', actions: Html[]): Html =>
  h.section(
    [h.Class(`sale outcome ${tone}`)],
    [
      h.p([h.Class('mark'), h.AriaHidden(true)], [tone === 'paid' ? '✓' : '×']),
      h.h2([], [title]),
      h.p([], [detail]),
      ...actions,
    ],
  )

const saleView = (h: H, catalogue: Catalogue, sale: Sale): Html =>
  Sale.match(sale, {
    Choosing: () => menu(h, catalogue),
    Opening: ({ item }) => h.p([h.Role('status'), h.Class('waiting')], [`Opening an invoice for ${item.name}…`]),
    Waiting: ({ item, invoice, hitch }) => qr(h, item, invoice, hitch),
    Paid: ({ item, invoice }) =>
      outcome(h, 'Paid', `${item.name} · ${price(invoice.amount)} settled on Arc.`, 'paid', [
        button(h, 'Next customer', Message.ClickedNextCustomer()),
      ]),
    Expired: ({ item }) =>
      outcome(h, 'Invoice expired', `Nobody paid for ${item.name} in time.`, 'stopped', [
        button(h, 'New invoice', Message.ClickedTryAgain()),
        button(h, 'Back to the menu', Message.ClickedNextCustomer(), 'quiet'),
      ]),
    Refused: ({ item, reason }) =>
      outcome(h, `Could not open an invoice for ${item.name}`, reason, 'stopped', [
        button(h, 'Try again', Message.ClickedTryAgain()),
        button(h, 'Back to the menu', Message.ClickedNextCustomer(), 'quiet'),
      ]),
  })

export const view = (model: Model, h: H): Document => {
  const name = Till.guards.Ready(model.till) ? model.till.catalogue.name : 'Till'
  return {
    title: `${name} till`,
    body: h.main(
      [h.Class('till')],
      [
        h.header([], [h.h1([], [`${name} 🦆`]), h.p([h.Class('hint')], ['Point of sale · USDC on Arc'])]),
        Till.match(model.till, {
          Loading: () => h.p([h.Role('status'), h.Class('waiting')], ['Opening the till…']),
          Broken: ({ reason }) =>
            outcome(h, 'The till could not start', reason, 'stopped', [
              button(h, 'Try again', Message.ClickedTryAgain()),
            ]),
          Ready: ({ catalogue, sale }) => saleView(h, catalogue, sale),
        }),
      ],
    ),
  }
}
