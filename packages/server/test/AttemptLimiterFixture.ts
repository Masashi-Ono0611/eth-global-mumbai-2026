import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { passwordAttemptLimiter } from '@styld/auth/attempt-limiter'
import { Password } from '@yielded/auth'
import { Effect, Redacted, Result } from 'effect'

/** Exercise the same adapter as the application, with a fresh Layer per attempt. */
export const exerciseAttemptLimiter = (database: QueryDatabaseClient) =>
  Effect.gen(function* () {
    const before = yield* database.prepare('SELECT key FROM auth_attempt_buckets').all<{ key: string }>()
    const knownKeys = new Set(before.results.map((row) => row.key))
    const attempt = () =>
      Effect.gen(function* () {
        const limiter = yield* Password.PasswordAttemptLimiter
        yield* limiter.check({
          moduleId: 'native-concurrency',
          action: 'sign-in',
          scope: 'identifier',
          key: 'private-fixture@example.invalid',
          budget: { limit: 3, windowMillis: 60_000 },
        })
      }).pipe(
        Effect.provide(
          passwordAttemptLimiter(database.raw, Redacted.make('native-limiter-test-key-01234567890123456789')),
        ),
        Effect.result,
      )
    const results = yield* Effect.all(Array.from({ length: 12 }, attempt), { concurrency: 'unbounded' })
    const rows = yield* database
      .prepare('SELECT key, tokens FROM auth_attempt_buckets')
      .all<{ key: string; tokens: number }>()
    const bucket = rows.results.find((row) => !knownKeys.has(row.key))
    if (bucket === undefined) return yield* Effect.die(new Error('Missing test attempt bucket'))
    // Age only this test bucket against the database clock; no wall-clock sleeps.
    yield* database
      .prepare(
        "UPDATE auth_attempt_buckets SET tokens = 0.6, updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) - 12000 WHERE key = ?",
      )
      .bind(bucket.key)
      .run()
    const refilled = yield* attempt()
    const fraction = yield* database
      .prepare('SELECT tokens FROM auth_attempt_buckets WHERE key = ?')
      .bind(bucket.key)
      .first<{ tokens: number }>()
    yield* database.prepare('UPDATE auth_attempt_buckets SET expires_at = 0 WHERE key = ?').bind(bucket.key).run()
    const expired = yield* attempt()
    return {
      accepted: results.filter(Result.isSuccess).length,
      rejected: results.filter(Result.isFailure).length,
      keysAreDigests: rows.results.every((row) => /^[a-f0-9]{64}$/.test(row.key)),
      refilled: Result.isSuccess(refilled),
      fraction: fraction?.tokens,
      expired: Result.isSuccess(expired),
    }
  })
