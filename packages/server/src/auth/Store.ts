import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ChallengeKind } from '@ethmumbai/auth'
import { Effect, Schema } from 'effect'
import { changes, firstRow } from '../Sql.ts'

/** The D1 side of passkey auth: `auth_challenges`, `accounts` and `passkeys` (spec §3). Plain SQL; every row is decoded. */

const ChallengeRow = Schema.Struct({ account_id: Schema.NullOr(Schema.String), ref: Schema.NullOr(Schema.String) })

export const AccountRow = Schema.Struct({
  id: Schema.String,
  display_name: Schema.String,
  security_revision: Schema.String,
  smart_account: Schema.String,
})
export type AccountRow = typeof AccountRow.Type

const PasskeyRow = Schema.Struct({
  credential_id: Schema.String,
  account_id: Schema.String,
  x: Schema.String,
  y: Schema.String,
  sign_count: Schema.Number,
})
export type PasskeyRow = typeof PasskeyRow.Type

/** Stores a single-use challenge and prunes the ones that can no longer be spent. */
export const insertChallenge = (
  database: QueryDatabaseClient,
  row: {
    readonly id: string
    readonly kind: ChallengeKind
    readonly accountId: string | null
    readonly ref: string | null
    readonly expiresAt: number
    readonly now: number
    readonly nowMillis: number
  },
) =>
  database.batch([
    database.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').bind(row.now),
    database
      .prepare(
        'INSERT INTO auth_challenges (id, kind, account_id, ref, expires_at, used, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
      )
      .bind(row.id, row.kind, row.accountId, row.ref, row.expiresAt, row.nowMillis),
  ])

/** Spends a challenge exactly once: the conditional UPDATE is the race guard (a replay matches no row). */
export const consumeChallenge = (
  database: QueryDatabaseClient,
  input: { readonly id: string; readonly kind: ChallengeKind; readonly now: number },
) =>
  firstRow(
    database
      .prepare(
        'UPDATE auth_challenges SET used = 1 WHERE id = ? AND kind = ? AND used = 0 AND expires_at > ? RETURNING account_id, ref',
      )
      .bind(input.id, input.kind, input.now),
    ChallengeRow,
  )

export const findAccount = (database: QueryDatabaseClient, accountId: string) =>
  firstRow(
    database
      .prepare('SELECT id, display_name, security_revision, smart_account FROM accounts WHERE id = ?')
      .bind(accountId),
    AccountRow,
  )

export const findPasskey = (database: QueryDatabaseClient, credentialId: string) =>
  firstRow(
    database
      .prepare('SELECT credential_id, account_id, x, y, sign_count FROM passkeys WHERE credential_id = ?')
      .bind(credentialId),
    PasskeyRow,
  )

/** The account's passkey (one per account today): the key that signs its grants and revocations. */
export const accountPasskey = (database: QueryDatabaseClient, accountId: string) =>
  firstRow(
    database
      .prepare(
        'SELECT credential_id, account_id, x, y, sign_count FROM passkeys WHERE account_id = ? ORDER BY created_at LIMIT 1',
      )
      .bind(accountId),
    PasskeyRow,
  )

/** Inserts the account and its passkey atomically (a D1 batch is one transaction). */
export const createAccount = (
  database: QueryDatabaseClient,
  input: {
    readonly accountId: string
    readonly displayName: string
    readonly securityRevision: string
    readonly smartAccount: string
    readonly deploySalt: string
    readonly credentialId: string
    readonly alg: number
    readonly spki: string
    readonly x: string
    readonly y: string
    readonly signCount: number
    readonly nowMillis: number
  },
) =>
  database
    .batch([
      database
        .prepare(
          "INSERT INTO accounts (id, display_name, security_revision, smart_account, deploy_salt, deploy_status, created_at) VALUES (?, ?, ?, ?, ?, 'counterfactual', ?)",
        )
        .bind(
          input.accountId,
          input.displayName,
          input.securityRevision,
          input.smartAccount,
          input.deploySalt,
          input.nowMillis,
        ),
      database
        .prepare(
          'INSERT INTO passkeys (credential_id, account_id, alg, spki, x, y, sign_count, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          input.credentialId,
          input.accountId,
          input.alg,
          input.spki,
          input.x,
          input.y,
          input.signCount,
          input.nowMillis,
          Math.floor(input.nowMillis / 1000),
        ),
    ])
    .pipe(Effect.asVoid)

/** Moves the counter forward only from the value the assertion was verified against (a concurrent use loses). */
export const advanceSignCount = (
  database: QueryDatabaseClient,
  input: { readonly credentialId: string; readonly from: number; readonly to: number; readonly now: number },
) =>
  changes(
    database
      .prepare('UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE credential_id = ? AND sign_count = ?')
      .bind(input.to, input.now, input.credentialId, input.from),
  ).pipe(Effect.map((count) => count === 1))

/** A new security revision invalidates every session cookie of the account at once. */
export const rotateSecurityRevision = (database: QueryDatabaseClient, accountId: string, revision: string) =>
  database
    .prepare('UPDATE accounts SET security_revision = ? WHERE id = ?')
    .bind(revision, accountId)
    .run()
    .pipe(Effect.asVoid)
