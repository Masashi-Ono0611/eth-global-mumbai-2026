import { makeAuthRuntime } from '@ethmumbai/auth'
import { Http, Sessions } from '@yielded/auth'
import { Effect, Layer } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { AuthHttpOptions } from './AuthConfiguration.ts'

/** Build the auth HTTP layer at the Worker boundary where the trusted origin
 * and the native D1 binding are available. */
export const makeAuthHttp = (database: QueryDatabaseClient, options: AuthHttpOptions) => {
  const runtime = makeAuthRuntime(database.raw, options.secret)
  const http = Http.make(runtime.auth, {
    origin: options.origin,
    cookie: { secure: options.secureCookies },
  })
  const dependencies = runtime.layer.pipe(
    Layer.provideMerge(Layer.succeed(Sessions.SessionSigningKeys, options.sessionKeys)),
  )
  return {
    layer: http.routes().pipe(Layer.provide(dependencies)),
    runtime,
    router: http,
  }
}

export const makeAuthHandler = (database: QueryDatabaseClient, options: AuthHttpOptions) => {
  const auth = makeAuthHttp(database, options)
  return Effect.map(HttpRouter.toHttpEffect(auth.layer).pipe(Effect.orDie), (handle) => ({ handle, auth }))
}
