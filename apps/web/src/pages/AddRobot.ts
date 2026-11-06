import { Clock, Effect, Option, Schema, String } from 'effect'
import { Command, Update } from 'foldkit'
import type * as HttpClient from 'effect/http/HttpClient'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import * as Navigation from 'foldkit/navigation'
import { modifyFields } from 'foldkit/struct'
import { RobotKind } from '@ethmumbai/protocol/Intent'
import { isSignedOut } from '../api/Http.ts'
import { AddedRobot, addRobot, cancelPairing, listRobots, loadCatalogue } from '../api/Wallet.ts'
import type { Passkeys } from '../Passkey.ts'
import * as Allowance from './Allowance.ts'
import { robotConsoleRouter } from '../route.ts'

/**
 * `/wallet/robots`: adding a robot as a short conversation (DESIGN.md): its name, the pairing code the chip takes,
 * "connected" once the chip pairs, then its allowance, signed with the passkey. A robot that is still waiting for its
 * chip is picked up again on load.
 */

// MODEL

export const Stage = defineTaggedUnion({
  Loading: {},
  SignedOut: {},
  Naming: {},
  Adding: {},
  Pairing: { robot: AddedRobot },
  Expired: { robot: AddedRobot },
  Connected: { robotId: Schema.String, name: Schema.String },
  Failed: { error: Schema.String },
})
export const Model = Schema.Struct({
  stage: Stage,
  name: Schema.String,
  /** A real robot's chip (`./vitaquack-chip`) or a simulator duck in the browser (`/sim/`). */
  kind: RobotKind,
  /** The merchant a new grant allowlists, by name. */
  merchantName: Schema.String,
  allowance: Allowance.Model,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoad: {
    merchantName: Schema.String,
    maybePayTo: Schema.Option(Schema.String),
    maybeWaiting: Schema.Option(AddedRobot),
  },
  FailedLoad: { error: Schema.String, signedOut: Schema.Boolean },
  UpdatedName: { value: Schema.String },
  SelectedKind: { kind: RobotKind },
  SubmittedName: {},
  SucceededAddRobot: { robot: AddedRobot },
  FailedAddRobot: { error: Schema.String },
  SucceededWatch: { robotId: Schema.String, paired: Schema.Boolean, nowMillis: Schema.Number },
  FailedWatch: { robotId: Schema.String },
  ClickedStartOver: {},
  ClickedCancelPairing: {},
  CompletedCancelPairing: {},
  GotAllowanceMessage: { message: Allowance.Message },
  CompletedOpenRobot: {},
})
export type Message = typeof Message.Type

// COMMAND

/** While a robot waits for its chip, the page re-reads on this period (the pairing code lives 10 minutes). */
const WATCH_MILLIS = 3000

/** The merchant (its name and receiving address, for the allowance) and a robot still waiting for its chip, to resume. */
const LoadAddRobot = Command.define('LoadAddRobot', {
  messages: [Message.SucceededLoad, Message.FailedLoad],
  execute: Effect.gen(function* () {
    const [{ robots }, catalogue] = yield* Effect.all([listRobots, Effect.option(loadCatalogue)], { concurrency: 2 })
    const waiting = robots.find((robot) => robot.status === 'unpaired' && robot.pairingCode !== null)
    return Message.SucceededLoad({
      merchantName: Option.match(catalogue, { onNone: () => 'Duck Café', onSome: ({ name }) => name }),
      maybePayTo: Option.flatMap(catalogue, ({ payTo }) => Option.fromNullishOr(payTo)),
      maybeWaiting: Option.fromNullishOr(waiting).pipe(
        Option.flatMap((robot) =>
          robot.pairingCode === null || robot.pairingExpiresAt === null
            ? Option.none()
            : Option.some({
                robotId: robot.id,
                name: robot.name,
                ...(robot.kind === undefined ? {} : { kind: robot.kind }),
                pairingCode: robot.pairingCode,
                pairingExpiresAt: robot.pairingExpiresAt,
              }),
        ),
      ),
    })
  }).pipe(
    Effect.catch((failure) =>
      Effect.succeed(Message.FailedLoad({ error: failure.error, signedOut: isSignedOut(failure) })),
    ),
  ),
})

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const AddNamedRobot = Command.define('AddNamedRobot', {
  args: { name: Schema.String, kind: RobotKind },
  messages: [Message.SucceededAddRobot, Message.FailedAddRobot],
  execute: ({ name, kind }) =>
    Effect.match(addRobot(name, kind), {
      onSuccess: (robot) => Message.SucceededAddRobot({ robot }),
      onFailure: (failure) => Message.FailedAddRobot({ error: failure.error }),
    }),
})

/** Re-reads the robots until this one is paired. @internal Exported for the scene tests. */
export const WatchPairing = Command.define('WatchPairing', {
  args: { robotId: Schema.String, delayMillis: Schema.Number },
  messages: [Message.SucceededWatch, Message.FailedWatch],
  execute: ({ robotId, delayMillis }) =>
    Effect.gen(function* () {
      yield* Effect.sleep(delayMillis)
      const { robots } = yield* listRobots
      const nowMillis = yield* Clock.currentTimeMillis
      return Message.SucceededWatch({
        robotId,
        paired: robots.some((robot) => robot.id === robotId && robot.status === 'paired'),
        nowMillis,
      })
    }).pipe(Effect.catch(() => Effect.succeed(Message.FailedWatch({ robotId })))),
})

/** Drops the robot that was waiting for its chip (a failure leaves it; the next load would resume it). @internal */
export const CancelPairing = Command.define('CancelPairing', {
  args: { robotId: Schema.String },
  messages: [Message.CompletedCancelPairing],
  execute: ({ robotId }) => cancelPairing(robotId).pipe(Effect.ignore, Effect.as(Message.CompletedCancelPairing())),
})

