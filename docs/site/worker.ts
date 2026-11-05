/**
 * The scratch site's only server code: login-free comments on page elements, kept in D1. Everything that is not
 * `/api/comments…` is a static asset (Cloudflare serves those before this Worker runs). Writes and deletes need the
 * shared team code in `x-team-code`; reads are open, like the pages themselves.
 */
interface Env {
  readonly DB: D1Database
  readonly TEAM_CODE: string
}

interface CommentRow {
  readonly id: string
  readonly anchor: string
  readonly anchor_text: string
  readonly name: string
  readonly body: string
  readonly created_at: string
}

const limits = { page: 64, anchor: 200, anchorText: 300, name: 60, body: 4096 } as const
const pagePattern = /^[a-z0-9_-]{1,64}$/

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const problem = (status: number, error: string) => json({ error }, status)

const toComment = (row: CommentRow) => ({
  id: row.id,
  anchor: row.anchor,
  anchorText: row.anchor_text,
  name: row.name,
  body: row.body,
  createdAt: row.created_at,
})

/** Constant-time comparison, so the team code can't be guessed byte by byte from response timing. */
const sameCode = (given: string | null, expected: string) => {
  if (given === null || expected.length === 0) return false
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

const listComments = async (env: Env, page: string) => {
  const { results } = await env.DB.prepare(
    'SELECT id, anchor, anchor_text, name, body, created_at FROM comments WHERE page = ? ORDER BY created_at, id',
  )
    .bind(page)
    .all<CommentRow>()
  return results.map(toComment)
}

const asMarkdown = (page: string, comments: ReturnType<typeof toComment>[]) => {
  const byAnchor = new Map<string, ReturnType<typeof toComment>[]>()
  for (const comment of comments) byAnchor.set(comment.anchor, [...(byAnchor.get(comment.anchor) ?? []), comment])
  const sections = [...byAnchor.values()].map((thread) => {
    const first = thread[0]
    const heading = `## ${first?.anchorText || first?.anchor} \`#${first?.anchor}\``
    const items = thread.map((c) => `- **${c.name}** (${c.createdAt}): ${c.body.replaceAll('\n', '\n  ')}`)
    return [heading, '', ...items].join('\n')
  })
  return `# Comments on /${page}/ (${comments.length})\n\n${sections.join('\n\n')}\n`
}

const readText = (value: unknown, max: number, required: boolean) => {
  if (typeof value !== 'string') return required ? undefined : ''
  const text = value.trim()
  if ((required && text.length === 0) || text.length > max) return undefined
  return text
}

const createComment = async (request: Request, env: Env) => {
  if (!sameCode(request.headers.get('x-team-code'), env.TEAM_CODE)) return problem(401, 'team code required')
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
  const comment = { id: crypto.randomUUID(), anchor, anchorText, name, body, createdAt: new Date().toISOString() }
  await env.DB.prepare(
    'INSERT INTO comments (id, page, anchor, anchor_text, name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(comment.id, page, anchor, anchorText, name, body, comment.createdAt)
    .run()
  return json(comment, 201)
}

const deleteComment = async (request: Request, env: Env, id: string) => {
  if (!sameCode(request.headers.get('x-team-code'), env.TEAM_CODE)) return problem(401, 'team code required')
  const { meta } = await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run()
  return meta.changes > 0 ? new Response(null, { status: 204 }) : problem(404, 'no such comment')
}

const handle = async (request: Request, env: Env) => {
  const url = new URL(request.url)
  const page = url.searchParams.get('page') ?? ''
  if (url.pathname === '/api/comments' || url.pathname === '/api/comments.md') {
    if (request.method === 'POST' && url.pathname === '/api/comments') return createComment(request, env)
    if (request.method !== 'GET') return problem(405, 'method not allowed')
    if (!pagePattern.test(page)) return problem(400, 'page must match [a-z0-9_-]{1,64}')
    const comments = await listComments(env, page)
    if (url.pathname === '/api/comments') return json(comments)
    return new Response(asMarkdown(page, comments), {
      headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  const deleting = /^\/api\/comments\/([0-9a-f-]{36})$/.exec(url.pathname)
  if (deleting?.[1] !== undefined) {
    return request.method === 'DELETE' ? deleteComment(request, env, deleting[1]) : problem(405, 'method not allowed')
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
