import { format, type Locale } from '@ethmumbai/i18n'
import { Effect, Schema } from 'effect'
import type * as HttpClient from 'effect/http/HttpClient'
import { Command, Submodel, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { getJson } from '../../api/Http.ts'
import { usdc } from '../../api/Wallet.ts'
import { gateRouter } from '../../route.ts'
import { failedView } from '../Shared.ts'
import { createInvoice, MerchantInvoice } from '../gate/GateApi.ts'

// `/merchant`: Duck Café's counter: its menu, an invoice for any item on request (what the robot or a person pays
// through x402), and the way to the gate screen.

const MERCHANT_ID = 'duck-cafe'

const MerchantCatalogue = Schema.Struct({
  merchantId: Schema.String,
  name: Schema.String,
  items: Schema.Array(
    Schema.Struct({ itemId: Schema.String, name: Schema.String, amount: Schema.String, restricted: Schema.Boolean }),
  ),
})
type MerchantCatalogue = typeof MerchantCatalogue.Type

// MODEL

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const MerchantState = defineTaggedUnion({
  Loading: {},
  Loaded: { catalogue: MerchantCatalogue },
  Failed: { error: Schema.String },
})
/** @internal Exported for the scene tests; the page update is its only production caller. */
export const InvoiceState = defineTaggedUnion({
  NoInvoice: {},
  Creating: { itemId: Schema.String },
  Created: { invoice: MerchantInvoice },
  Refused: { error: Schema.String },
})
export const Model = Schema.Struct({ state: MerchantState, invoice: InvoiceState })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadCatalogue: { catalogue: MerchantCatalogue },
  FailedLoadCatalogue: { error: Schema.String },
  ClickedCreateInvoice: { itemId: Schema.String },
  SucceededCreateInvoice: { invoice: MerchantInvoice },
  FailedCreateInvoice: { error: Schema.String },
  ClickedReload: {},
})
export type Message = typeof Message.Type

// COMMAND

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const LoadCatalogue = Command.define('LoadCatalogue', {
  messages: [Message.SucceededLoadCatalogue, Message.FailedLoadCatalogue],
  execute: getJson(`/api/merchants/${MERCHANT_ID}/items`, MerchantCatalogue).pipe(
    Effect.map((catalogue) => Message.SucceededLoadCatalogue({ catalogue })),
    Effect.catch((failure) => Effect.succeed(Message.FailedLoadCatalogue({ error: failure.error }))),
  ),
})

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const CreateInvoice = Command.define('CreateInvoice', {
  args: { itemId: Schema.String },
  messages: [Message.SucceededCreateInvoice, Message.FailedCreateInvoice],
  execute: ({ itemId }) =>
    createInvoice(MERCHANT_ID, itemId).pipe(
      Effect.map((invoice) => Message.SucceededCreateInvoice({ invoice })),
      Effect.catch((failure) => Effect.succeed(Message.FailedCreateInvoice({ error: failure.error }))),
    ),
})

// INIT

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient>

export const init = (): UpdateReturn => ({
  model: { state: MerchantState.Loading(), invoice: InvoiceState.NoInvoice() },
  commands: [LoadCatalogue()],
})

// UPDATE

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadCatalogue: ({ catalogue }) => ({
      model: modifyFields(model, { state: () => MerchantState.Loaded({ catalogue }) }),
    }),
    FailedLoadCatalogue: ({ error }) => ({
      model: modifyFields(model, { state: () => MerchantState.Failed({ error }) }),
    }),
    ClickedCreateInvoice: ({ itemId }) =>
      InvoiceState.guards.Creating(model.invoice)
        ? { model }
        : {
            model: modifyFields(model, { invoice: () => InvoiceState.Creating({ itemId }) }),
            commands: [CreateInvoice({ itemId })],
          },
    SucceededCreateInvoice: ({ invoice }) => ({
      model: modifyFields(model, { invoice: () => InvoiceState.Created({ invoice }) }),
    }),
    FailedCreateInvoice: ({ error }) => ({
      model: modifyFields(model, { invoice: () => InvoiceState.Refused({ error }) }),
    }),
    ClickedReload: () => ({
      model: modifyFields(model, { state: () => MerchantState.Loading() }),
      commands: [LoadCatalogue()],
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
    MerchantState.match(model.state, {
      Loading: () => [h.p([h.Role('status')], [format(locale, 'common.loading', {})])],
      Failed: ({ error }) => [failedView(error, Message.ClickedReload(), locale, h)],
      Loaded: ({ catalogue }) => [
        h.h1([], [format(locale, 'merchant.title', { name: catalogue.name })]),
        h.ul(
          [h.Class('menu')],
          catalogue.items.map((item) => itemRow(item, InvoiceState.guards.Creating(model.invoice), locale, h)),
        ),
        invoiceArea(model, locale, h),
        h.a(
          [h.Href(gateRouter({ merchantId: catalogue.merchantId })), h.Class('primary-action')],
          [format(locale, 'merchant.openGate', {})],
        ),
      ],
    }),
  ),
)
