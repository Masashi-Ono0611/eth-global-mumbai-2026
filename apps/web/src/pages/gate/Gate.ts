import { format, type Locale } from '@ethmumbai/i18n'
import { Effect, Option, Schema } from 'effect'
import { Command, Submodel, type Update } from 'foldkit'
import type * as HttpClient from 'effect/http/HttpClient'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { usdc } from '../../api/Wallet.ts'
import { failedView } from '../Shared.ts'
import { createInvoice, InvoiceStatus, loadGateKey, MerchantInvoice, readSignedStatus } from './GateApi.ts'

// `/gate/:merchantId`, the virtual gate (spec §7): it shows an invoice for the counter's item, reads its status every
// second with a fresh nonce, verifies the merchant's Ed25519 signature itself and opens only on a verified `paid`;
// then it asks for a fresh invoice. The ESP32 gate does the same with Monocypher.

/** The counter sells chai: one invoice at a time. */
const GATE_ITEM = 'chai'
const POLL_MILLIS = 1000
const RETRY_MILLIS = 2000
const OPEN_MILLIS = 5000

// MODEL

const Problem = Schema.Literals(['badSignature', 'offline', 'replacing'])
export const GateState = defineTaggedUnion({
  Starting: {},
  Waiting: { invoice: MerchantInvoice, publicKey: Schema.String, maybeProblem: Schema.Option(Problem) },
  Open: { invoice: MerchantInvoice, publicKey: Schema.String },
  Failed: { error: Schema.String },
})
export type GateState = typeof GateState.Type
export const Model = Schema.Struct({ merchantId: Schema.String, state: GateState })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededStartGate: { invoice: MerchantInvoice, publicKey: Schema.String },
  FailedStartGate: { error: Schema.String },
  ReceivedStatus: { invoiceId: Schema.String, status: InvoiceStatus, verified: Schema.Boolean },
  FailedReadStatus: { invoiceId: Schema.String },
  SucceededNewInvoice: { invoice: MerchantInvoice },
  FailedNewInvoice: { error: Schema.String },
  ClickedRetry: {},
})
export type Message = typeof Message.Type

// COMMAND

const StartGate = Command.define('StartGate', {
  args: { merchantId: Schema.String },
  messages: [Message.SucceededStartGate, Message.FailedStartGate],
  execute: ({ merchantId }) =>
    Effect.all([loadGateKey(merchantId), createInvoice(merchantId, GATE_ITEM)], { concurrency: 2 }).pipe(
      Effect.map(([publicKey, invoice]) => Message.SucceededStartGate({ invoice, publicKey })),
      Effect.catch((failure) => Effect.succeed(Message.FailedStartGate({ error: failure.error }))),
    ),
})

/** One signed status read after `delayMillis`. */
const ReadStatus = Command.define('ReadStatus', {
  args: { invoiceId: Schema.String, publicKey: Schema.String, delayMillis: Schema.Finite },
  messages: [Message.ReceivedStatus, Message.FailedReadStatus],
  execute: ({ invoiceId, publicKey, delayMillis }) =>
    Effect.sleep(delayMillis).pipe(
      Effect.andThen(readSignedStatus(invoiceId, publicKey)),
      Effect.map(({ status, verified }) => Message.ReceivedStatus({ invoiceId, status, verified })),
      Effect.orElseSucceed(() => Message.FailedReadStatus({ invoiceId })),
    ),
})

const NewInvoice = Command.define('NewInvoice', {
  args: { merchantId: Schema.String, delayMillis: Schema.Finite },
  messages: [Message.SucceededNewInvoice, Message.FailedNewInvoice],
  execute: ({ merchantId, delayMillis }) =>
    Effect.sleep(delayMillis).pipe(
      Effect.andThen(createInvoice(merchantId, GATE_ITEM)),
      Effect.map((invoice) => Message.SucceededNewInvoice({ invoice })),
      Effect.catch((failure) => Effect.succeed(Message.FailedNewInvoice({ error: failure.error }))),
    ),
})

// INIT

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient>

export const init = (merchantId: string): UpdateReturn => ({
  model: { merchantId, state: GateState.Starting() },
  commands: [StartGate({ merchantId })],
})

// UPDATE

const read = (invoiceId: string, publicKey: string, delayMillis: number) =>
  ReadStatus({ invoiceId, publicKey, delayMillis })

/** The invoice the gate is waiting on, if the message is about it (late answers for an old invoice are dropped). */
const waitingOn = (model: Model, invoiceId: string) =>
  GateState.guards.Waiting(model.state) && model.state.invoice.id === invoiceId
    ? Option.some(model.state)
    : Option.none()

