/**
 * The scratch site's only server code: login-free comments on page elements, kept in D1 through Drizzle (`schema.ts`).
 * Everything that is not `/api/comments…` is a static asset (Cloudflare serves those before this Worker runs). There is
 * no auth by choice: it is a team scratch site and its URL is in a public repo, so anyone can post or delete.
 */
import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { comments } from './schema.ts'

interface Env {
  readonly DB: D1Database
}

type Comment = Omit<typeof comments.$inferSelect, 'page'>

const limits = { page: 64, anchor: 200, anchorText: 300, name: 60, body: 4096 } as const
const pagePattern = /^[a-z0-9_-]{1,64}$/

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const problem = (status: number, error: string) => json({ error }, status)

const columns = {
  id: comments.id,
  anchor: comments.anchor,
  anchorText: comments.anchorText,
  name: comments.name,
  body: comments.body,
  createdAt: comments.createdAt,
}

const listComments = (env: Env, page: string): Promise<Comment[]> =>
  drizzle(env.DB)
    .select(columns)
    .from(comments)
    .where(eq(comments.page, page))
    .orderBy(asc(comments.createdAt), asc(comments.id))

const asMarkdown = (page: string, thread: Comment[]) => {
  const byAnchor = new Map<string, Comment[]>()
  for (const comment of thread) byAnchor.set(comment.anchor, [...(byAnchor.get(comment.anchor) ?? []), comment])
  const sections = [...byAnchor.values()].map((anchored) => {
    const first = anchored[0]
    const heading = `## ${first?.anchorText || first?.anchor} \`#${first?.anchor}\``
    const items = anchored.map((c) => `- **${c.name}** (${c.createdAt}): ${c.body.replaceAll('\n', '\n  ')}`)
    return [heading, '', ...items].join('\n')
  })
  return `# Comments on /${page}/ (${thread.length})\n\n${sections.join('\n\n')}\n`
}

const readText = (value: unknown, max: number, required: boolean) => {
  if (typeof value !== 'string') return required ? undefined : ''
  const text = value.trim()
  if ((required && text.length === 0) || text.length > max) return undefined
  return text
}

const createComment = async (request: Request, env: Env) => {
  const input: unknown = await request.json().catch(() => undefined)
  if (typeof input !== 'object' || input === null) return problem(400, 'expected a JSON object')
  // SAFETY: checked just above that `input` is a non-null object; every field is narrowed by readText before use.
  const fields = input as Record<string, unknown>
  const page = readText(fields.page, limits.page, true)
  const anchor = readText(fields.anchor, limits.anchor, true)
  const anchorText = readText(fields.anchorText, limits.anchorText, false)
  const name = readText(fields.name, limits.name, true)
  const body = readText(fields.body, limits.body, true)
  if (page === undefined || !pagePattern.test(page)) return problem(400, 'page must match [a-z0-9_-]{1,64}')
  if (anchor === undefined) return problem(400, `anchor is required (≤ ${limits.anchor})`)
  if (anchorText === undefined) return problem(400, `anchorText must be ≤ ${limits.anchorText}`)
  if (name === undefined) return problem(400, `name is required (≤ ${limits.name})`)
  if (body === undefined) return problem(400, `body is required (≤ ${limits.body})`)
  const comment: Comment = { id: crypto.randomUUID(), anchor, anchorText, name, body, createdAt: new Date().toISOString() }
  await drizzle(env.DB).insert(comments).values({ ...comment, page })
  return json(comment, 201)
}

const deleteComment = async (env: Env, id: string) => {
  const deleted = await drizzle(env.DB).delete(comments).where(eq(comments.id, id)).returning({ id: comments.id })
  return deleted.length > 0 ? new Response(null, { status: 204 }) : problem(404, 'no such comment')
}

const handle = async (request: Request, env: Env) => {
  const url = new URL(request.url)
  const page = url.searchParams.get('page') ?? ''
  if (url.pathname === '/api/comments' || url.pathname === '/api/comments.md') {
    if (request.method === 'POST' && url.pathname === '/api/comments') return createComment(request, env)
    if (request.method !== 'GET') return problem(405, 'method not allowed')
    if (!pagePattern.test(page)) return problem(400, 'page must match [a-z0-9_-]{1,64}')
    const thread = await listComments(env, page)
    if (url.pathname === '/api/comments') return json(thread)
    return new Response(asMarkdown(page, thread), {
      headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  const deleting = /^\/api\/comments\/([0-9a-f-]{36})$/.exec(url.pathname)
  if (deleting?.[1] !== undefined) {
    return request.method === 'DELETE' ? deleteComment(env, deleting[1]) : problem(405, 'method not allowed')
  }
  return problem(404, 'not found')
}

export default {
  fetch: (request: Request, env: Env) =>
    handle(request, env).catch((error: unknown) => {
      console.error('comments: request failed', error)
      return problem(500, 'internal error')
    }),
}
