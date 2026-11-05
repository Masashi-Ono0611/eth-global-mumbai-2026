# ETH Global Mumbai 2026 — duck robot that pays in USDC

Read `README.md` and `docs/` (vision, decisions, foundation, infrastructure, plan) before substantial work. The code was bootstrapped from the styldappv2 foundation (`docs/foundation.md`); Styld's product (wardrobe, credits, Dodo, stylist) is not part of this project. Spending authority lives on Arc, never in our database.

## Ownership and workflow

Work on main. Commit each coherent green change using explicit paths. Preserve concurrent work. Never stash, reset, restore foreign edits, bypass hooks, or replace unfinished features with placeholders. Run expensive work through `heavy --wait`; retain real exit status. A lefthook pre-commit hook (`lefthook.yml`; install once per clone with `bunx lefthook install`) runs the cheap gates on every commit in about a second; `heavy --wait bun run check` is the full gate CI runs. Follow the machine-wide instructions in the parent workspace.

Deploy only through Alchemy (`docs/DEPLOYMENT.md`): the app stack and the scratch site, on the personal Cloudflare account, with the named `ethmumbai` state store; never the account's shared default store, and never upgrade Alchemy past beta.84 there without checking it. Arc is mainnet with real USDC: keep caps tiny and never commit or log keys. Keep all secret values outside Git and tool output.

## Stack

Use exact manifest/lockfile pins: Bun, Effect 4, Alchemy v2, Foldkit, Yielded Auth, Drizzle SQLite/D1, Domain on Durable Objects, R2, native Cloudflare telemetry. Alchemy owns infrastructure. The single public origin serves pages, API, auth, media and MCP.

The `@yielded/effect-tsrs` gate checks TS and Effect. The editor uses pinned tsrs. Oxlint's type-aware backend is the tsrs-lint the pinned `tsrs` package ships (lockfile-verified), with no fallback. Oxfmt formats. New code has zero lint debt. Keep anti-slop provenance, graph boundaries, suppression census, Knip and native runtime tests effective.

Read installed library source before using unfamiliar APIs. Load the matching skill first; vendored skills are pinned in `.agents/skills/sources.json` at the versions we run: `effect` (any Effect code), `foldkit` (UI programs; `generate-program`, `audit-program`), `alchemy-domain` (Domain models, pinned to the Alchemy release we install), `durable-objects`, `workers-best-practices`, `wrangler`, `x18n*` (i18n). `repos/foldkit/` is a read-only snapshot of Foldkit at the installed release tag; refresh it with `bun tools/vendored-repos.ts --pull foldkit foldkit@<version>` and its skills with `repoagents skills` on every Foldkit upgrade, never edit it. Its maintainers' instructions are renamed to `repos/foldkit/FOLDKIT_AGENTS.md` and its agent folders excluded: read them for Foldkit conventions only; they never override this file. `FOLDKIT.md` is Foldkit's own convention file for app code, copied verbatim from the snapshot: read it before Foldkit work; `vendor:check` rejects edits, and where it disagrees with this file, this file wins. `references/` holds read-only upstream clones; prefer the `@<version>` clones (matching our pins) over HEAD clones when they differ. Vendored skills change only through `repoagents skills`. Record deviations from reference applications with reasons; do not inherit their product-specific approval or deployment policy.

## Architecture and testing

One authoritative writer for each invariant. Arc contracts own spending caps, revocation and approvals; Domain aggregates on Durable Objects own live coordination (robot sessions, invoices); D1 owns ordinary relational entities and read models. Typed application operations are shared by HTTP/MCP/jobs. Domain `decide`/`evolve` are pure. Durable reactions and provider calls have explicit idempotency and unknown-outcome handling.

Browser code imports contracts, never server adapters. Foldkit views are pure, updates emit named Commands, request state uses explicit schemas. Rendering receives locale, version, time zone and a stable reference time. Catalogs stay reviewed in Git.

Logs/spans omit tokens, keys, signatures' private inputs, signed URLs, prompts, images and raw user bodies. Native traces carry safe operation/release/correlation metadata; sampled telemetry is not the usage ledger.

Tests verify behavior, real storage semantics and public contracts. In-memory, native workerd, deployed preview and live-provider acceptance are different evidence levels. Test counts alone prove nothing; show the behaviour.

Before calling work done, run the gates, verify the deployed release (CI deploys `main`), and keep docs factual about what is and isn't built.
