/**
 * Comment threads in D1: roots carry a status, replies point at the comment they answer (any depth) and share their
 * root's anchor. Every rule that keeps a page's tree consistent lives here; worker.ts only routes and validates input.
 */
import { asc, eq, sql } from 'drizzle-orm'
import { Data } from 'effect'
import { drizzle } from 'drizzle-orm/d1'
import { type CommentStatus, comments } from './schema.ts'

export type Comment = Omit<typeof comments.$inferSelect, 'page'>
type Row = typeof comments.$inferSelect

/** A request the store refuses; worker.ts answers it with this status and message. */
export class Refused extends Data.TaggedError('Refused')<{ readonly status: 400 | 404; readonly message: string }> {}

const columns = {
  id: comments.id,
  anchor: comments.anchor,
  anchorText: comments.anchorText,
  name: comments.name,
  body: comments.body,
  createdAt: comments.createdAt,
  parentId: comments.parentId,
  status: comments.status,
  statusBy: comments.statusBy,
  statusAt: comments.statusAt,
}

const withoutPage = ({ page: _page, ...comment }: Row): Comment => comment

export const listComments = (db: D1Database, page: string): Promise<Comment[]> =>
  drizzle(db)
    .select(columns)
    .from(comments)
    .where(eq(comments.page, page))
    .orderBy(asc(comments.createdAt), asc(comments.id))

const find = async (db: D1Database, id: string): Promise<Row> => {
  const [row] = await drizzle(db).select().from(comments).where(eq(comments.id, id))
  if (row === undefined) throw new Refused({ status: 404, message: 'no such comment' })
  return row
}

/** The comment a reply attaches to: it must exist on the same page. */
const parentOn = async (db: D1Database, page: string, parentId: string): Promise<Row> => {
  const parent = await find(db, parentId).catch(() => {
    throw new Refused({ status: 400, message: 'parentId must name an existing comment' })
  })
  if (parent.page !== page) throw new Refused({ status: 400, message: 'parentId must be on the same page' })
  return parent
}

export interface NewComment {
  readonly page: string
  readonly anchor: string
  readonly anchorText: string
  readonly name: string
  readonly body: string
  readonly parentId: string | null
}

/** A reply takes its parent's anchor, whatever the client sent. */
export const createComment = async (db: D1Database, input: NewComment): Promise<Comment> => {
  const parent = input.parentId === null ? undefined : await parentOn(db, input.page, input.parentId)
  const row: Row = {
    id: crypto.randomUUID(),
    page: input.page,
    anchor: parent?.anchor ?? input.anchor,
    anchorText: parent?.anchorText ?? input.anchorText,
    name: input.name,
    body: input.body,
    createdAt: new Date().toISOString(),
    parentId: parent?.id ?? null,
    status: 'open',
    statusBy: null,
    statusAt: null,
  }
  await drizzle(db).insert(comments).values(row)
  return withoutPage(row)
}

/** Ids of a comment and every reply below it. */
const subtree = async (db: D1Database, id: string): Promise<string[]> => {
  const rows = await drizzle(db).all<{ id: string }>(sql`
    WITH RECURSIVE tree(id) AS (
      SELECT id FROM comments WHERE id = ${id}
      UNION ALL SELECT comments.id FROM comments JOIN tree ON comments.parent_id = tree.id
    )
    SELECT id FROM tree`)
  return rows.map((row) => row.id)
}

export const setStatus = async (db: D1Database, id: string, status: CommentStatus, by: string): Promise<Comment> => {
  const row = await find(db, id)
  if (row.parentId !== null) throw new Refused({ status: 400, message: 'status belongs to a thread: set it on the root comment' })
  const changed = { status, statusBy: by, statusAt: new Date().toISOString() }
  await drizzle(db).update(comments).set(changed).where(eq(comments.id, id))
  return withoutPage({ ...row, ...changed })
}

/**
 * Moves a comment (and its replies) under another comment on the same page, or back to the top with `null`. A comment
 * cannot move below itself. The moved subtree takes the new parent's anchor.
 */
export const setParent = async (db: D1Database, id: string, parentId: string | null): Promise<Comment> => {
  const row = await find(db, id)
  const parent = parentId === null ? undefined : await parentOn(db, row.page, parentId)
  const moved = await subtree(db, id)
  if (parent !== undefined && moved.includes(parent.id)) throw new Refused({ status: 400, message: 'a comment cannot reply to itself' })
  const anchor = { anchor: parent?.anchor ?? row.anchor, anchorText: parent?.anchorText ?? row.anchorText }
  const replyFields = parent === undefined ? {} : { status: 'open' as const, statusBy: null, statusAt: null }
  await drizzle(db)
    .update(comments)
    .set({ parentId: parent?.id ?? null, ...anchor, ...replyFields })
    .where(eq(comments.id, id))
  for (const descendant of moved.filter((other) => other !== id))
    await drizzle(db).update(comments).set(anchor).where(eq(comments.id, descendant))
  return withoutPage({ ...row, parentId: parent?.id ?? null, ...anchor, ...replyFields })
}

/** Deleting a comment deletes the replies below it: a thread without its root has nothing to answer. */
export const deleteThread = async (db: D1Database, id: string): Promise<number> => {
  await find(db, id)
  const ids = await subtree(db, id)
  for (const doomed of ids) await drizzle(db).delete(comments).where(eq(comments.id, doomed))
  return ids.length
}
