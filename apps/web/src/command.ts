import { Effect, Option, Predicate, Schema } from 'effect'
import * as AuthClient from '@ethmumbai/auth/client'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { Command } from 'foldkit'
import { Locale, localeEndpoint } from './Locale.ts'
import { Message } from './message.ts'
import { Passkeys } from './Passkey.ts'
import type { AuthFailure } from './model.ts'

const failureOf = (error: unknown): AuthFailure => (Predicate.isTagged(error, 'PasskeyFailed') ? 'passkey' : 'server')

/** Registration: the Worker's options, the authenticator's new ES256 credential, the Worker's verification. */
export const CreatePasskeyWallet = Command.define('CreatePasskeyWallet', {
  args: { displayName: Schema.String },
  messages: [Message.SucceededCreatePasskeyWallet, Message.FailedCreatePasskeyWallet],
  execute: ({ displayName }) =>
    Effect.gen(function* () {
      const options = yield* AuthClient.registrationOptions(displayName)
      const credential = yield* (yield* Passkeys).create(options)
      const account = yield* AuthClient.register(credential)
      return Message.SucceededCreatePasskeyWallet({ session: { ...account, displayName: options.user.name } })
    }).pipe(Effect.catch((error) => Effect.succeed(Message.FailedCreatePasskeyWallet({ failure: failureOf(error) })))),
})

/** Login with any discoverable passkey of this site, then the session the Worker now recognises. */
export const SignInWithPasskey = Command.define('SignInWithPasskey', {
  messages: [Message.SucceededSignInWithPasskey, Message.FailedSignInWithPasskey],
  execute: Effect.gen(function* () {
    const options = yield* AuthClient.loginOptions
    const assertion = yield* (yield* Passkeys).get(options)
    yield* AuthClient.login(assertion)
    const session = yield* AuthClient.readSession
    if (session === null) return Message.FailedSignInWithPasskey({ failure: 'server' })
    return Message.SucceededSignInWithPasskey({ session })
  }).pipe(Effect.catch((error) => Effect.succeed(Message.FailedSignInWithPasskey({ failure: failureOf(error) })))),
})

export const ReadSession = Command.define('ReadSession', {
  messages: [Message.SucceededReadSession, Message.FailedReadSession],
  execute: AuthClient.readSession.pipe(
    Effect.map((session) => Message.SucceededReadSession({ maybeSession: Option.fromNullishOr(session) })),
    Effect.catch(() => Effect.succeed(Message.FailedReadSession())),
  ),
})

export const SignOut = Command.define('SignOut', {
  messages: [Message.SucceededSignOut, Message.FailedSignOut],
  execute: AuthClient.logout.pipe(
    Effect.as(Message.SucceededSignOut()),
    Effect.catch(() => Effect.succeed(Message.FailedSignOut())),
  ),
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
export type Services = HttpClient.HttpClient | Passkeys
