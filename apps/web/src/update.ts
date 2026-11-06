import { Option, String } from 'effect'
import type { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { CreatePasskeyWallet, ReadSession, SaveLocale, SignInWithPasskey, SignOut, type Services } from './command.ts'
import { parseLocale } from './Locale.ts'
import { Message } from './message.ts'
import { AuthState, type Flags, LocaleSave, type Model } from './model.ts'
import { foldConsole, foldRobots, foldWallet, initPages } from './pages.ts'
import { routeFromPathname } from './route.ts'

type UpdateReturn = Update.Return<Model, Message, Services>

export const init = (context: Flags): UpdateReturn => {
  const route = routeFromPathname(context.pathname)
  const pages = initPages(route)
  return {
    model: {
      context,
      route,
      localeSave: LocaleSave.Saved(),
      auth: AuthState.Checking(),
      displayName: '',
      ...pages.pages,
    },
    commands: [ReadSession(), ...('commands' in pages ? pages.commands : [])],
  }
}

/** A passkey ceremony may start only from a signed-out page that is not already running one. */
const canStartCeremony = (auth: AuthState) => AuthState.guards.SignedOut(auth) || AuthState.guards.Refused(auth)

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SelectedLocale: ({ value }) => {
      const locale = parseLocale(value)
      if (locale === undefined || LocaleSave.guards.Saving(model.localeSave)) {
        return { model }
      }
      return {
        model: modifyFields(model, { localeSave: () => LocaleSave.Saving({ locale }) }),
        commands: [SaveLocale({ locale })],
      }
    },
    SucceededSaveLocale: ({ locale }) => ({
      model: modifyFields(model, {
        context: () => modifyFields(model.context, { locale: () => locale }),
        localeSave: () => LocaleSave.Saved(),
      }),
    }),
    FailedSaveLocale: () => ({ model: modifyFields(model, { localeSave: () => LocaleSave.Failed() }) }),
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
    SucceededCreatePasskeyWallet: ({ session }) => ({
      model: modifyFields(model, { auth: () => AuthState.SignedIn({ session }), displayName: () => '' }),
    }),
    FailedCreatePasskeyWallet: ({ failure }) => ({
      model: modifyFields(model, { auth: () => AuthState.Refused({ failure }) }),
    }),
    ClickedSignIn: () =>
      canStartCeremony(model.auth)
        ? { model: modifyFields(model, { auth: () => AuthState.SigningIn() }), commands: [SignInWithPasskey()] }
        : { model },
    SucceededSignInWithPasskey: ({ session }) => ({
      model: modifyFields(model, { auth: () => AuthState.SignedIn({ session }) }),
    }),
    FailedSignInWithPasskey: ({ failure }) => ({
      model: modifyFields(model, { auth: () => AuthState.Refused({ failure }) }),
    }),
    SucceededReadSession: ({ maybeSession }) => ({
      model: modifyFields(model, {
        auth: () =>
          Option.match(maybeSession, {
            onNone: () => AuthState.SignedOut(),
            onSome: (session) => AuthState.SignedIn({ session }),
          }),
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
    SucceededSignOut: () => ({ model: modifyFields(model, { auth: () => AuthState.SignedOut() }) }),
    GotWalletMessage: ({ message: walletMessage }) => foldWallet(model, walletMessage),
    GotRobotsMessage: ({ message: robotsMessage }) => foldRobots(model, robotsMessage),
    GotConsoleMessage: ({ message: consoleMessage }) => foldConsole(model, consoleMessage),
    FailedSignOut: () => ({ model: modifyFields(model, { auth: () => AuthState.Unavailable() }) }),
  })
