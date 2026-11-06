import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import { Config, Effect, Redacted } from 'effect'
import { AppMedia } from '@ethmumbai/server/Resources'
import ApiWorkerLive, { ApiWorker } from '@ethmumbai/server/ApiWorker'

const PENDING = 'pending'
const plain = (name: string) => Config.String(name).pipe(Config.withDefault(PENDING))
const secret = (name: string) => Config.Redacted(name).pipe(Config.withDefault(Redacted.make(PENDING)))

/**
 * The app: public edge Worker (SSR website + API behind it), D1 and R2. `.github/workflows/check.yml` deploys stage
 * `main` on every green push to main. State lives in the named Cloudflare state store `alchemy-state-store-ethmumbai`
 * (shared with the scratch site in docs/site), never the personal account's shared default store. The edge Worker's
 * stable URL is the only output used by acceptance tests.
 */
export default Alchemy.Stack(
  'EthMumbai',
  { providers: Cloudflare.providers(), state: Cloudflare.state({ name: 'ethmumbai' }) },
  Effect.gen(function* () {
    const release = yield* Config.String('APP_RELEASE')
    // Stage `main` is the live deploy; `local` is `alchemy dev`; any other stage is a preview.
    const stage = yield* Alchemy.Stage
    const environment = stage === 'main' ? 'production' : stage === 'local' ? 'local' : 'preview'
    // The stack owns the media bucket even while no Worker serves media yet.
    yield* AppMedia
    const api = yield* ApiWorker
    const website = yield* Cloudflare.Website.Foldkit('Website', {
      rootDir: 'apps/web',
      env: { VITE_APP_ENV: environment, VITE_APP_RELEASE: release },
      compatibility: { date: '2026-10-19' },
      observability: {
        enabled: true,
        redactQueryString: true,
        logs: { enabled: true, invocationLogs: true },
        traces: { enabled: true, headSamplingRate: 1 },
      },
      workersDev: { enabled: false, previewsEnabled: false },
    })
    const edge = yield* Cloudflare.Worker('Edge', {
      main: 'packages/server/src/EdgeWorker.ts',
      env: { API: api, WEBSITE: website },
      // Service-binding fetch enters the SSR handler without the website's
      // public asset router. Serve the same build's files at the public edge.
      assets: { directory: 'apps/web/dist/client' },
      compatibility: { date: '2026-10-19' },
      workersDev: true,
      observability: {
        enabled: true,
        redactQueryString: true,
        logs: { enabled: true, invocationLogs: true },
        traces: { enabled: true, headSamplingRate: 1 },
      },
    })
    // The env seam unwraps Redacted values into secret_text. Raw binding
    // descriptors require strings and must never receive Config objects.
    yield* api.bind('RuntimeConfiguration', {
      env: {
        AUTH_ORIGIN: edge.url,
        APP_ENV: environment,
        APP_RELEASE: release,
        AUTH_SESSION_KEYS: yield* Config.Redacted('APP_AUTH_SESSION_KEYS'),
        // Feature bindings (spec §10). The Worker decodes each optionally: until a real value replaces the `pending`
        // placeholder, only that feature's routes answer 503 "not configured: <name>"; the deploy never breaks on them.
        RELAYER_PRIVATE_KEY: yield* secret('APP_RELAYER_PRIVATE_KEY'),
        APPROVER_PRIVATE_KEY: yield* secret('APP_APPROVER_PRIVATE_KEY'),
        GATE_ED25519_SEED: yield* secret('APP_GATE_ED25519_SEED'),
        ARC_RPC_URL: yield* secret('APP_ARC_RPC_URL'),
        ZG_API_KEY: yield* secret('APP_ZG_API_KEY'),
        ZG_BASE_URL: yield* plain('APP_ZG_BASE_URL'),
        ZG_MODEL: yield* plain('APP_ZG_MODEL'),
        ZG_EXTRA_JSON: yield* plain('APP_ZG_EXTRA_JSON'),
        WORLD_CLIENT_ID: yield* plain('APP_WORLD_CLIENT_ID'),
        WORLD_CLIENT_SECRET: yield* secret('APP_WORLD_CLIENT_SECRET'),
        WORLD_ISSUER: yield* plain('APP_WORLD_ISSUER'),
        // Rehearsal-only issuer key (world/Stub.ts), used only while APP_WORLD_ISSUER is $AUTH_ORIGIN/api/dev/world.
        WORLD_STUB_JWK: yield* secret('APP_WORLD_STUB_JWK'),
        ENFORCER_ADDRESS: yield* plain('APP_ENFORCER_ADDRESS'),
        EPISODE_LOG_ADDRESS: yield* plain('APP_EPISODE_LOG_ADDRESS'),
        EVIDENCE_TOKEN: yield* secret('APP_EVIDENCE_TOKEN'),
        MERCHANT_PAY_TO: yield* plain('APP_MERCHANT_PAY_TO'),
        RESTRICTED_PAY_TO: yield* plain('APP_RESTRICTED_PAY_TO'),
      },
    })
    return { url: edge.url.as<string>() }
  }).pipe(Effect.provide(ApiWorkerLive)),
)
