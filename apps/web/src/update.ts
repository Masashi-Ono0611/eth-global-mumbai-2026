import type { Update } from 'foldkit'
import { ReadSession, SaveLocale, SignIn, SignOut, type Services } from './command.ts'
import { parseLocale } from './Locale.ts'
import { Message } from './message.ts'
import { AuthState, type Flags, LocaleSave, type Model } from './model.ts'
import { routeFromPathname } from './route.ts'

export const init = (context: Flags): Update.Return<Model, Message, Services> => ({
  model: {
    context,
    route: routeFromPathname(context.pathname),
    localeSave: LocaleSave.Saved(),
    auth: AuthState.Checking(),
  },
  commands: [ReadSession()],
})

export const update = (model: Model, message: Message): Update.Return<Model, Message, Services> =>
  Message.match(message, {
    SelectedLocale: ({ value }) => {
      const locale = parseLocale(value)
      if (locale === undefined || LocaleSave.guards.Saving(model.localeSave)) return { model }
      return { model: { ...model, localeSave: LocaleSave.Saving({ locale }) }, commands: [SaveLocale({ locale })] }
    },
    SucceededSaveLocale: ({ locale }) => ({
      model: { ...model, context: { ...model.context, locale }, localeSave: LocaleSave.Saved() },
    }),
    FailedSaveLocale: () => ({ model: { ...model, localeSave: LocaleSave.Failed() } }),
    SubmittedSignIn: () => {
      if (!AuthState.guards.SignedOut(model.auth)) return { model }
      return {
        model: { ...model, auth: AuthState.SigningIn() },
        commands: [SignIn()],
      }
    },
    SucceededSignIn: ({ claims }) => ({ model: { ...model, auth: AuthState.SignedIn({ claims }) } }),
    FailedSignIn: () => ({ model: { ...model, auth: AuthState.SignedOut({ failed: true }) } }),
    ReceivedSession: ({ claims }) => ({
      model: {
        ...model,
        auth: claims === null ? AuthState.SignedOut({ failed: false }) : AuthState.SignedIn({ claims }),
      },
    }),
    FailedReadSession: () => ({ model: { ...model, auth: AuthState.Unavailable() } }),
    RequestedSession: () => ({ model: { ...model, auth: AuthState.Checking() }, commands: [ReadSession()] }),
    RequestedSignOut: () =>
      AuthState.guards.SignedIn(model.auth)
        ? { model: { ...model, auth: AuthState.SigningOut({ claims: model.auth.claims }) }, commands: [SignOut()] }
        : { model },
    SucceededSignOut: () => ({ model: { ...model, auth: AuthState.SignedOut({ failed: false }) } }),
    FailedSignOut: () => ({ model: { ...model, auth: AuthState.Unavailable() } }),
  })
