import * as D1Client from '@effect/sql-d1/D1Client'
import { Auth, Password } from '@yielded/auth'
import * as WorkerdServices from '@yielded/auth/WorkerdServices'
import { databaseLayer } from '@yielded/auth-persistence-drizzle/D1'
import * as Drizzle from 'drizzle-orm/effect-d1'
import { Effect, Layer, Redacted, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { accounts } from '@styld/db'

import { passwordAttemptLimiter, type D1Source } from './AttemptLimiter.ts'
import { AccountClaims, requirement } from './config.ts'
import { AppAuth, Persistence, storage } from './storage.ts'

export type { D1Source } from './AttemptLimiter.ts'

export const makeAuthRuntime = <R>(raw: D1Source<R>, secret: Redacted.Redacted) => {
  const auth = AppAuth
  // @effect-diagnostics-next-line unstableApiUsage:off -- The pinned Effect D1 adapter is the Worker persistence boundary.
  const sql = Layer.unwrap(Effect.map(raw, (db) => D1Client.layer({ db })))
  const database = databaseLayer.pipe(Layer.provide(sql))

  const claims = Layer.effect(
    auth.strategies.password.SessionClaims,
    Effect.gen(function* () {
      const drizzle = yield* Drizzle.makeWithDefaults({})
      return {
        resolve: Effect.fn('Styld.Auth.claims')(
          function* ({ subjectId, credential }) {
            const rows = yield* drizzle.select().from(accounts).where(eq(accounts.id, subjectId))
            const account = rows[0]
            if (account === undefined || !account.enabled) return yield* Password.PasswordUnavailable.make({})
            return yield* Schema.decodeUnknownEffect(AccountClaims)({
              accountId: account.id,
              displayName: account.displayName,
              email: credential.identifier.value,
              emailVerified: credential.identifierVerifiedAtMillis !== undefined,
            })
          },
          Effect.mapError(() => Password.PasswordUnavailable.make({})),
        ),
      }
    }),
  ).pipe(Layer.provide(sql))

  const persistence = Persistence.layer.pipe(
    Layer.provide(Persistence.Config.layer(storage)),
    Layer.provide(database),
    Layer.provide(sql),
  )

  return {
    auth,
    layer: auth.layer.pipe(
      Layer.provide(claims),
      Layer.provide(passwordAttemptLimiter(raw, secret)),
      Layer.provide(persistence),
      Layer.provide(WorkerdServices.layer),
      Layer.provide(Auth.AuthConfig.layer({ secret })),
    ),
    sql,
    database,
    requirement,
  }
}
