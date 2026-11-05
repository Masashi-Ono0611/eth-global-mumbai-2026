import * as Cloudflare from '@alchemy.run/cloudflare'
import { format } from '@styld/i18n'
import { Effect, Layer } from 'effect'
import { Redacted } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { exerciseAttemptLimiter } from './AttemptLimiterFixture.ts'
import { seedIdentity, disableIdentity } from './IdentityFixture.ts'
import { DomainLive } from '../src/DomainLive.ts'
import { recoveryRoutes } from './RecoveryFixture.ts'
import { makeAuthHttp } from '../src/AuthHttp.ts'
import { StyldDatabase, StyldMedia } from '../src/Resources.ts'
import { storageHealth } from './StorageHealth.ts'

// Only the local native-test stack imports this fixture. It has no production declaration.
export default class RuntimeWorker extends Cloudflare.Worker<RuntimeWorker>()(
  'RuntimeWorker',
  {
    main: import.meta.url,
    compatibility: { date: '2026-10-19' },
    env: {
      APP_ENV: 'local',
      APP_RELEASE: 'native-test',
      AUTH_ORIGIN: 'http://localhost',
      AUTH_SECRET: 'native-test-auth-secret-012345678901234567890123',
      AUTH_SESSION_KEYS: JSON.stringify({
        activeKeyId: 'native-test',
        keys: [{ id: 'native-test', material: 'bmF0aXZlLXRlc3Qta2V5LW1hdGVyaWFsLWxvbmc=' }],
      }),
    },
  },
  Effect.gen(function* () {
    const database = yield* Cloudflare.D1.QueryDatabase(StyldDatabase)
    const media = yield* Cloudflare.R2.ReadWriteBucket(StyldMedia)
    const auth = makeAuthHttp(database, {
      origin: 'http://localhost',
      secret: Redacted.make('native-test-auth-secret-012345678901234567890123'),
      secureCookies: false,
      sessionKeys: {
        activeKeyId: 'native-test',
        keys: [{ id: 'native-test', material: Redacted.make('bmF0aXZlLXRlc3Qta2V5LW1hdGVyaWFsLWxvbmc=') }],
      },
    })
    const identityRoutes = Layer.mergeAll(
      auth.layer,
      yield* recoveryRoutes(database, media),
      HttpRouter.add(
        'POST',
        '/test/identity/seed',
        seedIdentity(database).pipe(Effect.orDie, Effect.as(HttpServerResponse.empty({ status: 204 }))),
      ),
      HttpRouter.add(
        'POST',
        '/test/identity/seed-limited',
        seedIdentity(database, 'native-limited').pipe(
          Effect.orDie,
          Effect.as(HttpServerResponse.empty({ status: 204 })),
        ),
      ),
      HttpRouter.add(
        'POST',
        '/test/identity/seed-browser',
        seedIdentity(database, 'native-browser').pipe(
          Effect.orDie,
          Effect.as(HttpServerResponse.empty({ status: 204 })),
        ),
      ),
      HttpRouter.add(
        'POST',
        '/test/identity/disable',
        disableIdentity(database).pipe(Effect.orDie, Effect.as(HttpServerResponse.empty({ status: 204 }))),
      ),
      HttpRouter.add(
        'POST',
        '/test/identity/limits',
        exerciseAttemptLimiter(database).pipe(Effect.orDie, Effect.flatMap(HttpServerResponse.json)),
      ),
    )
    const authHandle = yield* HttpRouter.toHttpEffect(identityRoutes).pipe(Effect.orDie)
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest
        const url = new URL(request.url, 'http://local.invalid')
        if (
          url.pathname.startsWith('/api/auth/') ||
          url.pathname.startsWith('/test/identity/') ||
          url.pathname.startsWith('/test/recovery/')
        )
          return yield* authHandle
        if (url.pathname === '/intl')
          return yield* HttpServerResponse.json({
            en: format('en', 'catalog.pieces', { count: 2 }),
            sl: format('sl', 'catalog.pieces', { count: 102 }),
            plural: new Intl.PluralRules('sl').select(2),
            date: new Intl.DateTimeFormat('en', { timeZone: 'UTC', year: 'numeric' }).format(0),
            currency: new Intl.NumberFormat('sl', { style: 'currency', currency: 'EUR' }).format(12.5),
          })
        if (url.pathname === '/storage') return yield* storageHealth(database, media)
        return HttpServerResponse.empty({ status: 404 })
      }),
    }
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        DomainLive,
        Cloudflare.Telemetry(),
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.R2.ReadWriteBucketBinding,
      ),
    ),
  ),
) {}
