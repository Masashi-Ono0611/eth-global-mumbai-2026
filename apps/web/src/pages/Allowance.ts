import { Clock, Effect, Option, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import type * as HttpClient from 'effect/http/HttpClient'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { ActionFailure, actionFailureOf, signWithPasskey } from '../api/OwnerAction.ts'
import { grantOptions, revokeOptions, signGrant, signRevoke } from '../api/Wallet.ts'
import type { Passkeys } from '../Passkey.ts'

/**
 * A robot's allowance (DESIGN.md "Sheets"): the presets the passkey signs as an on-chain grant, and Stop (revoke).
 * A Submodel shared by the robot conversation's sheet and the add-robot flow; it tells its parent when Arc took the
 * grant or the revoke.
 */

// MODEL

/** Presets, in USDC (the Worker takes decimal strings) and hours. Demo defaults (6 Nov): 5.00 a day, 1.00 at most for
 *  one purchase, so the 2.00 thali and the restricted cigarettes ask the owner; an approved one still counts. */
export const DAILY_PRESETS = ['1.00', '5.00', '10.00'] as const
export const PER_PAYMENT_PRESETS = ['0.30', '1.00', '2.00'] as const
export const HOUR_PRESETS = ['1', '24', '168'] as const

export const Step = defineTaggedUnion({ Editing: {}, Signing: {}, Failed: { failure: ActionFailure } })
export const Stop = defineTaggedUnion({ Idle: {}, Signing: {}, Failed: { failure: ActionFailure } })

export const Model = Schema.Struct({
  robotId: Schema.String,
  /** The merchant a new grant allowlists (its receiving address), once the catalogue is known. */
  maybePayTo: Schema.Option(Schema.String),
  daily: Schema.String,
  perPayment: Schema.String,
  hours: Schema.String,
  /** Showing the presets: a robot without an active grant, or the owner chose to change it. */
  editing: Schema.Boolean,
  step: Step,
  stop: Stop,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SelectedDaily: { value: Schema.String },
  SelectedPerPayment: { value: Schema.String },
  SelectedHours: { value: Schema.String },
  ClickedChange: {},
  ClickedCancel: {},
  ClickedConfirm: {},
  SucceededGrant: {},
  FailedGrant: { failure: ActionFailure },
  ClickedStop: { grantId: Schema.String },
  SucceededStop: {},
  FailedStop: { failure: ActionFailure },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ Granted: {}, Stopped: {} })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/**
 * Options (the unsigned grant), the passkey over its EIP-712 digest, then the Worker deploys the account if needed and
 * activates the grant on Arc.
 * @internal Exported for the scene tests; the update is its only production caller.
 */
export const GrantAllowance = Command.define('GrantAllowance', {
  args: {
    robotId: Schema.String,
    dailyCap: Schema.String,
    perPaymentCap: Schema.String,
    allowlist: Schema.Array(Schema.String),
    hours: Schema.Number,
  },
  messages: [Message.SucceededGrant, Message.FailedGrant],
  execute: ({ robotId, dailyCap, perPaymentCap, allowlist, hours }) =>
    Effect.gen(function* () {
      const nowSeconds = Math.floor((yield* Clock.currentTimeMillis) / 1000)
      const prompt = yield* grantOptions({
        robotId,
        dailyCap,
        perPaymentCap,
        allowlist,
        expiresAt: nowSeconds + hours * 3600,
      })
      const assertion = yield* signWithPasskey(prompt)
      yield* signGrant(prompt.grantId, assertion)
      return Message.SucceededGrant()
    }).pipe(Effect.catch((error) => Effect.succeed(Message.FailedGrant({ failure: actionFailureOf(error) })))),
})

/**
 * The passkey signs the one-time revoke delegation; the relayer has Arc disable the grant.
 * @internal Exported for the scene tests; the update is its only production caller.
 */
export const StopAllowance = Command.define('StopAllowance', {
  args: { grantId: Schema.String },
  messages: [Message.SucceededStop, Message.FailedStop],
  execute: ({ grantId }) =>
    Effect.gen(function* () {
      const prompt = yield* revokeOptions(grantId)
      const assertion = yield* signWithPasskey(prompt)
      yield* signRevoke(grantId, assertion)
      return Message.SucceededStop()
    }).pipe(Effect.catch((error) => Effect.succeed(Message.FailedStop({ failure: actionFailureOf(error) })))),
})

// INIT

export const init = (robotId: string, maybePayTo: Option.Option<string>, editing: boolean): Model => ({
  robotId,
  maybePayTo,
  daily: '5.00',
  perPayment: '1.00',
  hours: '24',
  editing,
  step: Step.Editing(),
  stop: Stop.Idle(),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, HttpClient.HttpClient | Passkeys>

const confirm = (model: Model): UpdateReturn =>
  Option.match(model.maybePayTo, {
    onNone: () => ({ model }),
    onSome: (payTo) =>
      Step.guards.Signing(model.step)
        ? { model }
        : {
            model: modifyFields(model, { step: () => Step.Signing() }),
            commands: [
              GrantAllowance({
                robotId: model.robotId,
                dailyCap: model.daily,
                perPaymentCap: model.perPayment,
                allowlist: [payTo],
                hours: Number(model.hours),
              }),
            ],
          },
  })

/** A new robot to give an allowance to: its id and the merchant's address; it starts on the presets. */
export const forRobot =
  (robotId: string, maybePayTo: Option.Option<string>) =>
  (model: Model): UpdateReturn => ({
    model: modifyFields(model, {
      robotId: () => robotId,
      maybePayTo: () => maybePayTo,
      editing: () => true,
      step: () => Step.Editing(),
    }),
  })

/** The parent learned the merchant's address and whether the robot holds an active grant (then it shows the rules). */
export const configure =
  (maybePayTo: Option.Option<string>, hasActiveGrant: boolean) =>
  (model: Model): UpdateReturn => ({
    model: modifyFields(model, { maybePayTo: () => maybePayTo, editing: () => !hasActiveGrant }),
  })

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SelectedDaily: ({ value }) => ({ model: modifyFields(model, { daily: () => value }) }),
    SelectedPerPayment: ({ value }) => ({ model: modifyFields(model, { perPayment: () => value }) }),
    SelectedHours: ({ value }) => ({ model: modifyFields(model, { hours: () => value }) }),
    ClickedChange: () => ({ model: modifyFields(model, { editing: () => true, step: () => Step.Editing() }) }),
    ClickedCancel: () => ({ model: modifyFields(model, { editing: () => false, step: () => Step.Editing() }) }),
    ClickedConfirm: () => confirm(model),
    SucceededGrant: () => ({
      model: modifyFields(model, { editing: () => false, step: () => Step.Editing() }),
      outMessage: OutMessage.Granted(),
    }),
    FailedGrant: ({ failure }) => ({ model: modifyFields(model, { step: () => Step.Failed({ failure }) }) }),
    ClickedStop: ({ grantId }) =>
      Stop.guards.Signing(model.stop)
        ? { model }
        : { model: modifyFields(model, { stop: () => Stop.Signing() }), commands: [StopAllowance({ grantId })] },
    SucceededStop: () => ({
      model: modifyFields(model, { stop: () => Stop.Idle() }),
      outMessage: OutMessage.Stopped(),
    }),
    FailedStop: ({ failure }) => ({ model: modifyFields(model, { stop: () => Stop.Failed({ failure }) }) }),
  })
