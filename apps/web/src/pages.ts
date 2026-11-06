import { Option } from 'effect'
import { Command, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { Message } from './message.ts'
import type { Model } from './model.ts'
import * as Approval from './pages/Approval.ts'
import * as Gate from './pages/gate/Gate.ts'
import * as Merchant from './pages/merchant/Merchant.ts'
import * as RobotConsole from './pages/RobotConsole.ts'
import * as Robots from './pages/Robots.ts'
import * as Wallet from './pages/Wallet.ts'
import { AppRoute } from './route.ts'

/** The owner pages' state lives beside the session in the root Model: only the current route's page is present. */
type Pages = Pick<
  Model,
  'maybeWallet' | 'maybeRobots' | 'maybeConsole' | 'maybeApproval' | 'maybeMerchant' | 'maybeGate'
>
const noPages: Pages = {
  maybeWallet: Option.none(),
  maybeRobots: Option.none(),
  maybeConsole: Option.none(),
  maybeApproval: Option.none(),
  maybeMerchant: Option.none(),
  maybeGate: Option.none(),
}

const toWallet = (message: Wallet.Message) => Message.GotWalletMessage({ message })
const toRobots = (message: Robots.Message) => Message.GotRobotsMessage({ message })
const toConsole = (message: RobotConsole.Message) => Message.GotConsoleMessage({ message })
const toApproval = (message: Approval.Message) => Message.GotApprovalMessage({ message })
const toMerchant = (message: Merchant.Message) => Message.GotMerchantMessage({ message })
const toGate = (message: Gate.Message) => Message.GotGateMessage({ message })

/** Each page loads its own data on start (in the browser; the server renders the loading state). */
export const initPages = (route: AppRoute) =>
  AppRoute.match(route, {
    Home: () => ({ pages: noPages }),
    NotFound: () => ({ pages: noPages }),
    Wallet: () => {
      const wallet = Wallet.init()
      return {
        pages: { ...noPages, maybeWallet: Option.some(wallet.model) },
        commands: Command.mapMessages(wallet.commands, toWallet),
      }
    },
    Robots: () => {
      const robots = Robots.init()
      return {
        pages: { ...noPages, maybeRobots: Option.some(robots.model) },
        commands: Command.mapMessages(robots.commands, toRobots),
      }
    },
    Approval: ({ approvalId }) => {
      const approval = Approval.init(approvalId)
      return {
        pages: { ...noPages, maybeApproval: Option.some(approval.model) },
        commands: Command.mapMessages(approval.commands, toApproval),
      }
    },
    Merchant: () => {
      const merchant = Merchant.init()
      return {
        pages: { ...noPages, maybeMerchant: Option.some(merchant.model) },
        commands: Command.mapMessages(merchant.commands, toMerchant),
      }
    },
    Gate: ({ merchantId }) => {
      const gate = Gate.init(merchantId)
      return {
        pages: { ...noPages, maybeGate: Option.some(gate.model) },
        commands: Command.mapMessages(gate.commands, toGate),
      }
    },
    RobotConsole: ({ robotId }) => {
      const robotConsole = RobotConsole.init(robotId)
      return {
        pages: { ...noPages, maybeConsole: Option.some(robotConsole.model) },
        commands: Command.mapMessages(robotConsole.commands, toConsole),
      }
    },
  })

export const foldWallet = Update.foldChild({
  update: Wallet.update,
  read: (model: Model) => model.maybeWallet,
  write: (model: Model, nextWallet: Wallet.Model) =>
    modifyFields(model, { maybeWallet: () => Option.some(nextWallet) }),
  toParentMessage: toWallet,
})

export const foldRobots = Update.foldChild({
  update: Robots.update,
  read: (model: Model) => model.maybeRobots,
  write: (model: Model, nextRobots: Robots.Model) =>
    modifyFields(model, { maybeRobots: () => Option.some(nextRobots) }),
  toParentMessage: toRobots,
})

export const foldConsole = Update.foldChild({
  update: RobotConsole.update,
  read: (model: Model) => model.maybeConsole,
  write: (model: Model, nextConsole: RobotConsole.Model) =>
    modifyFields(model, { maybeConsole: () => Option.some(nextConsole) }),
  toParentMessage: toConsole,
})

export const foldMerchant = Update.foldChild({
  update: Merchant.update,
  read: (model: Model) => model.maybeMerchant,
  write: (model: Model, nextMerchant: Merchant.Model) =>
    modifyFields(model, { maybeMerchant: () => Option.some(nextMerchant) }),
  toParentMessage: toMerchant,
})

export const foldGate = Update.foldChild({
  update: Gate.update,
  read: (model: Model) => model.maybeGate,
  write: (model: Model, nextGate: Gate.Model) => modifyFields(model, { maybeGate: () => Option.some(nextGate) }),
  toParentMessage: toGate,
})

export const foldApproval = Update.foldChild({
  update: Approval.update,
  read: (model: Model) => model.maybeApproval,
  write: (model: Model, nextApproval: Approval.Model) =>
    modifyFields(model, { maybeApproval: () => Option.some(nextApproval) }),
  toParentMessage: toApproval,
})
