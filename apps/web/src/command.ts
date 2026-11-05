import { Effect, Predicate, Redacted } from 'effect'
import { BrowserAuth } from '@ethmumbai/auth/client'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { Command } from 'foldkit'
import { Locale, localeEndpoint } from './Locale.ts'
import { Message } from './message.ts'
import { PasswordForm } from './PasswordForm.ts'

export const SignIn = Command.define('SignIn', {
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

export const ReadSession = Command.define('ReadSession', {
  messages: [Message.ReceivedSession, Message.FailedReadSession],
  execute: Effect.gen(function* () {
    const { auth } = yield* BrowserAuth
    const session = yield* auth.getSession()
    return Message.ReceivedSession({ claims: session?.claims ?? null })
  }).pipe(Effect.catch(() => Effect.succeed(Message.FailedReadSession()))),
})

export const SignOut = Command.define('SignOut', {
  messages: [Message.SucceededSignOut, Message.FailedSignOut],
  execute: Effect.gen(function* () {
    yield* (yield* BrowserAuth).auth.signOut()
    return Message.SucceededSignOut()
  }).pipe(Effect.catch(() => Effect.succeed(Message.FailedSignOut()))),
})

export const SaveLocale = Command.define('SaveLocale', {
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

/** What the Commands run against: the browser provides these in entry.ts. */
export type Services = HttpClient.HttpClient | BrowserAuth | PasswordForm
