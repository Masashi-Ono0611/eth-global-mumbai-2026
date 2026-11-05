import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import { Config, Effect } from 'effect'
import { StyldMedia } from '@styld/server/Resources'
import StyldWorkerLive, { StyldWorker } from '@styld/server/StyldWorker'

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
    yield* StyldMedia
    const api = yield* StyldWorker
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
        AUTH_SECRET: yield* Config.Redacted('APP_AUTH_SECRET'),
        AUTH_SESSION_KEYS: yield* Config.Redacted('APP_AUTH_SESSION_KEYS'),
      },
    })
    return { url: edge.url.as<string>() }
  }).pipe(Effect.provide(StyldWorkerLive)),
)
