import { Option } from 'effect'
import { Command, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { Message } from './message.ts'
import type { Model } from './model.ts'
import { AddRobot, Approval, Episode, Episodes, Gate, Merchant, RobotConsole, Wallet } from './pageModules.ts'
import { AppRoute } from './route.ts'

/** The owner pages' state lives beside the session in the root Model: only the current route's page is present. */
type Pages = Pick<
  Model,
  | 'maybeWallet'
  | 'maybeAddRobot'
  | 'maybeConsole'
  | 'maybeApproval'
  | 'maybeEpisodes'
  | 'maybeEpisode'
  | 'maybeMerchant'
  | 'maybeGate'
>
const noPages: Pages = {
  maybeWallet: Option.none(),
  maybeAddRobot: Option.none(),
  maybeConsole: Option.none(),
  maybeApproval: Option.none(),
  maybeEpisodes: Option.none(),
  maybeEpisode: Option.none(),
  maybeMerchant: Option.none(),
  maybeGate: Option.none(),
}

const toWallet = (message: Wallet.Message) => Message.GotWalletMessage({ message })
const toAddRobot = (message: AddRobot.Message) => Message.GotAddRobotMessage({ message })
const toConsole = (message: RobotConsole.Message) => Message.GotConsoleMessage({ message })
const toApproval = (message: Approval.Message) => Message.GotApprovalMessage({ message })
const toEpisodes = (message: Episodes.Message) => Message.GotEpisodesMessage({ message })
const toEpisode = (message: Episode.Message) => Message.GotEpisodeMessage({ message })

const episodesPage = (maybeRobotId: Option.Option<string>) => {
  const episodes = Episodes.init(maybeRobotId)
  return {
    pages: { ...noPages, maybeEpisodes: Option.some(episodes.model) },
    commands: Command.mapMessages(episodes.commands, toEpisodes),
  }
}
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
      const addRobot = AddRobot.init()
      return {
        pages: { ...noPages, maybeAddRobot: Option.some(addRobot.model) },
        commands: Command.mapMessages(addRobot.commands, toAddRobot),
      }
    },
    Approval: ({ approvalId }) => {
      const approval = Approval.init(approvalId)
      return {
        pages: { ...noPages, maybeApproval: Option.some(approval.model) },
        commands: Command.mapMessages(approval.commands, toApproval),
      }
    },
    Episodes: () => episodesPage(Option.none()),
    RobotEpisodes: ({ robotId }) => episodesPage(Option.some(robotId)),
    Episode: ({ episodeId }) => {
      const episode = Episode.init(episodeId)
      return {
        pages: { ...noPages, maybeEpisode: Option.some(episode.model) },
        commands: Command.mapMessages(episode.commands, toEpisode),
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

export const foldAddRobot = Update.foldChild({
  update: AddRobot.update,
  read: (model: Model) => model.maybeAddRobot,
  write: (model: Model, next: AddRobot.Model) => modifyFields(model, { maybeAddRobot: () => Option.some(next) }),
  toParentMessage: toAddRobot,
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

export const foldEpisodes = Update.foldChild({
  update: Episodes.update,
  read: (model: Model) => model.maybeEpisodes,
  write: (model: Model, next: Episodes.Model) => modifyFields(model, { maybeEpisodes: () => Option.some(next) }),
  toParentMessage: toEpisodes,
})

export const foldEpisode = Update.foldChild({
  update: Episode.update,
  read: (model: Model) => model.maybeEpisode,
  write: (model: Model, next: Episode.Model) => modifyFields(model, { maybeEpisode: () => Option.some(next) }),
  toParentMessage: toEpisode,
})
