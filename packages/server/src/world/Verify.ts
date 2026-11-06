import { Effect, Result, Schema } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'

/** World IdP's proof-of-personhood levels (production discovery `acr_values_supported`). */
export const ORB_ACRS: ReadonlySet<string> = new Set([
  'https://world.org/oidc/acr/orb',
  'https://world.org/oidc/acr/orb-face',
])

export const RejectionReason = Schema.Literals([
  'malformed',
  'algorithm',
  'unknown-key',
  'signature',
  'issuer',
  'audience',
  'expired',
  'nonce',
  'stale',
  'acr',
])
export type RejectionReason = typeof RejectionReason.Type

/**
 * Why a World ID token did not approve the payment; never carries the token. `detail` is only ever the token's `acr`
 * (an assurance class URL, not a secret), so a refusal says which class World sent.
 */
export class IdTokenRejected extends Schema.TaggedError<IdTokenRejected>()('IdTokenRejected', {
  reason: RejectionReason,
  detail: Schema.optionalKey(Schema.String),
}) {}

const reject = (reason: RejectionReason, detail?: string) =>
  IdTokenRejected.make(detail === undefined ? { reason } : { reason, detail })

export const Jwk = Schema.Struct({
  kid: Schema.String,
  kty: Schema.Literal('RSA'),
  n: Schema.String,
  e: Schema.String,
  alg: Schema.optionalKey(Schema.String),
  use: Schema.optionalKey(Schema.String),
})
export type Jwk = typeof Jwk.Type
export const Jwks = Schema.Struct({ keys: Schema.Array(Schema.Unknown) })

const Header = Schema.Struct({ alg: Schema.String, kid: Schema.String, crit: Schema.optionalKey(Schema.Unknown) })
const Claims = Schema.Struct({
  iss: Schema.String,
  sub: Schema.String.check(Schema.isMinLength(1)),
  aud: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  exp: Schema.Finite,
  iat: Schema.Finite,
  jti: Schema.String.check(Schema.isMinLength(1)),
  nonce: Schema.String,
  auth_time: Schema.Finite,
  acr: Schema.String,
  amr: Schema.optionalKey(Schema.Array(Schema.String)),
})

const segment = <S extends Schema.Constraint>(text: string, schema: S) =>
  Result.match(Base64Url.decodeString(text), {
    onFailure: () => Effect.fail(reject('malformed')),
    onSuccess: (json) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(json).pipe(Effect.mapError(() => reject('malformed'))),
  })

/** What the backend approver learned from one verified World ID token (§9). */
export type VerifiedHuman = {
  readonly sub: string
  readonly jti: string
  readonly authTime: number
  readonly acr: string
  readonly amr: ReadonlyArray<string>
}

type Claims = typeof Claims.Type
type Expectations = {
  readonly issuer: string
  readonly clientId: string
  readonly nonce: string
  readonly notBefore: number
  readonly now: number
}

/** The §9 claim checks in order; the first that fails names the rejection. */
const claimChecks: ReadonlyArray<readonly [RejectionReason, (claims: Claims, expected: Expectations) => boolean]> = [
  ['issuer', (claims, expected) => claims.iss === expected.issuer],
  [
    'audience',
    (claims, expected) => (typeof claims.aud === 'string' ? [claims.aud] : claims.aud).includes(expected.clientId),
  ],
  ['expired', (claims, expected) => claims.exp > expected.now && claims.iat <= expected.now + 60],
  ['nonce', (claims, expected) => claims.nonce === expected.nonce],
  ['stale', (claims, expected) => claims.auth_time >= expected.notBefore && claims.auth_time <= expected.now + 60],
  ['acr', (claims) => ORB_ACRS.has(claims.acr)],
]

/** Splits the compact JWS and checks its RS256 signature with the JWKS key its `kid` names; returns the payload. */
const verifySignature = Effect.fnUntraced(function* (token: string, keys: ReadonlyArray<Jwk>) {
  const parts = token.split('.')
  const [headerText = '', payloadText = '', signatureText = ''] = parts
  if (parts.length !== 3) return yield* reject('malformed')
  const header = yield* segment(headerText, Header)
  if (header.alg !== 'RS256' || header.crit !== undefined) return yield* reject('algorithm')
  const jwk = keys.find((key) => key.kid === header.kid)
  if (jwk === undefined) return yield* reject('unknown-key')
  const signature = yield* Effect.fromResult(Base64Url.decode(signatureText)).pipe(
    Effect.mapError(() => reject('malformed')),
  )
  const verified = yield* Effect.tryPromise({
    try: async () => {
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      )
      return crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        Uint8Array.from(signature),
        new TextEncoder().encode(`${headerText}.${payloadText}`),
      )
    },
    catch: () => reject('signature'),
  })
  if (!verified) return yield* reject('signature')
  return payloadText
})

/**
 * RS256 against World's JWKS, then every §9 claim: `iss`, `aud`, `exp`, `nonce` (the approval's EIP-712 nonce),
 * `auth_time` not before the approval was opened (minus 60 s of skew) and `acr` Orb or Orb + face. `amr` is recorded,
 * not judged: World's real token for an Orb-verified account signing in with World App carries `mfa` (6 Nov rehearsal),
 * so the earlier "pop and not mfa" rule (from research, not from World's docs) refused real humans; `max_age=0` +
 * `prompt=login` + a fresh `auth_time` + an Orb `acr` are the freshness and personhood checks. `jti` reuse and the
 * `sub` binding are checked by the caller against D1.
 */
export const verifyIdToken = Effect.fn('EthMumbai.World.verifyIdToken')(function* (
  input: Expectations & { readonly token: string; readonly keys: ReadonlyArray<Jwk> },
) {
  const payloadText = yield* verifySignature(input.token, input.keys)
  const claims = yield* segment(payloadText, Claims)
  const failed = claimChecks.find(([, holds]) => !holds(claims, input))
  if (failed !== undefined) return yield* reject(failed[0], failed[0] === 'acr' ? claims.acr : undefined)
  const human: VerifiedHuman = {
    sub: claims.sub,
    jti: claims.jti,
    authTime: claims.auth_time,
    acr: claims.acr,
    amr: claims.amr ?? [],
  }
  return human
})
