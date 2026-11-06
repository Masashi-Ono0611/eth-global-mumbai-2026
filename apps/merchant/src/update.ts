import { Array, Duration, Effect, Option, Schema, Stream } from 'effect'
import type * as HttpClient from 'effect/http/HttpClient'
import { Subscription, type Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import type { CounterInvoice, Item } from './api.ts'
import { LoadTill, PlaceOnCounter, ReadCounter } from './command.ts'
import { Message } from './message.ts'
import { type Link, MERCHANT_ID, type Model, POLL_MILLIS, type Read, Screen, Tap, Till } from './model.ts'

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient>
type Ready = Extract<Till, { _tag: 'Ready' }>

export const init = (): UpdateReturn => ({
  model: { till: Till.Loading() },
  commands: [LoadTill({ merchantId: MERCHANT_ID })],
})

const whenReady = (model: Model, next: (ready: Ready) => UpdateReturn): UpdateReturn =>
  Till.guards.Ready(model.till) ? next(model.till) : { model }

const shownSince = (screen: Screen) => (Screen.guards.Reading(screen) ? Option.none() : Option.some(screen.readAt))

/** A read that began before what the till shows (a later read, or the tap's own invoice) is older news. */
const isNewer = (screen: Screen, askedAt: number) =>
  Option.match(shownSince(screen), { onNone: () => true, onSome: (readAt) => askedAt >= readAt })

const afterRead = (ready: Ready, maybeInvoice: Option.Option<CounterInvoice>, askedAt: number): Model => ({
  till: modifyFields(ready, {
    read: (): Read => 'idle',
    link: (): Link => 'answering',
    screen: (screen) =>
      isNewer(screen, askedAt)
        ? Option.match(maybeInvoice, {
            onNone: () => Screen.Blank({ readAt: askedAt }),
            onSome: (invoice) => Screen.Showing({ invoice, readAt: askedAt }),
          })
        : screen,
  }),
})

/** One read at a time: a tick while the previous read is still out changes nothing. */
const readNow = (ready: Ready): UpdateReturn =>
  ready.read === 'asking'
    ? { model: { till: ready } }
    : {
        model: { till: modifyFields(ready, { read: (): Read => 'asking' }) },
        commands: [ReadCounter({ merchantId: ready.catalogue.merchantId })],
      }

/** One tap at a time: while an item is going up, further taps change nothing. */
const place = (ready: Ready, item: Item): UpdateReturn =>
  Tap.guards.Placing(ready.tap)
    ? { model: { till: ready } }
    : {
        model: { till: modifyFields(ready, { tap: () => Tap.Placing({ itemId: item.itemId }) }) },
        commands: [PlaceOnCounter({ merchantId: ready.catalogue.merchantId, item })],
      }

const loaded = (catalogue: Ready['catalogue']): UpdateReturn =>
  readNow(Till.Ready({ catalogue, screen: Screen.Reading(), tap: Tap.Idle(), read: 'idle', link: 'answering' }))

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadTill: ({ catalogue }) => loaded(catalogue),
    FailedLoadTill: ({ reason }) => ({ model: { till: Till.Broken({ reason }) } }),
    ClickedItem: ({ itemId }) =>
      whenReady(model, (ready) =>
        Option.match(
          Array.findFirst(ready.catalogue.items, (item) => item.itemId === itemId),
          { onNone: () => ({ model }), onSome: (item) => place(ready, item) },
        ),
      ),
    SucceededPlaceOnCounter: ({ invoice, placedAt }) =>
      whenReady(model, (ready) => ({
        model: {
          till: modifyFields(ready, {
            tap: () => Tap.Idle(),
            screen: () => Screen.Showing({ invoice, readAt: placedAt }),
          }),
        },
      })),
    FailedPlaceOnCounter: ({ itemId, reason }) =>
      whenReady(model, (ready) => ({
        model: { till: modifyFields(ready, { tap: () => Tap.Refused({ itemId, reason }) }) },
      })),
    SucceededReadCounter: ({ maybeInvoice, askedAt }) =>
      whenReady(model, (ready) => ({ model: afterRead(ready, maybeInvoice, askedAt) })),
    FailedReadCounter: () =>
      whenReady(model, (ready) => ({
        model: { till: modifyFields(ready, { read: (): Read => 'idle', link: (): Link => 'silent' }) },
      })),
    Ticked: () => whenReady(model, readNow),
    ClickedTryAgain: () =>
      Till.guards.Broken(model.till)
        ? { model: { till: Till.Loading() }, commands: [LoadTill({ merchantId: MERCHANT_ID })] }
        : { model },
  })

/** Every 2 s while the till is open, read the counter screen again (the first read starts when it opens). */
export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  poll: entry(
    { open: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ open: Till.guards.Ready(model.till) }),
      dependenciesToStream: ({ open }) =>
        Stream.when(
          Stream.tick(Duration.millis(POLL_MILLIS)).pipe(
            Stream.drop(1),
            Stream.map(() => Message.Ticked()),
          ),
          Effect.sync(() => open),
        ),
    },
  ),
}))