const withStatus = (model: Model, invoiceId: string, status: InvoiceStatus, verified: boolean): UpdateReturn =>
  Option.match(waitingOn(model, invoiceId), {
    onNone: () => ({ model }),
    onSome: (waiting) => {
      const { invoice, publicKey } = waiting
      const wait = (maybeProblem: Option.Option<typeof Problem.Type>) =>
        modifyFields(model, { state: () => GateState.Waiting({ invoice, publicKey, maybeProblem }) })
      if (!verified)
        return { model: wait(Option.some('badSignature')), commands: [read(invoiceId, publicKey, POLL_MILLIS)] }
      if (status === 'paid')
        return {
          model: modifyFields(model, { state: () => GateState.Open({ invoice, publicKey }) }),
          commands: [NewInvoice({ merchantId: model.merchantId, delayMillis: OPEN_MILLIS })],
        }
      if (status === 'pending')
        return { model: wait(Option.none()), commands: [read(invoiceId, publicKey, POLL_MILLIS)] }
      return {
        model: wait(Option.some('replacing')),
        commands: [NewInvoice({ merchantId: model.merchantId, delayMillis: 0 })],
      }
    },
  })

const publicKeyOf = (state: GateState) =>
  GateState.guards.Waiting(state) || GateState.guards.Open(state) ? Option.some(state.publicKey) : Option.none()

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededStartGate: ({ invoice, publicKey }) => ({
      model: modifyFields(model, {
        state: () => GateState.Waiting({ invoice, publicKey, maybeProblem: Option.none() }),
      }),
      commands: [read(invoice.id, publicKey, 0)],
    }),
    FailedStartGate: ({ error }) => ({ model: modifyFields(model, { state: () => GateState.Failed({ error }) }) }),
    ReceivedStatus: ({ invoiceId, status, verified }) => withStatus(model, invoiceId, status, verified),
    FailedReadStatus: ({ invoiceId }) =>
      Option.match(waitingOn(model, invoiceId), {
        onNone: () => ({ model }),
        onSome: (waiting) => ({
          model: modifyFields(model, {
            state: () => GateState.Waiting({ ...waiting, maybeProblem: Option.some('offline') }),
          }),
          commands: [read(invoiceId, waiting.publicKey, RETRY_MILLIS)],
        }),
      }),
    SucceededNewInvoice: ({ invoice }) =>
      Option.match(publicKeyOf(model.state), {
        onNone: () => ({ model }),
        onSome: (publicKey) => ({
          model: modifyFields(model, {
            state: () => GateState.Waiting({ invoice, publicKey, maybeProblem: Option.none() }),
          }),
          commands: [read(invoice.id, publicKey, 0)],
        }),
      }),
    FailedNewInvoice: () => ({
      model,
      commands: [NewInvoice({ merchantId: model.merchantId, delayMillis: RETRY_MILLIS })],
    }),
    ClickedRetry: () => ({
      model: modifyFields(model, { state: () => GateState.Starting() }),
      commands: [StartGate({ merchantId: model.merchantId })],
    }),
  })

// VIEW

const problemText = (problem: typeof Problem.Type, locale: Locale) =>
  format(
    locale,
    problem === 'badSignature' ? 'gate.badSignature' : problem === 'offline' ? 'gate.offline' : 'gate.newInvoice',
    {},
  )

const invoiceView = (invoice: MerchantInvoice, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.dl(
    [h.Class('gate-invoice')],
    [
      h.dt([], [format(locale, 'gate.invoice', {})]),
      h.dd([h.Class('invoice-id')], [invoice.id]),
      h.dt([], [format(locale, 'gate.payLink', {})]),
      h.dd([h.Class('invoice-url')], [invoice.url]),
      h.dt([], [format(locale, 'gate.price', {})]),
      h.dd([], [`${usdc(invoice.amount)} USDC`]),
    ],
  )

const light = (open: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.p(
    [h.Class(open ? 'gate-light gate-open' : 'gate-light gate-closed'), h.Role('status'), h.AriaLive('polite')],
    [format(locale, open ? 'gate.open' : 'gate.closed', {})],
  )

/** `/gate/:merchantId`: CLOSED with the invoice to pay, OPEN on a verified `paid`. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), h.Class('gate-page')],
    [
      h.h1([], [format(locale, 'gate.title', {})]),
      GateState.match(model.state, {
        Starting: () =>
          h.div([], [light(false, locale, h), h.p([h.Class('hint')], [format(locale, 'common.loading', {})])]),
        Waiting: ({ invoice, maybeProblem }) =>
          h.div(
            [],
            [
              light(false, locale, h),
              h.p([], [format(locale, 'gate.payToOpen', {})]),
              invoiceView(invoice, locale, h),
              h.p([h.Class('hint')], [format(locale, 'gate.restrictedNote', {})]),
              Option.match(maybeProblem, {
                onNone: () => h.p([h.Class('hint')], [format(locale, 'gate.waiting', {})]),
                onSome: (problem) => h.p([h.Role('alert')], [problemText(problem, locale)]),
              }),
            ],
          ),
        Open: ({ invoice }) =>
          h.div(
            [],
            [light(true, locale, h), h.p([], [format(locale, 'gate.verified', {})]), invoiceView(invoice, locale, h)],
          ),
        Failed: ({ error }) =>
          h.div([], [light(false, locale, h), failedView(error, Message.ClickedRetry(), locale, h)]),
      }),
    ],
  ),
)
