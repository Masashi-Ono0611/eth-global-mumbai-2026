import type { KnipConfig } from 'knip'

export default {
  workspaces: {
    '.': {
      entry: ['alchemy.run.ts!', 'tools/*.ts', 'tools/**/*.test.ts', '*.config.ts'],
      project: ['tools/**/*.ts', '*.ts'],
      // effect-tsrs embeds the plugin named by tsconfig; it is not a JS dependency.
      ignoreDependencies: ['@effect/language-service'],
    },
    'apps/web': {
      entry: ['src/entry.ts!', 'src/entry.server.ts!', 'test/**/*.test.ts'],
      project: ['src/**/*.ts', 'test/**/*.ts'],
    },
    ...Object.fromEntries(
      ['auth', 'domain', 'observability', 'server'].map((name) => [
        `packages/${name}`,
        { project: ['src/**/*.ts!', 'test/**/*.ts'] },
      ]),
    ),
    'packages/db': { project: ['src/**/*.ts!'] },
    'packages/i18n': { project: ['src/**/*.ts!'] },
    // The scratch site copies these libraries' browser bundles into dist/lib; nothing imports them.
    'docs/site': {
      entry: ['alchemy.run.ts!', 'build.ts!', 'worker.ts!', 'lib/*.ts!'],
      ignoreDependencies: ['chart.js', 'd3', 'mermaid', 'pele'],
    },
  },
  // Vendored source is checked byte-for-byte against its recorded upstream hash.
  ignore: ['tools/oxlint/anti-slop/**'],
} satisfies KnipConfig
