import { Schema as AuthSchema } from '@yielded/auth'
import { AuthPersistence } from '@yielded/auth-persistence-drizzle/D1'
import { Effect } from 'effect'
import { accounts } from '@ethmumbai/db'

import { makeAuth, requirement } from './config.ts'

export const AppAuth = makeAuth()
export const Persistence = AuthPersistence.make(AppAuth)

export const storage = Persistence.managed({
  subjects: {
    table: accounts,
    id: 'id',
    status: 'enabled',
    activeValue: true,
    securityRevision: 'securityRevision',
    idCodec: AuthSchema.SubjectId,
    requirements: () => Effect.succeed(requirement),
    actionRequirements: () => Effect.succeed(requirement),
  },
  prefix: 'styld_auth',
})

export const authSchema = storage.schema
// Drizzle Kit discovers table exports; keep the managed auth tables named and
// stable so the generated D1 migration owns the complete persistence boundary.
export const { identifiers, credentials, passwords, sessions, pending } = authSchema

export const authTables = {
  identifiers,
  credentials,
  passwords,
  sessions,
  pending,
}
