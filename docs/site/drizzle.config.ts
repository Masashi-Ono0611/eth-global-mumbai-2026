import { defineConfig } from 'drizzle-kit'

/** `bunx drizzle-kit generate` in docs/site writes the comments migrations that the site's D1 database applies. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './schema.ts',
  out: './migrations',
})
