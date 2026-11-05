import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import { Effect } from 'effect'

/**
 * The team's scratch site: docs/site's pages plus pinned visualization libraries, as an assets-only Worker with one
 * stable URL. Deployed by .github/workflows/site.yml on every push to main that touches docs/site.
 *
 * State lives in a named Cloudflare state store (`alchemy-state-store-ethmumbai`), not the account's shared default
 * store, so this project never touches other projects' Alchemy state.
 */
export default Alchemy.Stack(
  'EthMumbaiSite',
  { providers: Cloudflare.providers(), state: Cloudflare.state({ name: 'ethmumbai' }) },
  Effect.gen(function* () {
    const site = yield* Cloudflare.Website.StaticSite('Site', {
      name: 'eth-mumbai-site',
      command: 'bun build.ts',
      outdir: 'dist',
      memo: false,
      workersDev: true,
      compatibility: { date: '2026-10-19' },
    })
    return { url: site.url.as<string>() }
  }),
)
