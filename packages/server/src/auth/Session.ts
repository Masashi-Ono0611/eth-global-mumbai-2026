import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import {
  secureRandomBytes,
  sessionCookieName,
  sessionLifetimeSeconds,
  type SessionKeyring,
  sessionToken,
  signSession,
  verifySession,
} from '@ethmumbai/auth'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { Context, Effect, Option } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { jsonError, nowSeconds } from '../Respond.ts'
import { requireSameOrigin } from './Origin.ts'
import { findAccount, rotateSecurityRevision } from './Store.ts'

/** The signed-in owner, as every wallet handler sees it. */
export type SessionAccount = {
  readonly accountId: string
  readonly displayName: string
  readonly smartAccount: string
}

/** Provided by {@link requireSession} to the handler it wraps. */
export class CurrentSession extends Context.Service<CurrentSession, SessionAccount>()(
  '@ethmumbai/server/auth/CurrentSession',
) {}

/** Session cookies: signed with `AUTH_SESSION_KEYS`, valid while the account's `security_revision` is unchanged. */
export class SessionAuth extends Context.Service<
  SessionAuth,
  {
    readonly authenticate: (token: string) => Effect.Effect<Option.Option<SessionAccount>>
    readonly issue: (account: {
      readonly accountId: string
      readonly securityRevision: string
    }) => Effect.Effect<string>
    /** Logout: bumps the revision, so this cookie and every other cookie of the account stop working at once. */
    readonly revokeAll: (accountId: string) => Effect.Effect<void>
  }
>()('@ethmumbai/server/auth/SessionAuth') {}

export const newSecurityRevision = Effect.map(secureRandomBytes(16), (bytes) => Base64Url.encode(bytes))

/** Built once per isolate; D1 statements run with the Worker's runtime context captured here. */
export const makeSessionAuth = (database: QueryDatabaseClient, keyring: SessionKeyring) =>
  Effect.gen(function* () {
    const runtime = yield* Effect.context<RuntimeContext>()
    return SessionAuth.of({
      authenticate: (token) =>
        Effect.gen(function* () {
          const payload = yield* verifySession(keyring, token, yield* nowSeconds)
          const account = yield* findAccount(database, payload.accountId)
          return Option.flatMap(account, (row) =>
            row.security_revision === payload.securityRevision
              ? Option.some({ accountId: row.id, displayName: row.display_name, smartAccount: row.smart_account })
              : Option.none(),
          )
        }).pipe(
          Effect.catchTag('SessionInvalid', () => Effect.succeedNone),
          Effect.provideContext(runtime),
          Effect.withSpan('EthMumbai.Auth.authenticate'),
        ),
      issue: (account) =>
        Effect.flatMap(nowSeconds, (now) => signSession(keyring, { ...account, now })).pipe(
          Effect.withSpan('EthMumbai.Auth.issueSession'),
        ),
      revokeAll: (accountId) =>
        Effect.flatMap(newSecurityRevision, (revision) => rotateSecurityRevision(database, accountId, revision)).pipe(
          Effect.provideContext(runtime),
          Effect.withSpan('EthMumbai.Auth.revokeSessions'),
        ),
    })
  })

const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const

export const withSessionCookie = (response: HttpServerResponse.HttpServerResponse, token: string) =>
  HttpServerResponse.setCookie(response, sessionCookieName, token, {
    ...cookieOptions,
    maxAge: `${sessionLifetimeSeconds} seconds`,
  }).pipe(Effect.orDie)

export const withoutSessionCookie = (response: HttpServerResponse.HttpServerResponse) =>
  HttpServerResponse.expireCookie(response, sessionCookieName, cookieOptions).pipe(Effect.orDie)

/** The owner behind the request's cookie, if the cookie is authentic and its revision is current. */
export const currentAccount = Effect.gen(function* () {
  const request = yield* HttpServerRequest
  const sessions = yield* SessionAuth
  return yield* Option.match(sessionToken(request.cookies), {
    onNone: () => Effect.succeedNone,
    onSome: sessions.authenticate,
  })
})

/** Guards a wallet handler: same-origin for every mutating method (403), a valid session (401), then
 * {@link CurrentSession} is available to the handler. */
export const requireSession = <E, R>(handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
  requireSameOrigin(
    Effect.gen(function* () {
      const account = yield* currentAccount
      if (Option.isNone(account)) return yield* jsonError(401, 'not signed in')
      return yield* handler.pipe(Effect.provideService(CurrentSession, account.value))
    }),
  )
