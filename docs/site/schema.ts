import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** One comment on one element (`anchor`) of one page (`page`, the path slug). Times are ISO strings. */
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
  },
  (table) => [index('comments_page').on(table.page, table.createdAt)],
)
