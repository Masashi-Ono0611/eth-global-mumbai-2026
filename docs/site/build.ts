/**
 * Builds the team scratch site into `dist/`: every page folder under docs/site as-is, the pinned visualization
 * libraries under `/lib/`, and a generated index of the pages. No bundler, no framework: a page is one HTML file.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = import.meta.dir
const out = path.join(root, 'dist')

/** Library files served at `/lib/<name>`, read from this package's pinned dependencies (export maps hide `dist/`). */
const libraries: Record<string, string> = {
  'pele.js': 'pele/dist/pele.global.js',
  'mermaid.js': 'mermaid/dist/mermaid.min.js',
  'd3.js': 'd3/dist/d3.min.js',
  'chart.js': 'chart.js/dist/chart.umd.min.js',
}

/** Folders and files in docs/site that are tooling, not pages. */
const skip = new Set(['node_modules', 'dist', '.alchemy', 'lib', 'package.json', 'build.ts', 'alchemy.run.ts', 'worker.ts', 'base.ts', 'threads.ts', 'markdown.ts', 'schema.ts', 'drizzle.config.ts', 'migrations', 'README.md', 'tsconfig.json'])

/** Cloudflare's per-asset size limit. */
const assetLimit = 25 * 1024 * 1024

const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const titleOf = (html: string, fallback: string) => /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || fallback

rmSync(out, { recursive: true, force: true })
mkdirSync(path.join(out, 'lib'), { recursive: true })

for (const [name, specifier] of Object.entries(libraries)) {
  cpSync(path.join(root, 'node_modules', specifier), path.join(out, 'lib', name))
}
cpSync(path.join(root, 'lib'), path.join(out, 'lib'), { recursive: true, filter: (source) => !source.endsWith('.ts') })

// Browser scripts written in TypeScript (`lib/<name>.ts`) are served as `/lib/<name>.js`.
const scripts = readdirSync(path.join(root, 'lib'))
  .filter((name) => name.endsWith('.ts'))
  .map((name) => path.join(root, 'lib', name))
if (scripts.length > 0) {
  const result = await Bun.build({ entrypoints: scripts, outdir: path.join(out, 'lib'), target: 'browser', format: 'iife', minify: true })
  if (!result.success) throw new AggregateError(result.logs, 'site: lib/*.ts failed to build')
}

const pages: { slug: string; title: string }[] = []
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (skip.has(entry.name) || entry.name.startsWith('.')) continue
  // Dotfiles are editor and transfer leftovers (rsync's `.name.XXXXXX`); Cloudflare refuses assets over 25 MB, so a raw
  // phone video dropped into a page folder would fail the whole deploy. Both are skipped, the big ones with a warning.
  cpSync(path.join(root, entry.name), path.join(out, entry.name), {
    recursive: true,
    filter: (source) => {
      if (path.basename(source).startsWith('.')) return false
      const size = statSync(source).size
      if (size > assetLimit) {
        console.warn(`site: skipping ${path.relative(root, source)} (${Math.round(size / 1048576)} MB is over the 25 MB asset limit)`)
        return false
      }
      return true
    },
  })
  const page = path.join(root, entry.name, 'index.html')
  if (entry.isDirectory() && !entry.name.startsWith('_') && existsSync(page)) {
    pages.push({ slug: entry.name, title: titleOf(readFileSync(page, 'utf8'), entry.name) })
  }
}
pages.sort((a, b) => a.slug.localeCompare(b.slug))

const list = pages
  .map((p) => `<li><a href="/${p.slug}/">${escape(p.title)}</a> <code>/${p.slug}/</code></li>`)
  .join('\n      ')

writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ETH Global Mumbai 2026 — scratch</title>
    <link rel="stylesheet" href="/lib/base.css" />
  </head>
  <body>
    <main>
      <h1>ETH Global Mumbai 2026 — scratch</h1>
      <p>Brainstorms, spikes and architecture pages. Add one as <code>docs/site/&lt;name&gt;/index.html</code>
        (start from <a href="/_template/"><code>_template</code></a>) and push to <code>main</code>.</p>
      <ul>
      ${list}
      </ul>
      <p>Libraries: ${Object.keys(libraries)
        .map((name) => `<code>/lib/${name}</code>`)
        .join(', ')}, <code>/lib/base.css</code>.</p>
    </main>
  </body>
</html>
`,
)

console.log(`site: ${pages.length} pages, ${Object.keys(libraries).length} libraries → ${path.relative(process.cwd(), out)}`)
