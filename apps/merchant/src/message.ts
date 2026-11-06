import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { Catalogue, CounterInvoice } from './api.ts'

export const Message = defineMessageUnion({
  SucceededLoadTill: { catalogue: Catalogue },
  FailedLoadTill: { reason: Schema.String },
  ClickedItem: { itemId: Schema.String },
  SucceededPlaceOnCounter: { invoice: CounterInvoice, placedAt: Schema.Finite },
  FailedPlaceOnCounter: { itemId: Schema.String, reason: Schema.String },
  SucceededReadCounter: { maybeInvoice: Schema.Option(CounterInvoice), askedAt: Schema.Finite },
  FailedReadCounter: {},
  Ticked: {},
  ClickedTryAgain: {},
})
export type Message = typeof Message.Type