/** Granted: the robot's conversation (a full load; the app has no client-side routing). @internal */
export const OpenRobot = Command.define('OpenRobot', {
  args: { robotId: Schema.String },
  messages: [Message.CompletedOpenRobot],
  execute: ({ robotId }) =>
    Navigation.load(robotConsoleRouter({ robotId })).pipe(Effect.as(Message.CompletedOpenRobot())),
})

// INIT

type Services = HttpClient.HttpClient | Passkeys
type UpdateReturn = Update.Return<Model, Message, Services>

export const init = (): UpdateReturn => ({
  model: {
    stage: Stage.Loading(),
    name: '',
    // Most owners meet the duck in the browser first; a real robot is one tap away.
    kind: 'sim',
    merchantName: 'Duck Café',
    allowance: Allowance.init('', Option.none(), true),
  },
  commands: [LoadAddRobot()],
})

// UPDATE

const afterAllowance = (robotId: string) =>
  Allowance.OutMessage.match<Update.Step<Model, Message, Services>>({
    Granted: () => (model) => ({ model, commands: [OpenRobot({ robotId })] }),
    Stopped: () => (model) => ({ model }),
  })

const allowanceChild = (robotId: string) => ({
  read: (parent: Model) => Option.some(parent.allowance),
  write: (parent: Model, next: Allowance.Model) => modifyFields(parent, { allowance: () => next }),
  toParentMessage: (child: Allowance.Message) => Message.GotAllowanceMessage({ message: child }),
  foldOutMessage: afterAllowance(robotId),
})

const foldAllowance = (model: Model, message: Allowance.Message, robotId: string) =>
  Update.foldChild({ update: Allowance.update, ...allowanceChild(robotId) })(model, message)

/** The allowance's own step for a robot (its id and the merchant's address); it returns only a model. */
const allowanceFor = (model: Model, robotId: string, maybePayTo: Option.Option<string>): Model =>
  Update.foldChildStep({ update: Allowance.forRobot(robotId, maybePayTo), ...allowanceChild(robotId) })(model).model

const pairing = (model: Model, robot: AddedRobot): UpdateReturn => ({
  model: modifyFields(model, { stage: () => Stage.Pairing({ robot }) }),
  commands: [WatchPairing({ robotId: robot.robotId, delayMillis: WATCH_MILLIS })],
})

const watched = (model: Model, robotId: string, paired: boolean, nowMillis: number): UpdateReturn => {
  const { stage } = model
  if (!Stage.guards.Pairing(stage) || stage.robot.robotId !== robotId) return { model }
  if (paired) {
    return {
      model: modifyFields(allowanceFor(model, robotId, model.allowance.maybePayTo), {
        stage: () => Stage.Connected({ robotId, name: stage.robot.name }),
      }),
    }
  }
  return nowMillis >= stage.robot.pairingExpiresAt * 1000
    ? { model: modifyFields(model, { stage: () => Stage.Expired({ robot: stage.robot }) }) }
    : pairing(model, stage.robot)
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoad: ({ merchantName, maybePayTo, maybeWaiting }) => {
      const loaded = modifyFields(allowanceFor(model, '', maybePayTo), { merchantName: () => merchantName })
      return Option.match(maybeWaiting, {
        onNone: () => ({ model: modifyFields(loaded, { stage: () => Stage.Naming() }) }),
        onSome: (robot) => pairing(loaded, robot),
      })
    },
    FailedLoad: ({ error, signedOut }) => ({
      model: modifyFields(model, { stage: () => (signedOut ? Stage.SignedOut() : Stage.Failed({ error })) }),
    }),
    UpdatedName: ({ value }) => ({ model: modifyFields(model, { name: () => value }) }),
    SelectedKind: ({ kind }) => ({ model: modifyFields(model, { kind: () => kind }) }),
    SubmittedName: () => {
      const name = String.trim(model.name)
      if (String.isEmpty(name) || !Stage.guards.Naming(model.stage)) return { model }
      return {
        model: modifyFields(model, { stage: () => Stage.Adding() }),
        commands: [AddNamedRobot({ name, kind: model.kind })],
      }
    },
    SucceededAddRobot: ({ robot }) => pairing(modifyFields(model, { name: () => '' }), robot),
    FailedAddRobot: ({ error }) => ({ model: modifyFields(model, { stage: () => Stage.Failed({ error }) }) }),
    SucceededWatch: ({ robotId, paired, nowMillis }) => watched(model, robotId, paired, nowMillis),
    FailedWatch: ({ robotId }) =>
      Stage.guards.Pairing(model.stage) && model.stage.robot.robotId === robotId
        ? { model, commands: [WatchPairing({ robotId, delayMillis: WATCH_MILLIS * 2 })] }
        : { model },
    ClickedStartOver: () => ({ model: modifyFields(model, { stage: () => Stage.Naming() }) }),
    // The wrong kind, or no chip at hand: forget this robot and ask again (its watch ends with the Pairing stage).
    ClickedCancelPairing: () =>
      Stage.guards.Pairing(model.stage)
        ? {
            model: modifyFields(model, { stage: () => Stage.Naming(), kind: () => 'sim' as const }),
            commands: [CancelPairing({ robotId: model.stage.robot.robotId })],
          }
        : { model },
    CompletedCancelPairing: () => ({ model }),
    GotAllowanceMessage: ({ message: allowanceMessage }) =>
      Stage.guards.Connected(model.stage) ? foldAllowance(model, allowanceMessage, model.stage.robotId) : { model },
    CompletedOpenRobot: () => ({ model }),
  })
