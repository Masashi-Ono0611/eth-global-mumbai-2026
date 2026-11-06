import { Clock, Effect, Option, Schema, String } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { isSignedOut } from '../api/Http.ts'
import { ActionFailure, actionFailureOf, signWithPasskey } from '../api/OwnerAction.ts'
import {
  AddedRobot,
  addRobot,
  grantOptions,
  listRobots,
  loadCatalogue,
  revokeOptions,
  RobotView,
  signGrant,
  signRevoke,
} from '../api/Wallet.ts'
import type { Passkeys } from '../Passkey.ts'
import type * as HttpClient from 'effect/http/HttpClient'

// MODEL

export const RobotsState = defineTaggedUnion({
  Loading: {},
  SignedOut: {},
  Loaded: { robots: Schema.Array(RobotView) },
  Failed: { error: Schema.String },
})
export const Adding = defineTaggedUnion({
  Idle: {},
  Adding: {},
  Added: { robot: AddedRobot },
  Failed: { error: Schema.String },
})
export const GrantStep = defineTaggedUnion({ Editing: {}, Signing: {}, Failed: { failure: ActionFailure } })
export const GrantForm = Schema.Struct({
  robotId: Schema.String,
  dailyCap: Schema.String,
  perPaymentCap: Schema.String,
  allowlist: Schema.String,
  hours: Schema.String,
  step: GrantStep,
})
export type GrantForm = typeof GrantForm.Type
export const Revoking = defineTaggedUnion({
  Idle: {},
  Signing: { grantId: Schema.String },
  Failed: { grantId: Schema.String, failure: ActionFailure },
})
/** The demo merchant whose receiving address a new grant allowlists by default. */
const Merchant = Schema.Struct({ name: Schema.String, payTo: Schema.String })
export type Merchant = typeof Merchant.Type
export const Model = Schema.Struct({
  robots: RobotsState,
  newRobotName: Schema.String,
  adding: Adding,
  maybeGrantForm: Schema.Option(GrantForm),
  revoking: Revoking,
  maybeMerchant: Schema.Option(Merchant),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadRobots: { robots: Schema.Array(RobotView), maybeMerchant: Schema.Option(Merchant) },
  FailedLoadRobots: { error: Schema.String, signedOut: Schema.Boolean },
  ClickedReload: {},
  UpdatedRobotName: { value: Schema.String },
  SubmittedRobot: {},
  SucceededAddRobot: { robot: AddedRobot },
  FailedAddRobot: { error: Schema.String },
  ClickedGrantBudget: { robotId: Schema.String },
  UpdatedDailyCap: { value: Schema.String },
  UpdatedPerPaymentCap: { value: Schema.String },
  UpdatedAllowlist: { value: Schema.String },
  UpdatedHours: { value: Schema.String },
  ClickedCancelGrant: {},
  SubmittedGrant: {},
  SucceededGrantBudget: {},
  FailedGrantBudget: { failure: ActionFailure },
  ClickedRevoke: { grantId: Schema.String },
  SucceededRevokeGrant: {},
  FailedRevokeGrant: { failure: ActionFailure },
})
export type Message = typeof Message.Type

// COMMAND

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const LoadRobots = Command.define('LoadRobots', {
  messages: [Message.SucceededLoadRobots, Message.FailedLoadRobots],
  execute: Effect.gen(function* () {
    const { robots } = yield* listRobots
    const catalogue = yield* Effect.option(loadCatalogue)
    const maybeMerchant = Option.flatMap(catalogue, ({ name, payTo }) =>
      Option.map(Option.fromNullishOr(payTo), (address) => ({ name, payTo: address })),
    )
    return Message.SucceededLoadRobots({ robots, maybeMerchant })
  }).pipe(
    Effect.catch((failure) =>
      Effect.succeed(Message.FailedLoadRobots({ error: failure.error, signedOut: isSignedOut(failure) })),
    ),
  ),
})

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const AddRobot = Command.define('AddRobot', {
  args: { name: Schema.String },
  messages: [Message.SucceededAddRobot, Message.FailedAddRobot],
  execute: ({ name }) =>
    addRobot(name).pipe(
      Effect.map((robot) => Message.SucceededAddRobot({ robot })),
      Effect.catch((failure) => Effect.succeed(Message.FailedAddRobot({ error: failure.error }))),
    ),
})

/**
 * Options (the unsigned grant), the passkey over its digest, then the Worker deploys/activates it on Arc.
 * @internal Exported for the scene tests; the page update is its only production caller.
 */
export const GrantBudget = Command.define('GrantBudget', {
  args: {
    robotId: Schema.String,
    dailyCap: Schema.String,
    perPaymentCap: Schema.String,
    allowlist: Schema.Array(Schema.String),
    hours: Schema.Number,
  },
  messages: [Message.SucceededGrantBudget, Message.FailedGrantBudget],
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
      return Message.SucceededGrantBudget()
    }).pipe(Effect.catch((error) => Effect.succeed(Message.FailedGrantBudget({ failure: actionFailureOf(error) })))),
})

/**
 * The passkey signs the one-time revoke delegation; the relayer has Arc disable the grant.
 * @internal Exported for the scene tests; the page update is its only production caller.
 */
