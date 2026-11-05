# docs/site

Shareable pages for the team, not product code.

| Page | Source | Live |
| --- | --- | --- |
| Architecture | `architecture/index.html` | https://eth-mumbai-architecture.kristjan-grm11775.workers.dev |

The live page is the Cloudflare Worker `eth-mumbai-architecture` (account `Kristjan.grm1@gmail.com's Account`).
It serves `architecture/index.html` straight from `main` on GitHub with a 60 s cache (and GitHub raw caches up to 5 min), so pushing to
`main` updates it within ~5 minutes, with no redeploy. It was created by hand through the Cloudflare API, **not** by
Alchemy, so it isn't part of the app's infrastructure. Delete it when the app's own pages replace it.
Diagrams are Mermaid text rendered by [Pele](https://github.com/obsidianmd/pele) (`pele@1.13.0` from jsDelivr, MIT), themed through `--pele-*` CSS variables. Clone for reading: `references/obsidianmd_pele`.
