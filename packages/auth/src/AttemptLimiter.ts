import { Password } from '@yielded/auth'
import { Effect, Layer, Redacted, Schema } from 'effect'
import type * as D1Client from '@effect/sql-d1/D1Client'

// @effect-diagnostics-next-line unstableApiUsage:off -- The pinned Effect D1 adapter defines the native Worker database binding.
export type D1Source<R = never> = Effect.Effect<D1Client.D1ClientConfig['db'], never, R>

const encoder = new TextEncoder()
const databaseNow = "CAST(unixepoch('subsec') * 1000 AS INTEGER)"
// D1 serializes this single conditional write across Workers. A rejected attempt
// does not debit below zero; expiry means the bucket has had time to refill fully.
const consume = `
INSERT INTO auth_attempt_buckets (key, tokens, updated_at, expires_at)
VALUES (?, ? - 1, ${databaseNow}, ${databaseNow} + ?)
ON CONFLICT(key) DO UPDATE SET
  tokens = min(?, auth_attempt_buckets.tokens + max(0, excluded.updated_at - auth_attempt_buckets.updated_at) * 1.0 * ? / ?) - 1,
  updated_at = max(excluded.updated_at, auth_attempt_buckets.updated_at),
  expires_at = max(excluded.expires_at, auth_attempt_buckets.expires_at)
WHERE min(?, auth_attempt_buckets.tokens + max(0, excluded.updated_at - auth_attempt_buckets.updated_at) * 1.0 * ? / ?) >= 1
RETURNING key`
const cleanup = `DELETE FROM auth_attempt_buckets WHERE key IN (
  SELECT key FROM auth_attempt_buckets WHERE expires_at <= ${databaseNow} ORDER BY expires_at LIMIT 64
)`

export const passwordAttemptLimiter = <R>(raw: D1Source<R>, secret: Redacted.Redacted) =>
  Layer.effect(
    Password.PasswordAttemptLimiter,
    Effect.gen(function* () {
      const db = yield* raw
      const key = yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.importKey(
            'raw',
            encoder.encode(Redacted.value(secret)),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign'],
          ),
        catch: () => Password.PasswordUnavailable.make({}),
      })
      return Password.PasswordAttemptLimiter.of({
        check: Effect.fn('EthMumbai.Auth.limitPasswordAttempts')(function* (input) {
          const budget = yield* Schema.decodeUnknownEffect(Password.PasswordAttemptPolicy.fields.identifier)(
            input.budget,
          ).pipe(Effect.mapError(() => Password.PasswordUnavailable.make({})))
          const digest = yield* Effect.tryPromise({
            try: () =>
              crypto.subtle.sign(
                'HMAC',
                key,
                encoder.encode(
                  JSON.stringify([
                    'ethmumbai/password-attempt/v1',
                    input.moduleId,
                    input.action,
                    input.scope,
                    input.key,
                  ]),
                ),
              ),
            catch: () => Password.PasswordUnavailable.make({}),
          })
          const bucket = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
          const result = yield* Effect.tryPromise({
            try: () =>
              db.batch([
                db.prepare(cleanup),
                db
                  .prepare(consume)
                  .bind(
                    bucket,
                    budget.limit,
                    budget.windowMillis,
                    budget.limit,
                    budget.limit,
                    budget.windowMillis,
                    budget.limit,
                    budget.limit,
                    budget.windowMillis,
                  ),
              ]),
            catch: () => Password.PasswordUnavailable.make({}),
          })
          if (!result.every((part) => part.success)) return yield* Password.PasswordUnavailable.make({})
          if (result[1]?.results.length !== 1) return yield* Password.PasswordRejected.make({})
        }),
      })
    }),
  )
