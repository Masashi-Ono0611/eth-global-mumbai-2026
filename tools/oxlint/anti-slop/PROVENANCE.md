# Provenance

Arrived with the foundation import from `styldappv2@370a0e23` (commit `f74e7ea`, 5 Nov 2026). The note it came with
says styldappv2 copied it from Goblin (`grmkris/goblin` `6faab2e6`, `tools/oxlint/anti-slop`), which vendors it as
follows.

Vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at commit
`c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (2026-09-10, package `oxlint-plugin-anti-slop` 0.1.2), MIT
(`LICENSE`, Copyright (c) 2026 Dillon Mulroy). Upstream expects you to copy `src/` into your repository and publishes
no npm release.

- Trimmed on 2026-10-04 to the rules `oxlint.config.ts` enables and the shared helpers they import. The two `index.ts`
  files list only the kept rules.
- Not copied: `scripts/`, `skills/`, `package.json`, the lockfile and the tests.
- Upstream builds against `@oxlint/plugins` 1.78.0. Here it runs on the repository's pin (see the root `package.json`).
- Oxlint, oxfmt, knip and jscpd ignore it and `tsconfig.json` excludes it, because it is upstream code.

The SHA-256 of every file here, this one included, is in [`tools/provenance.json`](../../provenance.json), and
`bun run provenance:check` (also in the pre-commit hook) fails when a file no longer matches. To update, review the
upstream diff at a specific commit, copy the kept rules again and refresh their entries in `tools/provenance.json`.
