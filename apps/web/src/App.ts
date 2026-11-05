import { Effect, Predicate, Redacted, Schema } from 'effect'
import { BrowserAuth } from '@ethmumbai/auth/client'
import { AccountClaims } from '@ethmumbai/auth/config'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { catalogVersion } from '@ethmumbai/i18n'
import { Locale, localeEndpoint, parseLocale } from './Locale.ts'
import { PasswordForm } from './PasswordForm.ts'

export const Flags = Schema.Struct({
  locale: Locale,
  catalogVersion: Schema.Literal(catalogVersion),
  timeZone: Schema.String,
  referenceTime: Schema.Number,
  pathname: Schema.String,
})
export type Flags = typeof Flags.Type

export const LocaleSave = defineTaggedUnion({ Saved: {}, Saving: { locale: Locale }, Failed: {} })
export const AuthState = defineTaggedUnion({
  Checking: {},
  SignedOut: { failed: Schema.Boolean },
  SigningIn: {},
  SignedIn: { claims: AccountClaims },
  SigningOut: { claims: AccountClaims },
  Unavailable: {},
})
export const Model = Schema.Struct({
  context: Flags,
  localeSave: LocaleSave,
  auth: AuthState,
})
export type Model = typeof Model.Type
export const Message = defineMessageUnion({
  SelectedLocale: { value: Schema.String },
  SucceededSaveLocale: { locale: Locale },
  FailedSaveLocale: {},
  SubmittedSignIn: {},
  SucceededSignIn: { claims: AccountClaims },
  FailedSignIn: {},
  ReceivedSession: { claims: Schema.NullOr(AccountClaims) },
  FailedReadSession: {},
  RequestedSession: {},
  RequestedSignOut: {},
  SucceededSignOut: {},
  FailedSignOut: {},
})
export type Message = typeof Message.Type

const SignIn = Command.define('SignIn', {
  messages: [Message.SucceededSignIn, Message.FailedSignIn],
  execute: Effect.gen(function* () {
    const { auth } = yield* BrowserAuth
    const credentials = yield* (yield* PasswordForm).take
    const result = yield* auth.signIn({ email: credentials.email, password: Redacted.value(credentials.password) })
    return Predicate.isTagged(result, 'Authenticated')
      ? Message.SucceededSignIn({ claims: result.session.claims })
      : Message.FailedSignIn()
  }).pipe(Effect.catch(() => Effect.succeed(Message.FailedSignIn()))),
})

const ReadSession = Command.define('ReadSession', {
  messages: [Message.ReceivedSession, Message.FailedReadSession],
  execute: Effect.gen(function* () {
    const { auth } = yield* BrowserAuth
    const session = yield* auth.getSession()
    return Message.ReceivedSession({ claims: session?.claims ?? null })
  }).pipe(Effect.catch(() => Effect.succeed(Message.FailedReadSession()))),
})

const SignOut = Command.define('SignOut', {
  messages: [Message.SucceededSignOut, Message.FailedSignOut],
  execute: Effect.gen(function* () {
    yield* (yield* BrowserAuth).auth.signOut()
    return Message.SucceededSignOut()
  }).pipe(Effect.catch(() => Effect.succeed(Message.FailedSignOut()))),
})

const SaveLocale = Command.define('SaveLocale', {
  args: { locale: Locale },
  messages: [Message.SucceededSaveLocale, Message.FailedSaveLocale],
  execute: ({ locale }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      yield* HttpClient.filterStatusOk(client).execute(
        HttpClientRequest.post(localeEndpoint).pipe(HttpClientRequest.bodyUrlParams({ locale })),
      )
      return Message.SucceededSaveLocale({ locale })
    }).pipe(Effect.catchTag('HttpClientError', () => Effect.succeed(Message.FailedSaveLocale()))),
})

type Services = HttpClient.HttpClient | BrowserAuth | PasswordForm

export const init = (context: Flags): Update.Return<Model, Message, Services> => ({
  model: { context, localeSave: LocaleSave.Saved(), auth: AuthState.Checking() },
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
