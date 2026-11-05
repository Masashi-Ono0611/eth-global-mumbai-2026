import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  securityRevision: text('security_revision').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const authAttemptBuckets = sqliteTable(
  'auth_attempt_buckets',
  {
    key: text('key').primaryKey().notNull(),
    tokens: real('tokens').notNull(),
    updatedAt: integer('updated_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('auth_attempt_buckets_expiry').on(table.expiresAt)],
)

export const appSchema = { accounts, authAttemptBuckets }
