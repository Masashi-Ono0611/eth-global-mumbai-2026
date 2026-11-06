import { Effect } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'
import { beforeAll, describe, expect, test } from 'vitest'
import { type Jwk, verifyIdToken } from '../src/world/Verify.ts'

const issuer = 'https://auth.world.org'
const clientId = 'app_vitaquack'
const nonce = `0x${'ab'.repeat(32)}`
const now = 1_762_400_000
const orb = 'https://world.org/oidc/acr/orb'

let signingKey: CryptoKey
let otherKey: CryptoKey
let jwk: Jwk

const rsa = () =>
  crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )

beforeAll(async () => {
  const pair = await rsa()
  signingKey = pair.privateKey
  otherKey = (await rsa()).privateKey
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey)
  jwk = { kid: 'kid-1', kty: 'RSA', n: exported.n ?? '', e: exported.e ?? '' }
})

const claims = {
  iss: issuer,
  sub: 'world-sub-1',
  aud: clientId,
  exp: now + 300,
  iat: now,
  jti: 'jti-1',
  nonce,
  auth_time: now - 5,
  acr: orb,
  amr: ['pop', 'user'],
}

const sign = async (payload: object, options: { readonly key?: CryptoKey; readonly header?: object } = {}) => {
  const header = Base64Url.encode(JSON.stringify(options.header ?? { alg: 'RS256', kid: 'kid-1', typ: 'JWT' }))
  const body = Base64Url.encode(JSON.stringify(payload))
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    options.key ?? signingKey,
    new TextEncoder().encode(`${header}.${body}`),
  )
  return `${header}.${body}.${Base64Url.encode(new Uint8Array(signature))}`
}

const outcome = async (token: string) =>
  Effect.runPromise(
    verifyIdToken({ token, keys: [jwk], issuer, clientId, nonce, notBefore: now - 60, now }).pipe(
      Effect.match({ onSuccess: (human) => `ok ${human.sub} ${human.jti}`, onFailure: (error) => error.reason }),
    ),
  )

describe('World ID token (RS256, spec §9)', () => {
  test('a fresh Orb token for this approval is accepted', async () => {
    expect(await outcome(await sign(claims))).toBe('ok world-sub-1 jti-1')
    expect(await outcome(await sign({ ...claims, acr: `${orb}-face`, amr: ['pop', 'face', 'user'] }))).toBe(
      'ok world-sub-1 jti-1',
    )
  })

  test('a token whose amr contains mfa (a passkey-only World sign-in) is rejected', async () => {
    expect(await outcome(await sign({ ...claims, amr: ['pop', 'user', 'mfa'] }))).toBe('mfa')
  })

  test.each([
    ['no pop', { amr: ['user'] }, 'no-proof-of-personhood'],
    ['a selfie-level acr', { acr: 'https://world.org/oidc/acr/selfie' }, 'acr'],
    ['another nonce (another invoice)', { nonce: `0x${'cd'.repeat(32)}` }, 'nonce'],
    ['another audience', { aud: 'app_other' }, 'audience'],
    ['another issuer', { iss: 'https://evil.example' }, 'issuer'],
    ['an expired token', { exp: now - 1 }, 'expired'],
    ['an authentication before the approval opened', { auth_time: now - 3600 }, 'stale'],
  ])('rejects %s', async (_name, change, reason) => {
    expect(await outcome(await sign({ ...claims, ...change }))).toBe(reason)
  })

  test('rejects a forged signature, an unknown key, another algorithm and garbage', async () => {
    expect(await outcome(await sign(claims, { key: otherKey }))).toBe('signature')
    expect(await outcome(await sign(claims, { header: { alg: 'RS256', kid: 'kid-2' } }))).toBe('unknown-key')
    expect(await outcome(await sign(claims, { header: { alg: 'HS256', kid: 'kid-1' } }))).toBe('algorithm')
    expect(await outcome('not.a.token')).toBe('malformed')
    expect(await outcome('only-one-part')).toBe('malformed')
  })
})
