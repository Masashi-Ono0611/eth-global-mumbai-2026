import { Option } from 'effect'
import type * as HttpClient from 'effect/http/HttpClient'
import type { Update } from 'foldkit'
import type { Invoice, Item, Status } from './api.ts'
import { LoadTill, OpenInvoice, ReadStatus } from './command.ts'
import { Message } from './message.ts'
import { type Hitch, MERCHANT_ID, type Model, POLL_MILLIS, Sale, Till } from './model.ts'

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient>
type Ready = Extract<Model['till'], { _tag: 'Ready' }>

export const init = (): UpdateReturn => ({
  model: { till: Till.Loading() },
  commands: [LoadTill({ merchantId: MERCHANT_ID })],
})

const withSale = (ready: Ready, sale: Sale): Model => ({ till: Till.Ready({ ...ready, sale }) })

const whenReady = (model: Model, next: (ready: Ready) => UpdateReturn): UpdateReturn =>
  Till.guards.Ready(model.till) ? next(model.till) : { model }

/** The sale waiting on this invoice, if any: answers about an invoice no longer on screen are dropped. */
const waitingOn = (ready: Ready, invoiceId: string) =>
  Sale.guards.Waiting(ready.sale) && ready.sale.invoice.id === invoiceId ? Option.some(ready.sale) : Option.none()

const pollAgain = (ready: Ready, item: Item, invoice: Invoice, hitch: Option.Option<Hitch>): UpdateReturn => ({
  model: withSale(ready, Sale.Waiting({ item, invoice, hitch })),
  commands: [ReadStatus({ invoiceId: invoice.id, publicKey: ready.publicKey, delayMillis: POLL_MILLIS })],
})

/**
 * A verified `paid` or `used` is paid: only the first reader ever sees `paid` (the robot's gate may read first). An
 * unverified answer never changes the sale; the till keeps asking and says why.
 */
const afterStatus = (ready: Ready, invoiceId: string, status: Status, trusted: boolean): UpdateReturn =>
  Option.match(waitingOn(ready, invoiceId), {
    onNone: () => ({ model: { till: ready } }),
    onSome: ({ item, invoice }) => {
      if (!trusted) return pollAgain(ready, item, invoice, Option.some('unverified'))
      if (status === 'paid' || status === 'used') return { model: withSale(ready, Sale.Paid({ item, invoice })) }
      if (status === 'expired') return { model: withSale(ready, Sale.Expired({ item, invoice })) }
      return pollAgain(ready, item, invoice, Option.none())
    },
  })

const openFor = (ready: Ready, item: Item): UpdateReturn => ({
  model: withSale(ready, Sale.Opening({ item })),
  commands: [OpenInvoice({ merchantId: ready.catalogue.merchantId, itemId: item.itemId })],
})

/** The item the current sale is for, to open a fresh invoice for it. */
const saleItem = (sale: Sale) => (Sale.guards.Choosing(sale) ? Option.none() : Option.some(sale.item))

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadTill: ({ catalogue, publicKey }) => ({
      model: { till: Till.Ready({ catalogue, publicKey, sale: Sale.Choosing() }) },
    }),
    FailedLoadTill: ({ reason }) => ({ model: { till: Till.Broken({ reason }) } }),
    ClickedItem: ({ itemId }) =>
      whenReady(model, (ready) => {
        const item = ready.catalogue.items.find((candidate) => candidate.itemId === itemId)
        return item === undefined || !Sale.guards.Choosing(ready.sale) ? { model } : openFor(ready, item)
      }),
    SucceededOpenInvoice: ({ invoice }) =>
      whenReady(model, (ready) =>
        Sale.guards.Opening(ready.sale) ? pollAgain(ready, ready.sale.item, invoice, Option.none()) : { model },
      ),
    FailedOpenInvoice: ({ reason }) =>
      whenReady(model, (ready) =>
        Sale.guards.Opening(ready.sale)
          ? { model: withSale(ready, Sale.Refused({ item: ready.sale.item, reason })) }
          : { model },
      ),
    ReceivedStatus: ({ invoiceId, status, trusted }) =>
      whenReady(model, (ready) => afterStatus(ready, invoiceId, status, trusted)),
    FailedReadStatus: ({ invoiceId }) =>
      whenReady(model, (ready) =>
        Option.match(waitingOn(ready, invoiceId), {
          onNone: () => ({ model }),
          onSome: ({ item, invoice }) => pollAgain(ready, item, invoice, Option.some('offline')),
        }),
      ),
    ClickedNextCustomer: () => whenReady(model, (ready) => ({ model: withSale(ready, Sale.Choosing()) })),
    ClickedTryAgain: () =>
      Till.guards.Broken(model.till)
        ? { model: { till: Till.Loading() }, commands: [LoadTill({ merchantId: MERCHANT_ID })] }
        : whenReady(model, (ready) =>
            Option.match(saleItem(ready.sale), {
              onNone: () => ({ model }),
              onSome: (item) => openFor(ready, item),
            }),
          ),
  })
