import { Effect, Option, Redacted, Result, Schema } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'

export const sessionCookieName = 'vq_session'
export const sessionLifetimeSeconds = 7 * 24 * 60 * 60

const KeyId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/))
const KeyMaterial = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43,342}$/),
  Schema.makeFilter((value) => {
    const decoded = Result.getOrUndefined(Base64Url.decode(value))
    return decoded !== undefined && decoded.length >= 32
  }),
)
const SessionKeyringJson = Schema.Struct({
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

/** `APP_AUTH_SESSION_KEYS`: the active key signs new cookies; every listed key still verifies (rotation). */
export type SessionKeyring = {
  readonly activeKeyId: string
  readonly keys: ReadonlyArray<{ readonly id: string; readonly material: Redacted.Redacted }>
}

export class SessionKeysInvalid extends Schema.TaggedError<SessionKeysInvalid>()('SessionKeysInvalid', {}) {}
export class SessionInvalid extends Schema.TaggedError<SessionInvalid>()('SessionInvalid', {}) {}

/** Decodes the keyring JSON without retaining the raw input in the failure. */
export const decodeSessionKeyring = (value: unknown): Effect.Effect<SessionKeyring, SessionKeysInvalid> =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(SessionKeyringJson))(value).pipe(
    Effect.map(({ activeKeyId, keys }) => ({
      activeKeyId,
      keys: keys.map(({ id, material }) => ({ id, material: Redacted.make(material) })),
    })),
    Effect.mapError(() => SessionKeysInvalid.make({})),
  )

export const SessionPayload = Schema.Struct({
  accountId: Schema.String,
  securityRevision: Schema.String,
  keyId: Schema.String,
  iat: Schema.Int,
  exp: Schema.Int,
})
export type SessionPayload = typeof SessionPayload.Type

const encoder = new TextEncoder()
const PayloadJson = Schema.fromJsonString(SessionPayload)

const hmacKey = (keyring: SessionKeyring, keyId: string) =>
  Effect.gen(function* () {
    const entry = keyring.keys.find(({ id }) => id === keyId)
    if (entry === undefined) return yield* SessionInvalid.make({})
    const material = yield* Effect.fromResult(Base64Url.decode(Redacted.value(entry.material))).pipe(
      Effect.mapError(() => SessionInvalid.make({})),
    )
    return yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.importKey('raw', Uint8Array.from(material), { name: 'HMAC', hash: 'SHA-256' }, false, [
          'sign',
          'verify',
        ]),
      catch: () => SessionInvalid.make({}),
    })
  })

/** `vq_session` = base64url(payload JSON) "." base64url(HMAC-SHA256(payload part)), signed with the active key. */
export const signSession = Effect.fn('EthMumbai.Auth.signSession')(function* (
  keyring: SessionKeyring,
  claims: { readonly accountId: string; readonly securityRevision: string; readonly now: number },
) {
  const payload: SessionPayload = {
    accountId: claims.accountId,
    securityRevision: claims.securityRevision,
    keyId: keyring.activeKeyId,
    iat: claims.now,
    exp: claims.now + sessionLifetimeSeconds,
  }
  const body = Base64Url.encode(encoder.encode(yield* Schema.encodeEffect(PayloadJson)(payload).pipe(Effect.orDie)))
  const key = yield* hmacKey(keyring, keyring.activeKeyId).pipe(Effect.orDie)
  const mac = yield* Effect.promise(() => crypto.subtle.sign('HMAC', key, encoder.encode(body)))
  return `${body}.${Base64Url.encode(new Uint8Array(mac))}`
})

/** The payload of an authentic, unexpired cookie; the caller still checks the account's security revision. */
export const verifySession = Effect.fn('EthMumbai.Auth.verifySession')(function* (
  keyring: SessionKeyring,
  token: string,
  now: number,
) {
  const [body, mac, ...rest] = token.split('.')
  if (body === undefined || mac === undefined || rest.length > 0) return yield* SessionInvalid.make({})
  const json = yield* Effect.fromResult(Base64Url.decode(body)).pipe(Effect.mapError(() => SessionInvalid.make({})))
  const payload = yield* Schema.decodeEffect(PayloadJson)(new TextDecoder().decode(json)).pipe(
    Effect.mapError(() => SessionInvalid.make({})),
  )
  const signature = yield* Effect.fromResult(Base64Url.decode(mac)).pipe(Effect.mapError(() => SessionInvalid.make({})))
  const key = yield* hmacKey(keyring, payload.keyId)
  const authentic = yield* Effect.tryPromise({
    try: () => crypto.subtle.verify('HMAC', key, Uint8Array.from(signature), encoder.encode(body)),
    catch: () => SessionInvalid.make({}),
  })
  if (!authentic || payload.exp <= now || payload.iat > now + 300) return yield* SessionInvalid.make({})
  return payload
})

/** The cookie value from a `Cookie` header map, if present. */
export const sessionToken = (cookies: Readonly<Record<string, string | undefined>>): Option.Option<string> =>
  Option.fromNullishOr(cookies[sessionCookieName])
