import { Option } from 'effect'
import { Command, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { Message } from './message.ts'
import type { Model } from './model.ts'
import * as RobotConsole from './pages/RobotConsole.ts'
import * as Robots from './pages/Robots.ts'
import * as Wallet from './pages/Wallet.ts'
import { AppRoute } from './route.ts'

/** The owner pages' state lives beside the session in the root Model: only the current route's page is present. */
type Pages = Pick<Model, 'maybeWallet' | 'maybeRobots' | 'maybeConsole'>
const noPages: Pages = { maybeWallet: Option.none(), maybeRobots: Option.none(), maybeConsole: Option.none() }

const toWallet = (message: Wallet.Message) => Message.GotWalletMessage({ message })
const toRobots = (message: Robots.Message) => Message.GotRobotsMessage({ message })
const toConsole = (message: RobotConsole.Message) => Message.GotConsoleMessage({ message })

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
