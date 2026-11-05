import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const commentStatuses = ['open', 'resolved', 'accepted', 'rejected'] as const
export type CommentStatus = (typeof commentStatuses)[number]

/**
 * One comment on one element (`anchor`) of one page (`page`, the path slug). A reply points at the comment it answers
 * (`parentId`, any depth) and shares its root's anchor. `status` is meaningful on roots (threads); replies stay open.
 * Times are ISO strings.
 */
export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    page: text('page').notNull(),
    anchor: text('anchor').notNull(),
    anchorText: text('anchor_text').notNull(),
    name: text('name').notNull(),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
    parentId: text('parent_id'),
    status: text('status', { enum: commentStatuses }).notNull().default('open'),
    statusBy: text('status_by'),
    statusAt: text('status_at'),
  },
  (table) => [index('comments_page').on(table.page, table.createdAt), index('comments_parent').on(table.parentId)],
)
