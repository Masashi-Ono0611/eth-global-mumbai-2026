/**
 * The scratch site's only server code: login-free, threaded comments on page elements, kept in D1 through Drizzle
 * (`schema.ts`, rules in `threads.ts`). Everything that is not `/api/comments…` is a static asset (Cloudflare serves
 * those before this Worker runs). There is no auth by choice: it is a team scratch site and its URL is in a public
 * repo, so anyone can post, change a thread's status, move or delete.
 *
 *   GET    /api/comments?page=<slug>      → Comment[]  (id, anchor, anchorText, name, body, createdAt, parentId,
 *                                                       status, statusBy, statusAt)
 *   GET    /api/comments.md?page=<slug>   → markdown for agents, open threads first, replies nested
 *   POST   /api/comments                  { page, anchor, anchorText?, name, body, parentId? } → 201 Comment
 *   PATCH  /api/comments/:id              { status, by } on a root, and/or { parentId: string | null } → 200 Comment
 *   DELETE /api/comments/:id              → 204, with every reply below it
 */
import { asMarkdown } from './markdown.ts'
import { commentStatuses, type CommentStatus } from './schema.ts'
import { Refused, createComment, deleteThread, listComments, setParent, setStatus } from './threads.ts'

interface Env {
  readonly DB: D1Database
}

const limits = { page: 64, anchor: 200, anchorText: 300, name: 60, body: 4096 } as const
const pagePattern = /^[a-z0-9_-]{1,64}$/
const idPattern = /^[0-9a-f-]{36}$/

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

const problem = (status: number, error: string) => json({ error }, status)

const readText = (value: unknown, max: number, required: boolean) => {
  if (typeof value !== 'string') return required ? undefined : ''
  const text = value.trim()
  if ((required && text.length === 0) || text.length > max) return undefined
  return text
}

/** `undefined` when absent, `null` to clear, an id otherwise; anything else is refused. */
const readParentId = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null) return value
  if (typeof value === 'string' && idPattern.test(value)) return value
  throw new Refused({ status: 400, message: 'parentId must be a comment id or null' })
}

const readObject = async (request: Request): Promise<Record<string, unknown>> => {
  const input: unknown = await request.json().catch(() => undefined)
  if (typeof input !== 'object' || input === null) throw new Refused({ status: 400, message: 'expected a JSON object' })
  // SAFETY: checked just above that `input` is a non-null object; every field is narrowed before use.
  return input as Record<string, unknown>
}

const required = <A>(value: A | undefined, message: string): A => {
  if (value === undefined) throw new Refused({ status: 400, message: message })
  return value
}

const create = async (request: Request, env: Env) => {
  const fields = await readObject(request)
  const parentId = readParentId(fields.parentId) ?? null
  const page = required(readText(fields.page, limits.page, true), 'page is required')
  if (!pagePattern.test(page)) throw new Refused({ status: 400, message: 'page must match [a-z0-9_-]{1,64}' })
  const comment = await createComment(env.DB, {
    page,
    parentId,
    // A reply inherits its parent's anchor, so it may omit one.
    anchor: required(readText(fields.anchor, limits.anchor, parentId === null), `anchor is required (≤ ${limits.anchor})`),
    anchorText: required(readText(fields.anchorText, limits.anchorText, false), `anchorText must be ≤ ${limits.anchorText}`),
    name: required(readText(fields.name, limits.name, true), `name is required (≤ ${limits.name})`),
    body: required(readText(fields.body, limits.body, true), `body is required (≤ ${limits.body})`),
  })
  return json(comment, 201)
}

const isStatus = (value: unknown): value is CommentStatus =>
  typeof value === 'string' && commentStatuses.some((status) => status === value)

const patch = async (request: Request, env: Env, id: string) => {
  const fields = await readObject(request)
  const parentId = readParentId(fields.parentId)
  if (fields.status === undefined && parentId === undefined) throw new Refused({ status: 400, message: 'send status and by, or parentId' })
  let comment = parentId === undefined ? undefined : await setParent(env.DB, id, parentId)
  if (fields.status !== undefined) {
    if (!isStatus(fields.status)) throw new Refused({ status: 400, message: `status must be one of ${commentStatuses.join(', ')}` })
    const by = required(readText(fields.by, limits.name, true), `by is required (≤ ${limits.name})`)
    comment = await setStatus(env.DB, id, fields.status, by)
  }
  return json(comment)
}

const read = async (url: URL, env: Env) => {
  const page = url.searchParams.get('page') ?? ''
  if (!pagePattern.test(page)) throw new Refused({ status: 400, message: 'page must match [a-z0-9_-]{1,64}' })
  const all = await listComments(env.DB, page)
  if (url.pathname === '/api/comments') return json(all)
  return new Response(asMarkdown(page, all), {
    headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' },
  })
}

const route = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url)
  if (url.pathname === '/api/comments' && request.method === 'POST') return create(request, env)
  if (url.pathname === '/api/comments' || url.pathname === '/api/comments.md') {
    return request.method === 'GET' ? read(url, env) : problem(405, 'method not allowed')
  }
  const id = /^\/api\/comments\/([0-9a-f-]{36})$/.exec(url.pathname)?.[1]
  if (id === undefined) return problem(404, 'not found')
  if (request.method === 'PATCH') return patch(request, env, id)
  if (request.method === 'DELETE') return (await deleteThread(env.DB, id), new Response(null, { status: 204 }))
  return problem(405, 'method not allowed')
}

export default {
  fetch: (request: Request, env: Env) =>
    route(request, env).catch((error: unknown) => {
      if (error instanceof Refused) return problem(error.status, error.message)
      console.error('comments: request failed', error)
      return problem(500, 'internal error')
    }),
}