export const RevokeGrant = Command.define('RevokeGrant', {
  args: { grantId: Schema.String },
  messages: [Message.SucceededRevokeGrant, Message.FailedRevokeGrant],
  execute: ({ grantId }) =>
    Effect.gen(function* () {
      const prompt = yield* revokeOptions(grantId)
      const assertion = yield* signWithPasskey(prompt)
      yield* signRevoke(grantId, assertion)
      return Message.SucceededRevokeGrant()
    }).pipe(Effect.catch((error) => Effect.succeed(Message.FailedRevokeGrant({ failure: actionFailureOf(error) })))),
})

type Services = HttpClient.HttpClient | Passkeys

// INIT

type UpdateReturn = Update.Return<Model, Message, Services>

export const init = (): UpdateReturn => ({
  model: {
    robots: RobotsState.Loading(),
    newRobotName: '',
    adding: Adding.Idle(),
    maybeGrantForm: Option.none(),
    revoking: Revoking.Idle(),
    maybeMerchant: Option.none(),
  },
  commands: [LoadRobots()],
})

// UPDATE

const openGrantForm = (model: Model, robotId: string): GrantForm => ({
  robotId,
  dailyCap: '1.00',
  perPaymentCap: '0.30',
  allowlist: Option.match(model.maybeMerchant, { onNone: () => '', onSome: ({ payTo }) => payTo }),
  hours: '24',
  step: GrantStep.Editing(),
})

export const addresses = (text: string) => text.split(/[\s,]+/).filter(String.isNonEmpty)

const submitGrant = (model: Model): UpdateReturn =>
  Option.match(model.maybeGrantForm, {
    onNone: () => ({ model }),
    onSome: (form) => {
      const hours = Number(form.hours)
      if (GrantStep.guards.Signing(form.step) || !Number.isInteger(hours) || hours < 1 || hours > 720) {
        return { model }
      }
      return {
        model: modifyFields(model, {
          maybeGrantForm: () => Option.some(modifyFields(form, { step: () => GrantStep.Signing() })),
        }),
        commands: [
          GrantBudget({
            robotId: form.robotId,
            dailyCap: String.trim(form.dailyCap),
            perPaymentCap: String.trim(form.perPaymentCap),
            allowlist: addresses(form.allowlist),
            hours,
          }),
        ],
      }
    },
  })

const updateGrantForm = (model: Model, change: (form: GrantForm) => GrantForm): UpdateReturn => ({
  model: modifyFields(model, { maybeGrantForm: Option.map(change) }),
})

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadRobots: ({ robots, maybeMerchant }) => ({
      model: modifyFields(model, { robots: () => RobotsState.Loaded({ robots }), maybeMerchant: () => maybeMerchant }),
    }),
    FailedLoadRobots: ({ error, signedOut }) => ({
      model: modifyFields(model, {
        robots: () => (signedOut ? RobotsState.SignedOut() : RobotsState.Failed({ error })),
      }),
    }),
    ClickedReload: () => ({ model, commands: [LoadRobots()] }),
    UpdatedRobotName: ({ value }) => ({ model: modifyFields(model, { newRobotName: () => value }) }),
    SubmittedRobot: () => {
      const name = String.trim(model.newRobotName)
      if (String.isEmpty(name) || Adding.guards.Adding(model.adding)) {
        return { model }
      }
      return { model: modifyFields(model, { adding: () => Adding.Adding() }), commands: [AddRobot({ name })] }
    },
    SucceededAddRobot: ({ robot }) => ({
      model: modifyFields(model, { adding: () => Adding.Added({ robot }), newRobotName: () => '' }),
      commands: [LoadRobots()],
    }),
    FailedAddRobot: ({ error }) => ({ model: modifyFields(model, { adding: () => Adding.Failed({ error }) }) }),
    ClickedGrantBudget: ({ robotId }) => ({
      model: modifyFields(model, { maybeGrantForm: () => Option.some(openGrantForm(model, robotId)) }),
    }),
    UpdatedDailyCap: ({ value }) => updateGrantForm(model, (form) => modifyFields(form, { dailyCap: () => value })),
    UpdatedPerPaymentCap: ({ value }) =>
      updateGrantForm(model, (form) => modifyFields(form, { perPaymentCap: () => value })),
    UpdatedAllowlist: ({ value }) => updateGrantForm(model, (form) => modifyFields(form, { allowlist: () => value })),
    UpdatedHours: ({ value }) => updateGrantForm(model, (form) => modifyFields(form, { hours: () => value })),
    ClickedCancelGrant: () => ({ model: modifyFields(model, { maybeGrantForm: () => Option.none() }) }),
    SubmittedGrant: () => submitGrant(model),
    SucceededGrantBudget: () => ({
      model: modifyFields(model, { maybeGrantForm: () => Option.none() }),
      commands: [LoadRobots()],
    }),
    FailedGrantBudget: ({ failure }) =>
      updateGrantForm(model, (form) => modifyFields(form, { step: () => GrantStep.Failed({ failure }) })),
    ClickedRevoke: ({ grantId }) =>
      Revoking.guards.Signing(model.revoking)
        ? { model }
        : {
            model: modifyFields(model, { revoking: () => Revoking.Signing({ grantId }) }),
            commands: [RevokeGrant({ grantId })],
          },
    SucceededRevokeGrant: () => ({
      model: modifyFields(model, { revoking: () => Revoking.Idle() }),
      commands: [LoadRobots()],
    }),
    FailedRevokeGrant: ({ failure }) => ({
      model: modifyFields(model, {
        revoking: (revoking) =>
          Revoking.guards.Signing(revoking) ? Revoking.Failed({ grantId: revoking.grantId, failure }) : revoking,
      }),
    }),
  })
