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
    'packages/i18n/catalogs/**',
  ],
})
