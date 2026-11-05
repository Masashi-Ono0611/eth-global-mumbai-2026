# Styld rewrite tooling research

Snapshot: 2026-10-28. Read-only research; no Styld files, dependencies, deployments, or production resources changed.

## Release facts

- Upstream `tsrs` latest is `0.20.0` (2026-10-26), npm `tsrs@0.20.0-ts7.1.0-beta`, targeting TypeScript 7.1 beta. It changes defaults to tsgo-compatible checker behavior; `--fast` is now opt-in and may change diagnostics. It adds TS7.1 beta support, more platforms, LSP/tsdk improvements, and fixes.
- `@yielded/effect-tsrs` latest inspected is `0.2.2`. It combines TypeScript and Effect diagnostics in one Rust pass; current local projects pin it exactly after parity checks.
- `tsrs-lint` is not currently an npm package. The adopted release is `grmkris/tsrs` tag `lint-pr624-0acc433-regions.1`, published 2026-10-25, from oxc-project/tsrs PR 624 plus the per-project arena fix for issue 783. It exposes a headless backend through `OXLINT_TSGOLINT_PATH`.
- The upstream tsrs-lint PR #624 was still open at the research time. The fork is therefore a temporary, checksum-pinned bridge, not a permanent dependency assumption.

## Local adoption

- MyApps: `tsrs 0.18.0-ts7.1.0-dev.20260929`, `@yielded/effect-tsrs 0.2.2`, Oxlint 1.89, Oxfmt 0.74, Knip 6.42.1, jscpd 5.4.1, pinned tsrs-lint release. Combined TypeScript/Effect pass, checksum-verified lint backend, no fallback, shrinking baseline/census.
- Goblin: same tsrs/effect-tsrs/tsrs-lint architecture. Parity on 1,547 files: findings identical (5); tsrs-lint 26.4s vs stock 35.2s and 3.07 GiB vs 5.22 GiB process-tree peak.
- Swarmm: same architecture. Parity on 378 files: findings identical (0); 4.0s vs 9.8s and 1.70 GiB vs 3.05 GiB process-tree peak.
- MyApps: parity on 5,061 files: findings identical (1); fork reduced CPU and memory but wall time varied with load.
- Current Styld: tsrs `0.18.0...`, Oxlint `1.73`, `oxlint-tsgolint 0.24`, Oxfmt `0.58`, Ultracite scripts, no tsrs-lint pin and no effect-tsrs combined pass.
- Yielded Auth: tsrs `0.18.0...`, effect-tsrs `0.2.2`, Oxc/Oxfmt, and Effect-oriented checks.
- Potion Calendar: Effect tsgo and stock oxlint-tsgolint; useful Rat Stack/Alchemy reference but behind the newer local lint architecture.
- Foldkit references: Oxlint 1.88/1.89, Oxfmt, Foldkit plugin, Effect 4, TypeScript 7.0.2; no verified tsrs-lint adoption in the sampled clones.

## Quality architecture to carry forward

1. `tsrs` is the language server and TypeScript checker. For the rewrite, test `0.20.0` against TypeScript 7.1 beta and decide whether default-compatible mode or explicit `--fast` is acceptable. Pin it exactly.
2. `@yielded/effect-tsrs` is the single TypeScript + Effect diagnostic gate. Pin it exactly. Keep `@effect/tsgo` only for editor quick fixes until effect-tsrs provides equivalent LSP fixes.
3. Oxlint is the primary lint runner. Oxfmt owns formatting. Type-aware Oxlint rules use the checksum-verified tsrs-lint binary through `OXLINT_TSGOLINT_PATH`.
4. Do not install both stock `oxlint-tsgolint` and tsrs-lint as silent alternatives. A missing backend, unsupported platform, failed download, or checksum mismatch must fail loudly.
5. Use one `tools/tsrs-lint.ts` that maps OS/architecture to release assets, downloads to `$XDG_CACHE_HOME/tsrs-lint/<tag>/tsrs-lint`, verifies SHA-256 every time, and is used by CI, local gates, and editor configuration.
6. Run a parity fixture before changing pins: same command, same tree, compare normalized `(rule,file,line,column)` findings, and measure CPU/RSS. Keep the old pin if findings differ.
7. Keep `check:files <paths>` as the inner loop; `typecheck` and type-aware lint must use the owning tsconfig, not a broad wrong-project invocation.
8. Use shrinking baselines and per-directory promotion only for inherited debt. New rewrite code starts at zero findings. A baseline can only decrease; a suppression census ratchets down and requires a named reason for increases.
9. Add Knip, jscpd, graph/import boundaries, generated-file checks, agent/skill checks, schema/API snapshots, test floors, build/bundle budgets, and clean-tree checks as separate gates.
10. Treat `// SAFETY:` as documentation of an invariant, never as proof. Prefer Schema decoding or guards. Enforce no chained assertions, no widening-then-asserting, no module mocking, no reflection calls, unknown-return, no-floating-effects, and Effect tag/match discipline.

