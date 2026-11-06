import { Effect, Schema } from 'effect'
import { Command } from 'foldkit'
import { Item, loadCatalogue, placeOnCounter, readCounter } from './api.ts'
import { Message } from './message.ts'

export const LoadTill = Command.define('LoadTill', {
  args: { merchantId: Schema.String },
  messages: [Message.SucceededLoadTill, Message.FailedLoadTill],
  execute: ({ merchantId }) =>
    loadCatalogue(merchantId).pipe(
      Effect.map((catalogue) => Message.SucceededLoadTill({ catalogue })),
      Effect.catch(({ reason }) => Effect.succeed(Message.FailedLoadTill({ reason }))),
    ),
})

export const PlaceOnCounter = Command.define('PlaceOnCounter', {
  args: { merchantId: Schema.String, item: Item },
  messages: [Message.SucceededPlaceOnCounter, Message.FailedPlaceOnCounter],
  execute: ({ merchantId, item }) =>
    placeOnCounter(merchantId, item).pipe(
      Effect.map(({ invoice, placedAt }) => Message.SucceededPlaceOnCounter({ invoice, placedAt })),
      Effect.catch(({ reason }) => Effect.succeed(Message.FailedPlaceOnCounter({ itemId: item.itemId, reason }))),
    ),
})

/** One read of what the counter screen shows. Keyed: a read stays in flight while taps and ticks arrive. */
export const ReadCounter = Command.define('ReadCounter', {
  args: { merchantId: Schema.String },
  messages: [Message.SucceededReadCounter, Message.FailedReadCounter],
  interrupt: true,
  execute: ({ merchantId }) =>
    readCounter(merchantId).pipe(
      Effect.map(({ maybeInvoice, askedAt }) => Message.SucceededReadCounter({ maybeInvoice, askedAt })),
      Effect.orElseSucceed(() => Message.FailedReadCounter()),
    ),
})
