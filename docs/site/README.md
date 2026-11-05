# docs/site — team scratch site

Shareable pages for the team (architecture, brainstorms, spikes), not product code.

**Live:** https://eth-mumbai-site.kristjan-grm11775.workers.dev — the index lists every page.

| Page | Source | Live |
| --- | --- | --- |
| Architecture | `architecture/index.html` | https://eth-mumbai-site.kristjan-grm11775.workers.dev/architecture/ |
| Template | `_template/index.html` | https://eth-mumbai-site.kristjan-grm11775.workers.dev/_template/ |

## Add a page

Copy `_template/` to `docs/site/<name>/`, set its `<title>`, push to `main`. The index picks it up by itself
(folders starting with `_` are served but not listed). A page is one HTML file: no bundler, no framework.

## Libraries (self-hosted, pinned in `package.json`)

| URL | Package | Use |
| --- | --- | --- |
| `/lib/pele.js` | `pele` 1.13.0 | Mermaid syntax → themeable SVG, fast: `pele.mount(el, text)` |
| `/lib/mermaid.js` | `mermaid` 12.3.0 | Full Mermaid when Pele lacks a diagram type |
| `/lib/d3.js` | `d3` 7.9.2 | Custom visualizations |
| `/lib/chart.js` | `chart.js` 4.6.1 | Quick charts |
| `/lib/base.css` | `lib/base.css` | Shared light/dark look (`main`, `.card`) |

Add a library: add it to `package.json`, map its browser bundle in `build.ts` (`libraries`), and list it here.

## How it deploys

Alchemy owns it: `alchemy.run.ts` is the `EthMumbaiSite` stack — one assets-only Worker, `eth-mumbai-site`, on the
personal Cloudflare account (`bceaeae4788dce3493514fde194b4a7e`). `build.ts` writes `dist/` (pages, `/lib/`, the index).
`.github/workflows/site.yml` deploys on every push to `main` that touches `docs/site/**` (about a minute, no app gates).

State is in a **named** Alchemy state store, `alchemy-state-store-ethmumbai`, with its own secrets — never the
account's shared default `alchemy-state-store` (v7, used by other projects). Alchemy is pinned at beta.84 because
beta.85 bootstraps stores to v8.

Deploy by hand (from the repo root, `CLOUDFLARE_API_TOKEN` in the environment):

```sh
CLOUDFLARE_ACCOUNT_ID=bceaeae4788dce3493514fde194b4a7e bun run --cwd docs/site deploy
```
