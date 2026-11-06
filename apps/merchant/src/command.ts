import { Effect, Schema } from 'effect'
import { Command } from 'foldkit'
import { loadCatalogue, loadGateKey, openInvoice, readStatus } from './api.ts'
import { Message } from './message.ts'

export const LoadTill = Command.define('LoadTill', {
  args: { merchantId: Schema.String },
  messages: [Message.SucceededLoadTill, Message.FailedLoadTill],
  execute: ({ merchantId }) =>
    Effect.all([loadCatalogue(merchantId), loadGateKey(merchantId)], { concurrency: 2 }).pipe(
      Effect.map(([catalogue, publicKey]) => Message.SucceededLoadTill({ catalogue, publicKey })),
      Effect.catch(({ reason }) => Effect.succeed(Message.FailedLoadTill({ reason }))),
    ),
})

export const OpenInvoice = Command.define('OpenInvoice', {
  args: { merchantId: Schema.String, itemId: Schema.String },
  messages: [Message.SucceededOpenInvoice, Message.FailedOpenInvoice],
  execute: ({ merchantId, itemId }) =>
    openInvoice(merchantId, itemId).pipe(
      Effect.map((invoice) => Message.SucceededOpenInvoice({ invoice })),
      Effect.catch(({ reason }) => Effect.succeed(Message.FailedOpenInvoice({ reason }))),
    ),
})

/** One signed status read, `delayMillis` after the previous one. */
export const ReadStatus = Command.define('ReadStatus', {
  args: { invoiceId: Schema.String, publicKey: Schema.String, delayMillis: Schema.Finite },
  messages: [Message.ReceivedStatus, Message.FailedReadStatus],
  execute: ({ invoiceId, publicKey, delayMillis }) =>
    Effect.sleep(delayMillis).pipe(
      Effect.andThen(readStatus(invoiceId, publicKey)),
      Effect.map(({ status, trusted }) => Message.ReceivedStatus({ invoiceId, status, trusted })),
      Effect.orElseSucceed(() => Message.FailedReadStatus({ invoiceId })),
    ),
})
