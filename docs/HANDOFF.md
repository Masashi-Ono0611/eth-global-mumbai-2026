# Foundation handoff

The current scope is a verified foundation for another agent to continue. The user deferred design work because a redesign and further stack changes are coming. Do not continue the full product rewrite without carrying forward that scope decision. The original v1 parity objective remains unfinished; `docs/DELIVERY.md` is its acceptance matrix.

## Start here

- Repository: `/home/kristjan/code/styldappv2`, branch `main`. Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/STATUS.md` and `docs/DEPLOYMENT.md`.
- Frozen v1 reference: `/home/kristjan/code/stylelab` at `dddf9d44b656701282debd2ff88b343851145126`; file inventory and hashes are in `docs/migration/v1-inventory.json`.
- Independent application and upstream source reviews are in `docs/research/`. Exact package pins and the Domain export-map patch are in the manifest/lockfile and `docs/dependency-patches.md`.
- Isolated preview: https://styldappv2-styldedge-preview-vdqhe23kflepifq2.kristjan-grm11775.workers.dev. The latest accepted release and Cloudflare versions are recorded in `docs/STATUS.md`.

## What exists

One public edge Worker serves assets and routes to private API and Foldkit SSR Workers. Alchemy owns independent D1, R2 and Domain Durable Object resources. The web UI is deliberately small. En/sl catalogs preserve 2,296 reviewed messages each, with typed arguments, stable SSR/hydration context and pseudolocales.

Yielded Auth uses D1-backed stateful sessions with immediate revocation/account-disablement semantics and atomic password-attempt budgets. The browser supports password sign-in for seeded accounts, session persistence and sign-out. **This is not Styld's finished login experience:** there is no public signup, email OTP, Google sign-in or anonymous-account merge yet. Synthetic seed endpoints exist only in the native-test Worker and are never deployed to preview.

The Domain Wallet serializes credit grants, reservations and settlements, retains idempotency receipts and bounds pending holds. Generation orchestration, provider receipts, billing and external-effect reconciliation do not exist yet. Native restart coverage applies to the implemented wallet/session/R2 foundation, not future jobs or alarms.

Native Cloudflare logs/traces, release identity, bounded correlation metadata and query-string redaction are configured. Observability helpers have isolation/redaction tests and the preview has a prior native trace readback receipt. Browser telemetry ingestion, application metrics, alert delivery and production sampling/retention remain integration work; sampled telemetry must never become the billing ledger.

## Required checks

Run `bun install --frozen-lockfile`, then `heavy --wait bun run check`. On this shared box, exit 75 means slot contention; retry through `heavy --wait`. The GitHub workflow runs the same check on a hosted runner with Bun 1.4.2 and Node 24; committing that workflow is not evidence of a completed hosted CI run.

The full gate includes formatting, agent/skill provenance, generated i18n catalogs, workspace/browser dependency boundaries, an exact suppression census, negative checker fixtures, Effect/TypeScript diagnostics, checksum-verified typed Oxlint, Knip (normal and production), duplicate-code detection, unit tests, production build, native workerd/Chromium acceptance and bundle budgets. Canary files are temporary and removed after execution. No silent checker fallback is allowed.

`tools/suppressions.json` records four existing reasoned directives. Explicit `any` and non-null assertions fail the census. Additions need an explained code review; do not regenerate a larger allowance just to make a gate green. The duplicate gate excludes only vendor/generated data. Browser assets are limited to 256 KiB gzip in total; SSR source to 3 MiB. These are foundation budgets, to be consciously reviewed as product features land.

Knip recognizes Alchemy and Foldkit entrypoints explicitly. `tools/quality/graph.ts` checks package direction, export maps, declared workspace dependencies, cross-package relative imports and the transitive browser graph. Extend its policy when introducing an intentional package boundary. Avoid importing `@styld/auth`'s server barrel from browser code; use `/client` and `/config`.

The final review closed a graph-check bypass through JavaScript/TSX files. Source discovery and suppression auditing now cover TS, TSX, MTS, CTS, JS, JSX, MJS and CJS, including infrastructure. Browser traversal resolves local barrels and TypeScript implementations of JavaScript imports, rejects bare Node built-ins, and requires explicit source extensions when resolution is ambiguous. Filesystem fixtures exercise those cases through the complete checker.

## Next implementation work

Begin with identity parity: unified email OTP signup/login, Google, anonymous sessions and atomic merge, account lifecycle, then onboarding. Installed Yielded beta.46 source was inspected for `Email.makeCode`, `Email.makeRegistration`, proof storage and Drizzle/D1 adapters; no OTP implementation was started. Read those sources and validate the concrete proof/commit behavior before composing an adapter.

Then follow the parity matrix for wardrobe, Studio, outfits/scans, stylist, catalog, social/safety, billing, MCP and migration rehearsal. Preserve existing public paths, privacy/safety rules, stable IDs and provider restrictions. Complete provider-specific retry/unknown-outcome tests, schema/API/MCP compatibility checks and alert delivery as their owning capabilities land. These cannot be inferred from a foundation test count.

Production DNS, v1, mail records and provider resources remain outside the preview scope. No production personal data has been copied. Secrets stay in the ignored preview environment file and Worker bindings. Keep commits explicit and preserve concurrent edits.
