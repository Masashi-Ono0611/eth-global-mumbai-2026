import * as Cloudflare from '@alchemy.run/cloudflare'
import * as AlchemyHttp from 'alchemy/Http'
import { decodeSessionKeyring, relyingPartyFromOrigin } from '@ethmumbai/auth'
import { Context, Effect, Layer } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import { AuthOrigin } from './auth/Origin.ts'
import { authRoutes } from './auth/Routes.ts'
import { makeSessionAuth, SessionAuth } from './auth/Session.ts'
import { makeChainServices } from './chain/Services.ts'
import { DomainLive } from './DomainLive.ts'
import { health } from './Health.ts'
import { onFirstUse } from './IsolateCache.ts'
import { AppDatabase } from './Resources.ts'
import { noApprovals } from './robot/Errands.ts'
import { robotAgentRoutes } from './RobotAgent.ts'
import { makeObservabilityBase, metadataFromHeaders, withObservability } from '@ethmumbai/observability'

const Runtime = Layer.mergeAll(
  DomainLive,
  Cloudflare.Telemetry({ headSamplingRate: 1 }),
  Cloudflare.D1.QueryDatabaseBinding,
)

export class ApiWorker extends Cloudflare.Worker<ApiWorker, Cloudflare.WorkerShape>()('Api') {}

export default ApiWorker.make(
  {
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
  },
  Effect.gen(function* () {
    const database = yield* Cloudflare.D1.QueryDatabase(AppDatabase)
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
          env,
          origin: authOrigin,
          settlement: chain.settlement,
          approvals: noApprovals,
        })
        const routes = Layer.mergeAll(
          authRoutes(database),
          robotAgent.layer,
          HttpRouter.add('GET', '/api/health', health(observabilityBase.release)),
        ).pipe(Layer.provide(AlchemyHttp.Platform))
        const handle = yield* HttpRouter.toHttpEffect(routes).pipe(Effect.orDie)
        return { handle: Effect.provideContext(handle, services), observabilityBase }
      }),
    )
    const fetch = Effect.gen(function* () {
      const env = yield* Cloudflare.Workers.WorkerEnvironment
      const { handle, observabilityBase } = yield* application(env)
      const request = yield* HttpServerRequest
      const metadata = metadataFromHeaders(observabilityBase, request.headers)
      return yield* handle.pipe(withObservability('app.http', metadata))
    })
    return { fetch }
  }).pipe(Effect.provide(Runtime)),
)
