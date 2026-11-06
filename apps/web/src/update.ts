import { Option, String } from 'effect'
import { Update } from 'foldkit'
import { Dialog } from '@foldkit/ui'
import type { SessionView } from '@ethmumbai/auth/config'
import { modifyFields } from 'foldkit/struct'
import { CreatePasskeyWallet, OpenWallet, ReadSession, SignInWithPasskey, SignOut, type Services } from './command.ts'
import { Message } from './message.ts'
import { AuthState, type Flags, type Model } from './model.ts'
import {
  foldApproval,
  foldConsole,
  foldEpisode,
  foldEpisodes,
  foldGate,
  foldMerchant,
  foldRobots,
  foldWallet,
  initPages,
} from './pages.ts'
import { AppRoute, routeFromPathname } from './route.ts'

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
      profileSheet: Dialog.init({ id: 'profile' }),
      ...pages.pages,
    },
    commands: [ReadSession(), ...('commands' in pages ? pages.commands : [])],
  }
}

const foldSheetOutMessage = Dialog.OutMessage.match<Update.Step<Model, Message>>({
  Opened: () => (model) => ({ model }),
  Closed: () => (model) => ({ model }),
})

const foldProfileSheet = Update.foldChild({
  update: Dialog.update,
  read: (model: Model) => Option.some(model.profileSheet),
  write: (model: Model, nextSheet: Dialog.Model) => modifyFields(model, { profileSheet: () => nextSheet }),
  toParentMessage: (message: Dialog.Message) => Message.GotProfileSheetMessage({ message }),
  foldOutMessage: foldSheetOutMessage,
})

const foldProfileSheetOpen = Update.foldChildStep({
  update: Dialog.open,
  read: (model: Model) => Option.some(model.profileSheet),
  write: (model: Model, nextSheet: Dialog.Model) => modifyFields(model, { profileSheet: () => nextSheet }),
  toParentMessage: (message: Dialog.Message) => Message.GotProfileSheetMessage({ message }),
  foldOutMessage: foldSheetOutMessage,
})

const foldProfileSheetClose = Update.foldChildStep({
  update: Dialog.close,
  read: (model: Model) => Option.some(model.profileSheet),
  write: (model: Model, nextSheet: Dialog.Model) => modifyFields(model, { profileSheet: () => nextSheet }),
  toParentMessage: (message: Dialog.Message) => Message.GotProfileSheetMessage({ message }),
  foldOutMessage: foldSheetOutMessage,
})

/**
 * Signed in: the sign-in page hands over to the wallet; any other page reloads its data, which it first read
 * without a session.
 */
const signedIn = (model: Model, session: SessionView): UpdateReturn => {
  const next = modifyFields(model, { auth: () => AuthState.SignedIn({ session }), displayName: () => '' })
  if (AppRoute.guards.Home(model.route)) return { model: next, commands: [OpenWallet()] }
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
    SucceededCreatePasskeyWallet: ({ session }) => signedIn(model, session),
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
    SucceededSignOut: () => foldProfileSheetClose(modifyFields(model, { auth: () => AuthState.SignedOut() })),
    ClickedProfile: () => foldProfileSheetOpen(model),
    GotProfileSheetMessage: ({ message: sheetMessage }) => foldProfileSheet(model, sheetMessage),
    CompletedOpenWallet: () => ({ model }),
    GotWalletMessage: ({ message: walletMessage }) => foldWallet(model, walletMessage),
    GotRobotsMessage: ({ message: robotsMessage }) => foldRobots(model, robotsMessage),
    GotConsoleMessage: ({ message: consoleMessage }) => foldConsole(model, consoleMessage),
    GotApprovalMessage: ({ message: approvalMessage }) => foldApproval(model, approvalMessage),
    GotEpisodesMessage: ({ message: episodesMessage }) => foldEpisodes(model, episodesMessage),
    GotEpisodeMessage: ({ message: episodeMessage }) => foldEpisode(model, episodeMessage),
    GotMerchantMessage: ({ message: merchantMessage }) => foldMerchant(model, merchantMessage),
    GotGateMessage: ({ message: gateMessage }) => foldGate(model, gateMessage),
    FailedSignOut: () => ({ model: modifyFields(model, { auth: () => AuthState.Unavailable() }) }),
  })
