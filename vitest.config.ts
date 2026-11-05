import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['**/*.native.test.ts', '**/node_modules/**'],
    maxWorkers: 2,
    testTimeout: 10000,
    restoreMocks: true,
  },
})
