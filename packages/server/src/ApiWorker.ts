import * as Cloudflare from '@alchemy.run/cloudflare'
import * as AlchemyHttp from 'alchemy/Http'
import { decodeSessionKeyring, relyingPartyFromOrigin } from '@ethmumbai/auth'
import { Context, Effect, Layer, Option } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import { AuthOrigin } from './auth/Origin.ts'
import { authRoutes } from './auth/Routes.ts'
import { makeSessionAuth, SessionAuth } from './auth/Session.ts'
import { makeChainServices } from './chain/Services.ts'
import { DomainLive } from './DomainLive.ts'
import { features } from './Features.ts'
import { health } from './Health.ts'
import { onFirstUse } from './IsolateCache.ts'
import { PRODUCTION_NAMES, pinnedOnMain } from './ProductionNames.ts'
import { AppDatabase, AppMedia } from './Resources.ts'
import { robotAgentRoutes } from './RobotAgent.ts'
import { makeTelegramConfig } from './telegram/Config.ts'
import { sweep } from './Sweep.ts'
import { flushIfDue } from './telegram/Deliver.ts'
import { telegramRoutes } from './telegram/Routes.ts'
import { walletRoutes } from './wallet/Routes.ts'
import { makeApprovalPort } from './world/Approve.ts'
import { makeWorldClient } from './world/Config.ts'
import { worldRoutes } from './world/Routes.ts'
import { makeWorldStub } from './world/Stub.ts'
import { makeObservabilityBase, metadataFromHeaders, withObservability } from '@ethmumbai/observability'

const Runtime = Layer.mergeAll(
  DomainLive,
  Cloudflare.Telemetry({ headSamplingRate: 1 }),
  Cloudflare.D1.QueryDatabaseBinding,
  Cloudflare.R2.ReadWriteBucketBinding,
)

export class ApiWorker extends Cloudflare.Worker<ApiWorker, Cloudflare.WorkerShape>()('Api') {}

export default ApiWorker.make(
  Effect.map(pinnedOnMain(PRODUCTION_NAMES.api), (pin) => ({
    main: import.meta.url,
    // Keep local workerd and deployed Workers on the same supported date; telemetry needs >= 2026-07-28.
    compatibility: { date: '2026-10-19' },
    workersDev: { enabled: false, previewsEnabled: false },
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: { enabled: true, invocationLogs: true },
      traces: { enabled: true, headSamplingRate: 1 },
    },
    ...pin,
  })),
  Effect.gen(function* () {
    const database = yield* Cloudflare.D1.QueryDatabase(AppDatabase)
    // The private media bucket: chip-signed scan crops (written by the chip's scan route, read by the owner and verify).
    const media = yield* Cloudflare.R2.ReadWriteBucket(AppMedia)
    // Bindings configured by the stack (including the web origin and secrets) exist only in the deployed request
    // runtime, not while Alchemy evaluates the Worker declaration during planning. Build the application on the
    // first request and reuse it for every later request in this isolate (styldappv2 726c7e6d).
    const application = yield* onFirstUse((env: Cloudflare.Workers.WorkerEnvironment['Service']) =>
      Effect.gen(function* () {
        const observabilityBase = yield* makeObservabilityBase({
          environment: env.APP_ENV,
          release: env.APP_RELEASE,
          component: 'server',
        }).pipe(Effect.orDie)
        // Only AUTH_ORIGIN and AUTH_SESSION_KEYS are fatal; feature secrets decode optionally (spec §10).
        const authOrigin: unknown = env.AUTH_ORIGIN
        if (typeof authOrigin !== 'string' || !URL.canParse(authOrigin)) {
          return yield* Effect.die(new Error('AUTH_ORIGIN binding is required'))
        }
        const sessionKeys = yield* decodeSessionKeyring(env.AUTH_SESSION_KEYS).pipe(Effect.orDie)
        const services = Context.make(AuthOrigin, relyingPartyFromOrigin(authOrigin)).pipe(
          Context.add(SessionAuth, yield* makeSessionAuth(database, sessionKeys)),
        )
        // One relayer (one nonce sequence), one approver and one Arc client per isolate, shared by every lane.
        const chain = yield* makeChainServices(database, env)
        const robotAgent = yield* robotAgentRoutes({
          database,
          media,
          env,
          origin: authOrigin,
          settlement: chain.settlement,
          approvals: makeApprovalPort({ database, enforcer: chain.enforcer, approver: chain.approver }),
        })
        const worldStub = yield* makeWorldStub(database, env, authOrigin)
        // Telegram notifications (spec §14): off, routes answering 503, until both APP_TELEGRAM_* secrets are set.
        const telegram = yield* makeTelegramConfig(env)
        const routes = Layer.mergeAll(
          authRoutes(database),
          robotAgent.layer,
          walletRoutes({
            database,
            arc: chain.arc,
            relayer: chain.relayer,
            enforcer: chain.enforcer,
            approver: chain.approverAddress,
            // The same media handle the scan route writes with; the owner reads observation crops through it.
            media: Option.some(media),
          }),
          worldRoutes({
            database,
            origin: authOrigin,
            // The rehearsal stub, when WORLD_ISSUER names it (world/Stub.ts); otherwise World IdP.
            world: Option.isSome(worldStub) ? Option.some(worldStub.value.client) : yield* makeWorldClient(env),
            approver: chain.approver,
            enforcer: chain.enforcer,
            errands: robotAgent.errands,
          }),
          Option.match(worldStub, { onNone: () => Layer.empty, onSome: ({ routes: stubRoutes }) => stubRoutes }),
          telegramRoutes({ database, config: telegram, world: { database, errands: robotAgent.errands } }),
          HttpRouter.add('GET', '/api/health', health(observabilityBase.release, features(env))),
        ).pipe(Layer.provide(AlchemyHttp.Platform))
        const handle = yield* HttpRouter.toHttpEffect(routes).pipe(Effect.orDie)
        // Sends queued notifications after the response (never during it); does nothing without news or config.
        const notify = Option.match(telegram, {
          onNone: () => Effect.void,
          onSome: (config) => flushIfDue({ database, origin: authOrigin, config }),
        })
        return {
          handle: Effect.provideContext(handle, services),
          observabilityBase,
          notify,
          sweep: sweep({ database, origin: authOrigin, telegram }),
        }
      }),
    )
    const fetch = Effect.gen(function* () {
      const env = yield* Cloudflare.Workers.WorkerEnvironment
      const { handle, observabilityBase, notify } = yield* application(env)
      const request = yield* HttpServerRequest
      const metadata = metadataFromHeaders(observabilityBase, request.headers)
      const response = yield* handle.pipe(withObservability('app.http', metadata))
      // The execution context is per event, so it is read here, never cached with the application.
      const execution = yield* Cloudflare.WorkerExecutionContext
      yield* execution.waitUntil(notify)
      return response
    })
    // Once a minute: expire errands and approvals nobody is looking at and send queued Telegram messages, so neither
    // waits for unrelated traffic. Same isolate-cached application as fetch; a failed sweep is logged, never fatal.
    yield* Cloudflare.Workers.cron('* * * * *', () =>
      Effect.gen(function* () {
        const env = yield* Cloudflare.Workers.WorkerEnvironment
        const app = yield* application(env)
        yield* app.sweep
      }),
    )
    return { fetch }
  }).pipe(Effect.provide(Layer.merge(Cloudflare.Workers.CronEventSourceLive, Runtime))),
)
