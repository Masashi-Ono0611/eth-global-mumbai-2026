import * as Cloudflare from '@alchemy.run/cloudflare'
import { format } from '@ethmumbai/i18n'
import { Effect, Layer } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { agentFixtureRoutes } from './AgentFixture.ts'
import { chainFixtureRoutes } from './ChainFixture.ts'
import { DomainLive } from '../src/DomainLive.ts'
import { recoveryRoutes } from './RecoveryFixture.ts'
import { AppDatabase, AppMedia } from '../src/Resources.ts'
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
    },
  },
  Effect.gen(function* () {
    const database = yield* Cloudflare.D1.QueryDatabase(AppDatabase)
    const media = yield* Cloudflare.R2.ReadWriteBucket(AppMedia)
    const fixtureHandle = yield* HttpRouter.toHttpEffect(yield* recoveryRoutes(media)).pipe(Effect.orDie)
    const agentHandle = yield* HttpRouter.toHttpEffect(agentFixtureRoutes(database, media)).pipe(Effect.orDie)
    const chainHandle = yield* HttpRouter.toHttpEffect(chainFixtureRoutes(database)).pipe(Effect.orDie)
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest
        const url = new URL(request.url, 'http://local.invalid')
        if (url.pathname.startsWith('/test/recovery/')) return yield* fixtureHandle
        if (url.pathname.startsWith('/test/vq/')) return yield* agentHandle
        if (url.pathname.startsWith('/test/chain/')) return yield* chainHandle
        if (url.pathname === '/intl')
          return yield* HttpServerResponse.json({
            en: format('en', 'catalog.pieces', { count: 2 }),
            plural: new Intl.PluralRules('en').select(1),
            date: new Intl.DateTimeFormat('en', { timeZone: 'UTC', year: 'numeric' }).format(0),
            currency: new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(12.5),
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
