import * as Cloudflare from '@alchemy.run/cloudflare'
import * as AlchemyHttp from 'alchemy/Http'
import { Effect, Layer } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import { decodeAuthSecret, decodeAuthSessionKeyring } from './AuthConfiguration.ts'
import { makeAuthHttp } from './AuthHttp.ts'
import { DomainLive } from './DomainLive.ts'
import { health } from './Health.ts'
import { storageHealth } from './StorageHealth.ts'
import { StyldDatabase, StyldMedia } from './Resources.ts'
import { makeObservabilityBase, metadataFromHeaders, withObservability } from '@styld/observability'

const Runtime = Layer.mergeAll(
  DomainLive,
  Cloudflare.Telemetry({ headSamplingRate: 1 }),
  Cloudflare.D1.QueryDatabaseBinding,
  Cloudflare.R2.ReadWriteBucketBinding,
)

export class StyldWorker extends Cloudflare.Worker<StyldWorker, Cloudflare.WorkerShape>()('Api') {}

export default StyldWorker.make(
  {
    main: import.meta.url,
    // Keep local workerd and deployed Workers on the same supported date; telemetry needs >= 2026-07-28.
    compatibility: { date: '2026-10-19' },
    workersDev: { enabled: false, previewsEnabled: false },
    observability: { enabled: true, redactQueryString: true, logs: { enabled: true, invocationLogs: true } },
  },
  Effect.gen(function* () {
    const database = yield* Cloudflare.D1.QueryDatabase(StyldDatabase)
    const media = yield* Cloudflare.R2.ReadWriteBucket(StyldMedia)
    const fetch = Effect.gen(function* () {
      // Bindings configured by the stack (including the web origin and
      // secrets) exist only in the deployed request runtime, not while
      // Alchemy evaluates the Worker declaration during planning.
      const env = yield* Cloudflare.Workers.WorkerEnvironment
      const observabilityBase = yield* makeObservabilityBase({
        environment: env.APP_ENV,
        release: env.APP_RELEASE,
        component: 'server',
      }).pipe(Effect.orDie)
      const authOrigin: unknown = env.AUTH_ORIGIN
      if (typeof authOrigin !== 'string' || authOrigin.length === 0) {
        return yield* Effect.die(new Error('AUTH_ORIGIN binding is required'))
      }
      const authSessionKeys = yield* decodeAuthSessionKeyring(env.AUTH_SESSION_KEYS).pipe(Effect.orDie)
      const authSecret = yield* decodeAuthSecret(env.AUTH_SECRET).pipe(Effect.orDie)
      const auth = makeAuthHttp(database, {
        origin: authOrigin,
        secret: authSecret,
        secureCookies: true,
        sessionKeys: authSessionKeys,
      })
      const routes = Layer.mergeAll(
        auth.layer,
        HttpRouter.add('GET', '/api/health', health(observabilityBase.release)),
        HttpRouter.add('GET', '/api/storage', storageHealth(database, media)),
      ).pipe(Layer.provide(AlchemyHttp.Platform))
      const handle = yield* HttpRouter.toHttpEffect(routes).pipe(Effect.orDie)
      return Effect.gen(function* () {
        const request = yield* HttpServerRequest
        const metadata = metadataFromHeaders(observabilityBase, request.headers)
        return yield* handle.pipe(withObservability('styld.http', metadata))
      })
    }).pipe(Effect.flatten)
    return { fetch }
  }).pipe(Effect.provide(Runtime)),
)
