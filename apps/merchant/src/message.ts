import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { Catalogue, Invoice, Status } from './api.ts'

export const Message = defineMessageUnion({
  SucceededLoadTill: { catalogue: Catalogue, publicKey: Schema.String },
  FailedLoadTill: { reason: Schema.String },
  ClickedItem: { itemId: Schema.String },
  SucceededOpenInvoice: { invoice: Invoice },
  FailedOpenInvoice: { reason: Schema.String },
  ReceivedStatus: { invoiceId: Schema.String, status: Status, trusted: Schema.Boolean },
  FailedReadStatus: { invoiceId: Schema.String },
  ClickedNextCustomer: {},
  ClickedTryAgain: {},
})
export type Message = typeof Message.Type
