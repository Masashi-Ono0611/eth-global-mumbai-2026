# docs/site — team scratch site

Shareable pages for the team (architecture, brainstorms, spikes), not product code.

**Live:** https://eth-mumbai-site.kristjan-grm11775.workers.dev — the index lists every page.

| Page | Source | Live |
| --- | --- | --- |
| Plan (generated from `docs/plan.md` by `docs/render-plan-page.py`) | `plan/index.html` | https://eth-mumbai-site.kristjan-grm11775.workers.dev/plan |
| Architecture | `architecture/index.html` | https://eth-mumbai-site.kristjan-grm11775.workers.dev/architecture/ |
| Story: the pitch in four screens (films: Qwen Image 3.0 Pro keyframes + Wan 3.0 loops, made in `~/code/vitaquack-film/`, not in Git) | `story/index.html`, `story/media/` | https://eth-mumbai-site.kristjan-grm11775.workers.dev/story/ |
| Pitch: the main presentation, vision first (everyone gets a robot; the key belongs on the robot; who holds what), then the proof (six real screens with their Arc and 0G transactions), the live demo and what's next. Films: the Open Duck Mini look, Qwen Image 3.0 Pro + Wan 3.0, made in `~/code/vitaquack-film/` | `pitch/index.html`, `pitch/media/` | https://eth-mumbai-site.kristjan-grm11775.workers.dev/pitch/ |
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

## Comments (`worker.ts`, D1 through Drizzle)

Login-free comments on page elements. Pages opt in with `<script src="/lib/comments.js" defer></script>`.
No auth, deliberately (Kris, 2026-11-05): it's a team scratch site, but its URL is in this public repo, so anyone
can post **and delete**. Schema: `schema.ts`; after changing it run `bunx drizzle-kit generate --name <what>` in
docs/site and commit the new folder under `migrations/` (applied by the D1 resource on deploy).

| Route | Auth | Result |
| --- | --- | --- |
| `GET /api/comments?page=<slug>` | none | `[{ id, anchor, anchorText, name, body, createdAt }]` |
| `GET /api/comments.md?page=<slug>` | none | Markdown grouped by anchor — the way for agents to read feedback |
| `POST /api/comments` `{ page, anchor, anchorText, name, body }` | none | 201 + the comment; 400 otherwise |
| `DELETE /api/comments/:id` | none | 204 / 404 |

Limits: page `[a-z0-9_-]{1,64}`, anchor ≤ 200, anchorText ≤ 300, name ≤ 60, body ≤ 4096. Bodies are stored as typed;
clients render them as text. Browser scripts in `lib/*.ts` are compiled by `build.ts` to `/lib/<name>.js`.

## Films and byte ranges

The asset layer answers a `Range` request with the whole file, and Safari on iPhone will not play an mp4 without a
206. So `/story/media/*` and `/pitch/media/*` run through `worker.ts` first (`assets.runWorkerFirst` in `alchemy.run.ts`), which slices
the asset from the `ASSETS` binding. Keep films small (H.264, silent, faststart, under 1 MB each).

## How it deploys

Alchemy owns it: `alchemy.run.ts` is the `EthMumbaiSite` stack — one Worker, `eth-mumbai-site` (static assets first, `worker.ts` for `/api/comments…`), a D1 database `CommentsDatabase`, on the
personal Cloudflare account (`bceaeae4788dce3493514fde194b4a7e`). `build.ts` writes `dist/` (pages, `/lib/`, the index).
`.github/workflows/site.yml` deploys on every push to `main` that touches `docs/site/**` (about a minute, no app gates).

State is in a **named** Alchemy state store, `alchemy-state-store-ethmumbai`, with its own secrets — never the
account's shared default `alchemy-state-store` (v7, used by other projects). Alchemy is pinned at beta.84 because
beta.85 bootstraps stores to v8.

## Deploy without pushing

`bun run site:deploy` (repo root, `CLOUDFLARE_API_TOKEN` in the environment, which any shell on the box has) deploys
the working copy as it is on disk, uncommitted edits included, in ~15 s. The next push to `main` that touches
docs/site redeploys `main`'s copy over it, so commit what you want to keep. One URL for everything: spikes and
brainstorms are just more pages.
