/**
 * Copies the landing page (docs/site/pitch: index.html and media/) into apps/web/public, git-ignored like the
 * simulator's build in public/sim, so every apps/web build, ours and the one Alchemy reruns on deploy, puts it in the
 * edge's asset directory. The page goes to public/landing/index.html, not the root: Foldkit's build refuses a root
 * index.html it did not prerender. The edge answers `/` with that asset and serves `/media/*` itself, for byte ranges
 * (packages/server/src/EdgeLanding.ts). The page refers to its files only as relative `media/<name>`, which from `/`
 * is `/media/<name>`, so it is copied unchanged. Runs as `bun run build:landing`, part of `bun run build`.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dir, '..')
const source = path.join(root, 'docs/site/pitch')
const target = path.join(root, 'apps/web/public')
// Cloudflare refuses a static asset over 25 MiB, which would fail the whole deploy.
const assetLimit = 25 * 1024 * 1024

if (!existsSync(path.join(source, 'index.html'))) throw new Error(`landing: no page at ${source}/index.html`)
rmSync(path.join(target, 'landing'), { recursive: true, force: true })
rmSync(path.join(target, 'media'), { recursive: true, force: true })
mkdirSync(path.join(target, 'landing'))
cpSync(path.join(source, 'index.html'), path.join(target, 'landing', 'index.html'))
cpSync(path.join(source, 'media'), path.join(target, 'media'), {
  recursive: true,
  // Dotfiles are editor and transfer leftovers, never page files.
  filter: (file) => !path.basename(file).startsWith('.'),
})
const files = readdirSync(path.join(target, 'media'))
const oversized = files.filter((name) => statSync(path.join(target, 'media', name)).size > assetLimit)
if (oversized.length > 0) throw new Error(`landing: over the 25 MiB asset limit: ${oversized.join(', ')}`)
console.log(`landing: landing/index.html and ${files.length} media files → ${path.relative(root, target)}`)
