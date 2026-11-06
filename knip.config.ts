import type { KnipConfig } from 'knip'

export default {
  workspaces: {
    '.': {
      entry: ['alchemy.run.ts!', 'tools/*.ts', 'tools/**/*.test.ts', 'tools/evidence-uploader/main.ts!', '*.config.ts'],
      project: ['tools/**/*.ts', '*.ts'],
      // effect-tsrs embeds the plugin named by tsconfig; it is not a JS dependency. lefthook runs from .git/hooks,
      // which a fresh CI checkout doesn't have, so knip's lefthook plugin can't see it there.
      ignoreDependencies: ['@effect/language-service', 'lefthook'],
    },
    // The merchant till: Vite loads src/entry.ts from index.html; alchemy.run.ts and worker.ts deploy it.
    'apps/merchant': {
      entry: ['src/entry.ts!', 'alchemy.run.ts!', 'worker.ts!', 'test/**/*.test.ts'],
      project: ['src/**/*.ts!', 'test/**/*.ts', '*.ts'],
    },
    'apps/chip': { entry: ['src/main.ts!', 'test/**/*.test.ts'], project: ['src/**/*.ts!', 'test/**/*.ts'] },
    // The simulator page (Vite loads src/main from index.html); vendor/ is Pollen's vendored Microduck game code.
    'apps/sim': {
      entry: ['src/main.{ts,tsx}!'],
      project: ['src/**/*.{ts,tsx}!'],
      // Imported only by Pollen's vendored engine (vendor/microduck, outside the project); tailwindcss by styles.css.
      ignoreDependencies: ['@mujoco/mujoco', '@react-three/fiber', 'onnxruntime-web', 'zustand', 'tailwindcss'],
    },
    'apps/web': {
      entry: ['src/entry.ts!', 'src/entry.server.ts!', 'test/**/*.test.ts'],
      // tailwindcss is imported by styles.css (`@import 'tailwindcss'`), which Knip does not read.
      ignoreDependencies: ['tailwindcss'],
      project: ['src/**/*.ts!', 'test/**/*.ts'],
    },
    ...Object.fromEntries(
      ['auth', 'domain', 'observability', 'protocol'].map((name) => [
        `packages/${name}`,
        { project: ['src/**/*.ts!', 'test/**/*.ts'] },
      ]),
    ),
    'packages/chain': { entry: ['scripts/*.ts'], project: ['src/**/*.ts!', 'test/**/*.ts', 'scripts/*.ts'] },
    'packages/db': { project: ['src/**/*.ts!'] },
    'packages/server': { entry: ['scripts/*.ts'], project: ['src/**/*.ts!', 'test/**/*.ts', 'scripts/*.ts'] },
    'packages/i18n': { project: ['src/**/*.ts!'] },
    // The scratch site copies these libraries' browser bundles into dist/lib; nothing imports them.
    'docs/site': {
      entry: ['alchemy.run.ts!', 'build.ts!', 'worker.ts!', 'lib/*.ts!'],
      ignoreDependencies: ['chart.js', 'd3', 'mermaid', 'pele'],
    },
  },
  // Vendored source is checked byte-for-byte against its recorded upstream hash.
  // repos/ holds read-only upstream snapshots for agents (tools/vendored-repos.ts).
  ignore: ['tools/oxlint/anti-slop/**', 'repos/**'],
} satisfies KnipConfig
