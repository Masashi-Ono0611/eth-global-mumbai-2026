import { Effect, Option, Schema } from 'effect'
import type * as HttpClient from 'effect/http/HttpClient'
import { Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { isSignedOut } from '../api/Http.ts'
import { loadWallet } from '../api/Wallet.ts'
import { Clipboard } from '../Clipboard.ts'
import { Copy } from '../Receive.ts'
import * as Telegram from '../Telegram.ts'

/**
 * `/welcome`: the first minutes after the passkey wallet is created, one step at a time. Where the robot reaches the
 * owner (Telegram, skippable), money in (the wallet's QR; it moves on by itself once USDC arrives), then the robot
 * (Add robot, which continues into the allowance and the robot's conversation).
 */

// MODEL

export const Step = defineTaggedUnion({ Telegram: {}, Fund: {}, Robot: {} })
export type Step = typeof Step.Type

export const Funds = defineTaggedUnion({
  Loading: {},
  SignedOut: {},
  /** `balanceUnits` is null while Arc does not answer. */
  Loaded: { address: Schema.String, balanceUnits: Schema.NullOr(Schema.String) },
  Failed: { error: Schema.String },
})
export type Funds = typeof Funds.Type

export const Model = Schema.Struct({ step: Step, funds: Funds, telegram: Telegram.Model, copy: Copy })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadFunds: { address: Schema.String, balanceUnits: Schema.NullOr(Schema.String) },
  FailedLoadFunds: { error: Schema.String, signedOut: Schema.Boolean },
  ClickedRetry: {},
  GotTelegramMessage: { message: Telegram.Message },
  ClickedSkipTelegram: {},
  ClickedSkipFunding: {},
  ClickedCopyAddress: { address: Schema.String },
  CompletedCopyAddress: { copied: Schema.Boolean },
})
export type Message = typeof Message.Type

// COMMAND

/** While the wallet is empty the page re-reads its balance on this period. @internal Exported for the scene tests. */
export const POLL_MILLIS = 3000

/** The wallet's address and balance. @internal Exported for the scene tests. */
export const LoadFunds = Command.define('LoadFunds', {
  args: { delayMillis: Schema.Number },
  messages: [Message.SucceededLoadFunds, Message.FailedLoadFunds],
  execute: ({ delayMillis }) =>
    Effect.sleep(delayMillis).pipe(
      Effect.andThen(loadWallet),
      Effect.map(({ account, balance }) =>
        Message.SucceededLoadFunds({ address: account.smartAccount, balanceUnits: balance?.units ?? null }),
      ),
      Effect.catch((failure) =>
        Effect.succeed(Message.FailedLoadFunds({ error: failure.error, signedOut: isSignedOut(failure) })),
      ),
    ),
})

/** Copy the wallet's address (the same as the wallet's Receive sheet). */
const CopyWelcomeAddress = Command.define('CopyWelcomeAddress', {
  args: { address: Schema.String },
  messages: [Message.CompletedCopyAddress],
  execute: ({ address }) =>
    Effect.flatMap(Clipboard, (clipboard) => clipboard.copy(address)).pipe(
      Effect.as(Message.CompletedCopyAddress({ copied: true })),
      Effect.catch(() => Effect.succeed(Message.CompletedCopyAddress({ copied: false }))),
    ),
})

// INIT

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient | Clipboard>

const telegramChild = {
  read: (parent: Model) => Option.some(parent.telegram),
  write: (parent: Model, next: Telegram.Model) => modifyFields(parent, { telegram: () => next }),
  toParentMessage: (message: Telegram.Message) => Message.GotTelegramMessage({ message }),
}

export const init = (): UpdateReturn => {
  const base: Model = { step: Step.Telegram(), funds: Funds.Loading(), telegram: Telegram.init(), copy: Copy.Idle() }
  const telegram = Update.foldChildStep({ update: Telegram.opened, ...telegramChild })(base)
  return { model: telegram.model, commands: [LoadFunds({ delayMillis: 0 }), ...(telegram.commands ?? [])] }
}

// UPDATE

const hasMoney = (funds: Funds) =>
  Funds.guards.Loaded(funds) && funds.balanceUnits !== null && BigInt(funds.balanceUnits) > 0n

/** The step after Telegram: money in, unless the wallet already holds some. */
const afterTelegram = (model: Model): Step => (hasMoney(model.funds) ? Step.Robot() : Step.Fund())

/** Telegram is done when the chat is linked, or there is no bot to link. */
const telegramDone = (telegram: Telegram.Model) => Telegram.isLinked(telegram) || Telegram.isOff(telegram)

const foldTelegram = Update.foldChild({ update: Telegram.update, ...telegramChild })

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadFunds: ({ address, balanceUnits }) => {
      const funds = Funds.Loaded({ address, balanceUnits })
      const next = modifyFields(model, {
        funds: () => funds,
        step: (step) => (Step.guards.Fund(step) && hasMoney(funds) ? Step.Robot() : step),
      })
      // Watch the balance until money is in (or the owner went on to the robot).
      const watching = !hasMoney(funds) && !Step.guards.Robot(next.step)
      return { model: next, commands: watching ? [LoadFunds({ delayMillis: POLL_MILLIS })] : [] }
    },
    FailedLoadFunds: ({ error, signedOut }) => ({
      model: modifyFields(model, { funds: () => (signedOut ? Funds.SignedOut() : Funds.Failed({ error })) }),
    }),
    ClickedRetry: () => ({
      model: modifyFields(model, { funds: () => Funds.Loading() }),
      commands: [LoadFunds({ delayMillis: 0 })],
    }),
    GotTelegramMessage: ({ message: telegramMessage }) => {
      const folded = foldTelegram(model, telegramMessage)
      if (!Step.guards.Telegram(folded.model.step) || !telegramDone(folded.model.telegram)) return folded
      return { ...folded, model: modifyFields(folded.model, { step: () => afterTelegram(folded.model) }) }
    },
    ClickedSkipTelegram: () => ({ model: modifyFields(model, { step: () => afterTelegram(model) }) }),
    ClickedSkipFunding: () => ({ model: modifyFields(model, { step: () => Step.Robot() }) }),
    ClickedCopyAddress: ({ address }) => ({ model, commands: [CopyWelcomeAddress({ address })] }),
    CompletedCopyAddress: ({ copied }) => ({
      model: modifyFields(model, { copy: () => (copied ? Copy.Copied() : Copy.Failed()) }),
    }),
  })
