import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import { Effect } from 'effect'

/** The app's public edge; the till forwards its /api/* calls there (worker.ts). */
const APP_ORIGIN = 'https://vitaquack.com'

/**
 * The merchant till: a separate small app (point of sale → x402 QR → signed status), its own stack and URL.
 * Deployed by .github/workflows/merchant.yml, or by hand with `bun run --cwd apps/merchant deploy`.
 * State: the project's named store (`alchemy-state-store-ethmumbai`), never the account's shared default store.
 */
export default Alchemy.Stack(
  'EthMumbaiMerchant',
  { providers: Cloudflare.providers(), state: Cloudflare.state({ name: 'ethmumbai' }) },
  Effect.gen(function* () {
    const till = yield* Cloudflare.Website.StaticSite('Till', {
      // Pinned, so a lost state adopts this Worker instead of minting a second one (docs/DEPLOYMENT.md, 6 Nov).
      name: 'eth-mumbai-merchant',
      // The till's public address (Kris, 6 Nov): a custom domain on the vitaquack.com zone; workers.dev stays on too.
      domain: 'cafe.vitaquack.com',
      command: 'vite build',
      outdir: 'dist',
      main: 'worker.ts',
      memo: false,
      env: { APP_ORIGIN },
      assets: { notFoundHandling: 'single-page-application' },
      workersDev: true,
      // Lets worker.ts fetch the app's workers.dev edge (same account): without it Cloudflare answers error 1042.
      compatibility: { date: '2026-10-19', flags: ['global_fetch_strictly_public'] },
    })
    return { url: till.url.as<string>() }
  }),
)
