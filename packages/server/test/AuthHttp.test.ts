import { Effect, Redacted } from 'effect'
import { describe, expect, test } from 'vitest'
import { decodeAuthSecret, decodeAuthSessionKeyring } from '../src/AuthConfiguration.ts'

const material = 'a'.repeat(43)
const keyring = { activeKeyId: 'current', keys: [{ id: 'current', material }] }

describe('Worker auth secret text', () => {
  test('decodes a JSON signing keyring and redacts the key material', async () => {
    const decoded = await Effect.runPromise(decodeAuthSessionKeyring(JSON.stringify(keyring)))
    expect(decoded.activeKeyId).toBe('current')
    expect(decoded.keys).toHaveLength(1)
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
    JSON.stringify({ ...keyring, keys: [{ id: 'current', material: '!'.repeat(43) }] }),
  ])('rejects invalid configuration without retaining raw input (%#)', async (value) => {
    const failure = await Effect.runPromise(decodeAuthSessionKeyring(value).pipe(Effect.flip))
    expect(failure.reason).toBe('session-keys')
    expect(failure.cause).toBeUndefined()
    expect(JSON.stringify(failure)).not.toContain(material)
    expect(String(failure)).not.toContain('private-input')
  })

  test('reports an application secret configuration error separately', async () => {
    const failure = await Effect.runPromise(decodeAuthSecret('private-input').pipe(Effect.flip))
    expect(failure.reason).toBe('secret')
    expect(String(failure)).not.toContain('private-input')
  })
})