## Anti-slop policy

Vendor the selected anti-slop rules with upstream commit, license, file hashes, and a provenance document. Never edit vendored rules directly. Start with the proven set: safety comments for assertions, no chained assertions, no widening then asserting, no module mocking, no Reflect get/apply, Effect tag rules, and no manual tag comparison. Add project-specific rules only with a real canary and a measured zero-finding rollout.

Use a suppression census for `oxlint-disable`, `eslint-disable`, Effect off directives, `as any`, `as unknown as`, non-null assertions, and SAFETY comments. Require a specific reason for every accepted increase. Keep the unslop skill for prose/docs separate from code anti-slop.

## Skills and MCP setup

Canonical repository guidance: `AGENTS.md`; Claude links `.claude/skills`; source skills live in `.agents/skills`; `agents:check`/`repoagents` validates the setup. The new monorepo should copy only relevant skills and record provenance in `sources.json`.

Core skills to include/adapt:

- Effect 4 service/layer/schema/error discipline.
- Oxc quality and custom lint-rule workflow.
- Durable Objects and Workers best practices.
- Alchemy stages/deploy/prod cutover.
- Drizzle/DO schema ownership.
- Runtime tests with local workerd versus deployed dev evidence separated.
- Domain modeling and ADR discipline.
- MCP apps and OAuth/connector contract review.
- Observability/logging/telemetry.
- UI skills only for the actual Foldkit surface: frontend design, mobile-native, Apple web app, animation review, accessibility/polish.
- Thermo-nuclear correctness/maintainability review, unslop, and break-UI acceptance.

MCP configuration should keep project connectors explicit and non-secret. Relevant existing patterns are the Cloudflare MCP, MySI hub, Sentry, PostHog, Railway, Goblin/Swarmm project MCPs, and Foldkit Devtools MCP in the cloned Foldkit projects. Treat MCP configuration as repository metadata, keep disabled connectors disabled where host OAuth cannot complete, and run the agent configuration check after changes.

## Proposed new-monorepo gates

`bun run check` should be a deterministic composition of:

- format check (Oxfmt)
- agent/skill/provenance check
- graph and package boundary check
- `typecheck` via effect-tsrs (TS + Effect)
- Oxlint with verified tsrs-lint type-aware backend
- Knip configured and production mode
- duplicate-code check
- suppression/anti-slop census
- unit/integration tests and monotonic test floors
- generated schema/API/MCP snapshot checks
- build and bundle/Worker budgets
- local workerd acceptance, then separately deployed Cloudflare dev acceptance
- clean-tree and receipt/evidence validation

Keep `check:files` fast and scoped; run expensive full gates through the machine's `heavy` coordinator and retry exit 75 unchanged.

## Decision

Adopt the MyApps/Goblin/Swarmm quality architecture for the new Styld monorepo, with these updates:

- evaluate upstream tsrs 0.20.0 now rather than copying the old 0.18 pin;
- use effect-tsrs 0.2.2 as the combined checker baseline;
- use the pinned tsrs-lint fork until upstream publishes an equivalent release;
- retain `@effect/tsgo` for editor fixes only;
- vendor anti-slop rules with provenance and a shrinking suppression census;
- treat skills, MCP metadata, gates, receipts, and deployment evidence as first-class repository assets.
