import { Option, String } from 'effect'
import { Update } from 'foldkit'
import { Dialog } from '@foldkit/ui'
import { sheetFolds } from './Sheet.ts'
import type { SessionView } from '@ethmumbai/auth/config'
import { modifyFields } from 'foldkit/struct'
import {
  CreatePasskeyWallet,
  OpenWallet,
  OpenWelcome,
  ReadSession,
  SignInWithPasskey,
  SignOut,
  type Services,
} from './command.ts'
import { Message } from './message.ts'
import { AuthState, type Flags, type Model } from './model.ts'
import {
  foldApproval,
  foldConsole,
  foldEpisode,
  foldEpisodes,
  foldGate,
  foldMerchant,
  foldAddRobot,
  foldWallet,
  foldWelcome,
  initPages,
} from './pages.ts'
import { AppRoute, routeFromPathname } from './route.ts'
import * as Telegram from './Telegram.ts'

type UpdateReturn = Update.Return<Model, Message, Services>

export const init = (context: Flags): UpdateReturn => {
  const route = routeFromPathname(context.pathname)
  const pages = initPages(route)
  return {
    model: {
      context,
      route,
      auth: AuthState.Checking(),
      displayName: '',
      profileSheet: Dialog.init({ id: 'profile', isAnimated: true }),
      telegram: Telegram.init(),
      ...pages.pages,
    },
    commands: [ReadSession(), ...('commands' in pages ? pages.commands : [])],
  }
}

const telegramChild = {
  read: (model: Model) => Option.some(model.telegram),
  write: (model: Model, next: Telegram.Model) => modifyFields(model, { telegram: () => next }),
  toParentMessage: (message: Telegram.Message) => Message.GotTelegramMessage({ message }),
}
const foldTelegram = Update.foldChild({ update: Telegram.update, ...telegramChild })
const telegramOpened = Update.foldChildStep({ update: Telegram.opened, ...telegramChild })

const profileSheet = sheetFolds<Model, Message>({
  read: (model) => model.profileSheet,
  write: (model, sheet) => modifyFields(model, { profileSheet: () => sheet }),
  toParentMessage: (message) => Message.GotProfileSheetMessage({ message }),
})

/**
 * Signed in: the sign-in page hands over to the wallet; any other page reloads its data, which it first read
 * without a session.
 */
const signedIn = (model: Model, session: SessionView, isNewWallet = false): UpdateReturn => {
  const next = modifyFields(model, { auth: () => AuthState.SignedIn({ session }), displayName: () => '' })
  // A wallet created just now starts with the first steps; an owner signing back in goes straight to the wallet.
  if (AppRoute.guards.Home(model.route)) return { model: next, commands: [isNewWallet ? OpenWelcome() : OpenWallet()] }
  const pages = initPages(model.route)
  return { model: { ...next, ...pages.pages }, commands: 'commands' in pages ? pages.commands : [] }
}

/** A passkey ceremony may start only from a signed-out page that is not already running one. */
const canStartCeremony = (auth: AuthState) => AuthState.guards.SignedOut(auth) || AuthState.guards.Refused(auth)

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    UpdatedDisplayName: ({ value }) => ({ model: modifyFields(model, { displayName: () => value }) }),
    SubmittedCreateWallet: () => {
      const displayName = String.trim(model.displayName)
      if (!canStartCeremony(model.auth) || String.isEmpty(displayName)) {
        return { model }
      }
      return {
        model: modifyFields(model, { auth: () => AuthState.CreatingWallet() }),
        commands: [CreatePasskeyWallet({ displayName })],
      }
    },
    SucceededCreatePasskeyWallet: ({ session }) => signedIn(model, session, true),
    FailedCreatePasskeyWallet: ({ failure }) => ({
      model: modifyFields(model, { auth: () => AuthState.Refused({ failure }) }),
    }),
    ClickedSignIn: () =>
      canStartCeremony(model.auth)
        ? { model: modifyFields(model, { auth: () => AuthState.SigningIn() }), commands: [SignInWithPasskey()] }
        : { model },
    SucceededSignInWithPasskey: ({ session }) => signedIn(model, session),
    FailedSignInWithPasskey: ({ failure }) => ({
      model: modifyFields(model, { auth: () => AuthState.Refused({ failure }) }),
    }),
    SucceededReadSession: ({ maybeSession }) =>
      Option.match(maybeSession, {
        onNone: () => ({ model: modifyFields(model, { auth: () => AuthState.SignedOut() }) }),
        onSome: (session) => ({
          model: modifyFields(model, { auth: () => AuthState.SignedIn({ session }) }),
          commands: AppRoute.guards.Home(model.route) ? [OpenWallet()] : [],
        }),
      }),
    FailedReadSession: () => ({ model: modifyFields(model, { auth: () => AuthState.Unavailable() }) }),
    ClickedRetrySession: () => ({
      model: modifyFields(model, { auth: () => AuthState.Checking() }),
      commands: [ReadSession()],
    }),
    ClickedSignOut: () => {
      const { auth } = model
      if (!AuthState.guards.SignedIn(auth)) {
        return { model }
      }
      return {
        model: modifyFields(model, { auth: () => AuthState.SigningOut({ session: auth.session }) }),
        commands: [SignOut()],
      }
    },
    // Close the sheet through the Dialog so it releases its modal resources (focus, scroll lock) before it unmounts.
    SucceededSignOut: () => profileSheet.close(modifyFields(model, { auth: () => AuthState.SignedOut() })),
    ClickedProfile: () => {
      // Opening the sheet also asks for the Telegram row's state (the owner may have pressed Start meanwhile).
      const opened = profileSheet.open(model)
      const telegram = telegramOpened(opened.model)
      return { model: telegram.model, commands: [...(opened.commands ?? []), ...(telegram.commands ?? [])] }
    },
    GotTelegramMessage: ({ message: telegramMessage }) => foldTelegram(model, telegramMessage),
    GotProfileSheetMessage: ({ message: sheetMessage }) => profileSheet.fold(model, sheetMessage),
    CompletedOpenWallet: () => ({ model }),
    CompletedOpenWelcome: () => ({ model }),
    GotWelcomeMessage: ({ message: welcomeMessage }) => foldWelcome(model, welcomeMessage),
    GotWalletMessage: ({ message: walletMessage }) => foldWallet(model, walletMessage),
    GotAddRobotMessage: ({ message: addRobotMessage }) => foldAddRobot(model, addRobotMessage),
    GotConsoleMessage: ({ message: consoleMessage }) => foldConsole(model, consoleMessage),
    GotApprovalMessage: ({ message: approvalMessage }) => foldApproval(model, approvalMessage),
    GotEpisodesMessage: ({ message: episodesMessage }) => foldEpisodes(model, episodesMessage),
    GotEpisodeMessage: ({ message: episodeMessage }) => foldEpisode(model, episodeMessage),
    GotMerchantMessage: ({ message: merchantMessage }) => foldMerchant(model, merchantMessage),
    GotGateMessage: ({ message: gateMessage }) => foldGate(model, gateMessage),
    FailedSignOut: () => ({ model: modifyFields(model, { auth: () => AuthState.Unavailable() }) }),
  })
