/**
 * The type-aware lint backend: `tsrs-lint`, the Rust port of oxlint-tsgolint that the pinned `tsrs` package ships
 * (oxc-project/tsrs#624, since 0.21), verified by the lockfile's integrity hash like every other package. oxlint runs it
 * for the type-aware rules when `OXLINT_TSGOLINT_PATH` names it, which `bun run lint` (tools/oxlint.ts) and the checker
 * canaries do through `oxlintEnv()`; .vscode/settings.json gives the oxc extension the same path. A missing binary
 * fails the run: nothing falls back to oxlint-tsgolint, which is not installed.
 *
 * It runs with tsrs's default checker settings, the pinned TypeScript compiler's; the opt-in fast preset (`TSRS_FAST`)
 * is quicker but may change diagnostics, so it is not set.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

const tsrsLint = path.join(import.meta.dir, '..', 'node_modules', '.bin', 'tsrs-lint')

/** The environment oxlint runs with: `OXLINT_TSGOLINT_PATH` names the backend of the type-aware rules. */
export const oxlintEnv = (): NodeJS.ProcessEnv => {
  if (!existsSync(tsrsLint)) throw new Error(`tsrs-lint: ${tsrsLint} is missing; run bun install`)
  const { TSRS_FAST: _fast, ...env } = process.env
  return { ...env, OXLINT_TSGOLINT_PATH: tsrsLint }
}
