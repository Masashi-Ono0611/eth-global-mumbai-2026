import { defineConfig } from 'oxfmt'

export default defineConfig({
  singleQuote: true,
  semi: false,
  printWidth: 120,
  ignorePatterns: [
    'bun.lock',
    '**/dist/**',
    '**/.alchemy/**',
    '**/.wrangler/**',
    '.agents/**',
    '.claude/**',
    // Team notes, brainstorm pages and reference pins, written by hand and by agents; not code.
    'docs/**',
    'references/**',
    'repos/**',
    // Foldkit's verbatim conventions, verified against repos/foldkit by vendor:check.
    'FOLDKIT.md',
    'tools/oxlint/anti-slop/**',
    // Pollen's vendored Microduck engine (hash-pinned) and the sim build copied into apps/web.
    'apps/sim/vendor/**',
    'apps/web/public/sim/**',
    // The landing page copied from docs/site/pitch (tools/copy-landing.ts).
    'apps/web/public/landing/**',
    'apps/web/public/media/**',
    'packages/i18n/catalogs/**',
  ],
})
