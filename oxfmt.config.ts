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
    'docs/research/**',
    'docs/migration/v1-inventory.json',
    'tools/oxlint/anti-slop/**',
    'packages/i18n/catalogs/**',
  ],
})
