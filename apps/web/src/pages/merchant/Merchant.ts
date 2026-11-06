import { format, type Locale } from '@ethmumbai/i18n'
import { duckCafe } from '@ethmumbai/protocol/Catalogue'
import { Effect, Schema } from 'effect'
import type * as HttpClient from 'effect/http/HttpClient'
import { Command, Submodel, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { usdc } from '../../api/Wallet.ts'
import { gateRouter } from '../../route.ts'
import { createInvoice, MerchantInvoice } from '../gate/GateApi.ts'

// `/merchant`: Duck Café's counter: its menu, an invoice for any item on request (what the robot or a person pays
// through x402), and the way to the gate screen. The menu is the public constant catalogue, so the page starts with it
// and the server's render already shows it (no loading state, nothing moves when it arrives).

const MerchantCatalogue = Schema.Struct({
  merchantId: Schema.String,
  name: Schema.String,
  items: Schema.Array(
    Schema.Struct({ itemId: Schema.String, name: Schema.String, amount: Schema.String, restricted: Schema.Boolean }),
  ),
})
type MerchantCatalogue = typeof MerchantCatalogue.Type

// MODEL

const InvoiceState = defineTaggedUnion({
  NoInvoice: {},
  Creating: { itemId: Schema.String },
  Created: { invoice: MerchantInvoice },
  Refused: { error: Schema.String },
})
export const Model = Schema.Struct({ catalogue: MerchantCatalogue, invoice: InvoiceState })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedCreateInvoice: { itemId: Schema.String },
  SucceededCreateInvoice: { invoice: MerchantInvoice },
  FailedCreateInvoice: { error: Schema.String },
})
export type Message = typeof Message.Type

// COMMAND

const CreateInvoice = Command.define('CreateInvoice', {
  args: { merchantId: Schema.String, itemId: Schema.String },
  messages: [Message.SucceededCreateInvoice, Message.FailedCreateInvoice],
  execute: ({ merchantId, itemId }) =>
    createInvoice(merchantId, itemId).pipe(
      Effect.map((invoice) => Message.SucceededCreateInvoice({ invoice })),
      Effect.catch((failure) => Effect.succeed(Message.FailedCreateInvoice({ error: failure.error }))),
    ),
})

// INIT

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient>

const duckCafeCatalogue: MerchantCatalogue = { merchantId: duckCafe.id, name: duckCafe.name, items: duckCafe.items }

export const init = (catalogue: MerchantCatalogue = duckCafeCatalogue): UpdateReturn => ({
  model: { catalogue, invoice: InvoiceState.NoInvoice() },
})

// UPDATE

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    ClickedCreateInvoice: ({ itemId }) =>
      InvoiceState.guards.Creating(model.invoice)
        ? { model }
        : {
            model: modifyFields(model, { invoice: () => InvoiceState.Creating({ itemId }) }),
            commands: [CreateInvoice({ merchantId: model.catalogue.merchantId, itemId })],
          },
    SucceededCreateInvoice: ({ invoice }) => ({
      model: modifyFields(model, { invoice: () => InvoiceState.Created({ invoice }) }),
    }),
    FailedCreateInvoice: ({ error }) => ({
      model: modifyFields(model, { invoice: () => InvoiceState.Refused({ error }) }),
    }),
  })

// VIEW

const itemRow = (
  item: MerchantCatalogue['items'][number],
  creating: boolean,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed('li')(
    item.itemId,
    [h.Class('menu-item')],
    [
      h.span([h.Class('menu-name')], [item.name]),
      h.span([h.Class('menu-price')], [`${usdc(item.amount)} USDC`]),
      item.restricted ? h.span([h.Class('hint')], [format(locale, 'merchant.restricted', {})]) : h.empty,
      h.button(
        [
          h.Type('button'),
          h.Class('secondary-action'),
          h.Disabled(creating),
          h.OnClick(Message.ClickedCreateInvoice({ itemId: item.itemId })),
        ],
        [format(locale, 'merchant.createInvoice', {})],
      ),
    ],
  )

const invoiceView = (invoice: MerchantInvoice, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('merchant-invoice')],
    [
      h.h2([], [format(locale, 'gate.invoice', {})]),
      h.dl(
        [],
        [
          h.dt([], ['id']),
          h.dd([h.Class('invoice-id')], [invoice.id]),
          h.dt([], [format(locale, 'gate.payLink', {})]),
          h.dd([], [h.a([h.Href(invoice.url)], [invoice.url])]),
          h.dt([], [format(locale, 'gate.price', {})]),
          h.dd([], [`${usdc(invoice.amount)} USDC`]),
          h.dt([], ['invoiceHash']),
          h.dd([h.Class('invoice-hash')], [invoice.invoiceHash]),
        ],
      ),
    ],
  )

const invoiceArea = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  InvoiceState.match(model.invoice, {
    NoInvoice: () => h.empty,
    Creating: () => h.p([h.Role('status')], [format(locale, 'common.loading', {})]),
    Created: ({ invoice }) => invoiceView(invoice, locale, h),
    Refused: ({ error }) => h.p([h.Role('alert')], [format(locale, 'common.errorDetail', { message: error })]),
  })

/** `/merchant`: the menu, an invoice on request, and the gate screen. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), h.Class('merchant-page')],
    [
      h.h1([], [format(locale, 'merchant.title', { name: model.catalogue.name })]),
      h.ul(
        [h.Class('menu')],
        model.catalogue.items.map((item) => itemRow(item, InvoiceState.guards.Creating(model.invoice), locale, h)),
      ),
      invoiceArea(model, locale, h),
      h.a(
        [h.Href(gateRouter({ merchantId: model.catalogue.merchantId })), h.Class('primary-action')],
        [format(locale, 'merchant.openGate', {})],
      ),
    ],
  ),
)
