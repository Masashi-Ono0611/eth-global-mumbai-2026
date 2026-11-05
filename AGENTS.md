# Styld v2

Read `docs/DELIVERY.md`, `docs/ARCHITECTURE.md` and `docs/STATUS.md` before substantial work. This is a full rewrite with v1 feature parity, not a demonstration or compatibility proxy.

## Ownership and workflow

Work on main. Commit each coherent green change using explicit paths. Preserve concurrent work. Never stash, reset, restore foreign edits, bypass hooks, or replace unfinished features with placeholders. Run expensive work through `heavy --wait`; retain real exit status. Follow the machine-wide instructions in the parent workspace.

Only isolated v2 Cloudflare resources and a workers.dev preview are authorized. Preserve v1, production DNS, mail records and provider resources. Do not copy production personal data into a public preview. Keep all secret values outside Git and tool output.

## Stack

Use exact manifest/lockfile pins: Bun, Effect 4, Alchemy v2, Foldkit, Yielded Auth, Drizzle SQLite/D1, Domain on Durable Objects, R2, native Cloudflare telemetry. Alchemy owns infrastructure. The single public origin serves pages, API, auth, media and MCP.

The `@yielded/effect-tsrs` gate checks TS and Effect. The editor uses pinned tsrs. Oxlint's type-aware backend is checksum-verified tsrs-lint with no fallback. Oxfmt formats. New code has zero lint debt. Keep anti-slop provenance, graph boundaries, suppression census, Knip and native runtime tests effective.

Read installed library source before using unfamiliar APIs. Domain models follow the pinned `.agents/skills/alchemy-domain` instructions. Record deviations from reference applications with reasons; do not inherit their product-specific approval or deployment policy.

## Architecture and testing

One authoritative writer for each invariant. Domain owns usage reservations and generation lifecycles; D1 owns ordinary relational entities. Typed application operations are shared by HTTP/MCP/jobs. Domain `decide`/`evolve` are pure. Durable reactions and provider calls have explicit idempotency and unknown-outcome handling.

Browser code imports contracts, never server adapters. Foldkit views are pure, updates emit named Commands, request state uses explicit schemas. Rendering receives locale, version, time zone and a stable reference time. Catalogs stay reviewed in Git.

Logs/spans omit tokens, signed URLs, prompts, images and raw user bodies. Native traces carry safe operation/release/correlation metadata; sampled telemetry is not the usage ledger.

Tests verify behavior, real storage semantics and public contracts. In-memory, native workerd, deployed preview and live-provider acceptance are different evidence levels. Every feature in the baseline must be mapped to v2 implementation and acceptance; test counts alone do not prove parity.

Before completion, run multiple reviewer rounds for architecture/tooling, security/privacy/durable behavior, and actual browser/product parity. Resolve findings, rerun final integration gates and verify the deployed release. Keep `docs/STATUS.md` factual and all unfinished requirements visible.
