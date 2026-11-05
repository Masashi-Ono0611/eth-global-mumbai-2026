import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { AppAuth } from '@ethmumbai/auth/storage'
import { Password } from '@yielded/auth'
import * as WorkerdServices from '@yielded/auth/WorkerdServices'
import { Clock, Effect, Redacted } from 'effect'

/** Test-only fixture; this module is never imported by an application entrypoint. */
export const seedIdentity = (database: QueryDatabaseClient, id = 'native-identity') =>
  Effect.gen(function* () {
    const hashing = yield* Password.PasswordHashing
    const now = yield* Clock.currentTimeMillis
    const verifier = yield* hashing.hash(Redacted.make('native-identity-password-52'))
    const moduleId = AppAuth.strategies.password.persistence.moduleId
    yield* database.batch([
      database
        .prepare(
          'INSERT INTO accounts (id, enabled, security_revision, display_name, created_at) VALUES (?, 1, ?, ?, ?)',
        )
        .bind(id, 'revision-1', 'Native Identity', now),
      database
        .prepare(
          'INSERT INTO styld_auth_identifiers (namespace, value, module_id, credential_id, subject_id, revision, verified_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
        )
        .bind('email', `${id}@example.invalid`, moduleId, `${id}-credential`, id, 'revision-1', now),
      database
        .prepare('INSERT INTO styld_auth_credentials (credential_id, subject_id, revision, active) VALUES (?, ?, ?, 1)')
        .bind(`${id}-credential`, id, 'revision-1'),
      database
        .prepare(
          'INSERT INTO styld_auth_passwords (module_id, subject_id, credential_id, credential_revision, verifier_version, verifier, normalization) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(moduleId, id, `${id}-credential`, 'revision-1', 'version-1', Redacted.value(verifier), 'none'),
    ])
  }).pipe(Effect.provide(WorkerdServices.layer))

export const disableIdentity = (database: QueryDatabaseClient) =>
  database
    .prepare('UPDATE accounts SET enabled = 0, security_revision = ? WHERE id = ?')
    .bind('revision-disabled', 'native-identity')
    .run()
