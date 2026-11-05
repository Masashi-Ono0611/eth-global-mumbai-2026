import type { Sessions } from '@yielded/auth'
import { Effect, Redacted, Result, Schema } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'

const KeyId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/))
const KeyMaterial = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43,342}$/),
  Schema.makeFilter((value) => {
    const bytes = Result.getOrUndefined(Base64Url.decode(value))
    return bytes !== undefined && bytes.length >= 32
  }),
)
const SessionKeyring = Schema.Struct({
  activeKeyId: KeyId,
  keys: Schema.Array(Schema.Struct({ id: KeyId, material: KeyMaterial })).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
  ),
}).check(
  Schema.makeFilter(
    ({ activeKeyId, keys }) =>
      keys.some(({ id }) => id === activeKeyId) && new Set(keys.map(({ id }) => id)).size === keys.length,
  ),
)

export class AuthHttpConfigurationError extends Schema.TaggedError<AuthHttpConfigurationError>()(
  'AuthHttpConfigurationError',
  { reason: Schema.Literals(['session-keys', 'secret']) },
) {}

export type AuthSessionKeyring = Sessions.SessionSigningKeyring

export type AuthHttpOptions = {
  readonly origin: string
  readonly secureCookies: boolean
  readonly secret: Redacted.Redacted
  readonly sessionKeys: AuthSessionKeyring
}

export const decodeAuthSessionKeyring = (value: unknown) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(SessionKeyring))(value).pipe(
    Effect.map(({ activeKeyId, keys }) => ({
      activeKeyId,
      keys: keys.map(({ id, material }) => ({ id, material: Redacted.make(material) })),
    })),
    Effect.mapError(() => AuthHttpConfigurationError.make({ reason: 'session-keys' })),
  )

export const decodeAuthSecret = (value: unknown) =>
  Schema.decodeUnknownEffect(Schema.String.check(Schema.isMinLength(32)))(value).pipe(
    Effect.map(Redacted.make),
    Effect.mapError(() => AuthHttpConfigurationError.make({ reason: 'secret' })),
  )
