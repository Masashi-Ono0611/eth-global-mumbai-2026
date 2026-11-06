import { Effect, Exit, Redacted } from 'effect'
import { describe, expect, test } from 'vitest'
import * as Base64Url from 'effect/encoding/Base64Url'
import {
  decodeSessionKeyring,
  SessionKeysInvalid,
  sessionLifetimeSeconds,
  signSession,
  verifySession,
} from '../src/Session.ts'

const material = 'a'.repeat(43)
const rotated = 'b'.repeat(43)
const keyring = { activeKeyId: 'current', keys: [{ id: 'current', material }] }
const decode = (value: unknown) => Effect.runPromise(decodeSessionKeyring(value))
const now = 1_762_400_000
const claims = { accountId: 'acc', securityRevision: 'rev-1', now }

describe('session keyring (APP_AUTH_SESSION_KEYS)', () => {
  test('decodes a JSON signing keyring and redacts the key material', async () => {
    const decoded = await decode(JSON.stringify(keyring))
    expect(decoded.activeKeyId).toBe('current')
    const key = decoded.keys[0]
    if (key === undefined) throw new Error('Expected the decoded session signing key')
    expect(Redacted.value(key.material)).toBe(material)
    expect(JSON.stringify(decoded)).not.toContain(material)
  })

  test.each([
    undefined,
    keyring,
    '{private-input',
    JSON.stringify({ ...keyring, activeKeyId: 'missing' }),
    JSON.stringify({ ...keyring, keys: [] }),
    JSON.stringify({ ...keyring, keys: [keyring.keys[0], keyring.keys[0]] }),
    JSON.stringify({ ...keyring, keys: [{ id: 'current', material: 'short-private-input' }] }),
  ])('rejects invalid configuration without retaining raw input (%#)', async (value) => {
    const failure = await Effect.runPromise(decodeSessionKeyring(value).pipe(Effect.flip))
    expect(failure).toBeInstanceOf(SessionKeysInvalid)
    expect(String(failure)).not.toContain('private-input')
  })
})

describe('vq_session cookie', () => {
  test('a signed cookie verifies and carries the account, revision and signing key id', async () => {
    const ring = await decode(JSON.stringify(keyring))
    const token = await Effect.runPromise(signSession(ring, claims))
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
    expect(await Effect.runPromise(verifySession(ring, token, now + 60))).toEqual({
      accountId: 'acc',
      securityRevision: 'rev-1',
      keyId: 'current',
      iat: now,
      exp: now + sessionLifetimeSeconds,
    })
  })

  test('a rotated keyring still verifies old cookies while new ones use the new key', async () => {
    const old = await decode(JSON.stringify(keyring))
    const token = await Effect.runPromise(signSession(old, claims))
    const ring = await decode(
      JSON.stringify({ activeKeyId: 'next', keys: [{ id: 'next', material: rotated }, ...keyring.keys] }),
    )
    expect((await Effect.runPromise(verifySession(ring, token, now))).keyId).toBe('current')
    expect((await Effect.runPromise(signSession(ring, claims))).length).toBeGreaterThan(0)
  })

  test('tampered, expired, foreign-key and malformed cookies are rejected', async () => {
    const ring = await decode(JSON.stringify(keyring))
    const other = await decode(JSON.stringify({ activeKeyId: 'current', keys: [{ id: 'current', material: rotated }] }))
    const token = await Effect.runPromise(signSession(ring, claims))
    const [body = '', mac = ''] = token.split('.')
    const forgedPayload = { accountId: 'other', securityRevision: 'rev-1', keyId: 'current', iat: now, exp: now + 999 }
    const forged = `${Base64Url.encode(JSON.stringify(forgedPayload))}.${mac}`
    const cases: ReadonlyArray<readonly [string, number]> = [
      [forged, now],
      [token, now + sessionLifetimeSeconds],
      [`${body}.${mac.slice(0, -2)}AA`, now],
      ['not-a-cookie', now],
      [`${body}.${mac}.extra`, now],
    ]
    for (const [candidate, at] of cases) {
      expect(Exit.isFailure(await Effect.runPromiseExit(verifySession(ring, candidate, at)))).toBe(true)
    }
    expect(Exit.isFailure(await Effect.runPromiseExit(verifySession(other, token, now)))).toBe(true)
  })
})
