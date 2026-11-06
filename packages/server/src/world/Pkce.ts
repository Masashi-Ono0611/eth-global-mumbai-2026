import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Clock, Effect, Option, Redacted, Schema } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'
import { nowSeconds, randomBytes } from '../Respond.ts'
import { allRows } from '../Sql.ts'
import { type ApprovalRow, closesAt } from './Approve.ts'

/** RFC 7636 `S256`: base64url (no padding) of the SHA-256 of the verifier's ASCII bytes. */
export const pkceChallenge = (verifier: string) =>
  Effect.promise(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).pipe(
    Effect.map((digest) => Base64Url.encode(new Uint8Array(digest))),
  )

/**
 * A fresh 32-byte verifier for one authorize attempt, kept in `auth_challenges` (kind `world_pkce`, ref = the approval)
 * until the approval closes; returns its `S256` challenge for the authorize URL. The verifier itself only ever goes to
 * the token endpoint, never to a log or the browser.
 */
export const startPkce = Effect.fn('EthMumbai.World.startPkce')(function* (
  database: QueryDatabaseClient,
  row: ApprovalRow,
) {
  const verifier = Base64Url.encode(yield* randomBytes(32))
  yield* database
    .prepare(
      "INSERT INTO auth_challenges (id, kind, account_id, ref, expires_at, used, created_at) VALUES (?, 'world_pkce', ?, ?, ?, 0, ?)",
    )
    .bind(verifier, row.account_id, row.id, closesAt(row), yield* Clock.currentTimeMillis)
    .run()
  return yield* pkceChallenge(verifier)
})

const Attempt = Schema.Struct({ id: Schema.String, created_at: Schema.Finite })

/**
 * Spends every open verifier of this approval and returns the latest attempt's: its code is the one coming back (the
 * approval's `state` is per approval, so an older tab's code then fails at the token endpoint and the approval is
 * denied, never signed). None when the approval was never opened here or its window closed.
 */
export const takeVerifier = Effect.fn('EthMumbai.World.takeVerifier')(function* (
  database: QueryDatabaseClient,
  approvalId: string,
) {
  const attempts = yield* allRows(
    database
      .prepare(
        "UPDATE auth_challenges SET used = 1 WHERE kind = 'world_pkce' AND ref = ? AND used = 0 AND expires_at > ? RETURNING id, created_at",
      )
      .bind(approvalId, yield* nowSeconds),
    Attempt,
  )
  const latest = attempts.reduce<Option.Option<typeof Attempt.Type>>(
    (best, attempt) =>
      Option.isSome(best) && best.value.created_at >= attempt.created_at ? best : Option.some(attempt),
    Option.none(),
  )
  return Option.map(latest, ({ id }) => Redacted.make(id))
})
