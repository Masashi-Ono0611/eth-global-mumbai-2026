import { Effect, Exit } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { Result } from 'effect'
import { describe, expect, test } from 'vitest'
import { pointFromSpki, spkiFromPoint } from '../src/Spki.ts'

// A WebCrypto-exported P-256 public key and the JWK coordinates WebCrypto reported for it.
const spki = Result.getOrThrow(
  Base64.decode(
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEWJpl8XecRA7blE/L6X54HLNow99WLStzjtbxXGGhAqbNYC6dH3BAlQkrf4HCJSyhdGENddiWrjp3CmXkGeDW4g==',
  ),
)
const point = {
  x: '0x589a65f1779c440edb944fcbe97e781cb368c3df562d2b738ed6f15c61a102a6',
  y: '0xcd602e9d1f704095092b7f81c2252ca174610d75d896ae3a770a65e419e0d6e2',
}

describe('P-256 SPKI', () => {
  test('a 91-byte SPKI yields the x and y of its uncompressed point, and round-trips', async () => {
    expect(spki.length).toBe(91)
    expect(await Effect.runPromise(pointFromSpki(spki))).toEqual(point)
    expect(Array.from(spkiFromPoint(point))).toEqual(Array.from(spki))
  })

  test.each([
    ['truncated', spki.slice(0, 90)],
    ['another curve OID', Uint8Array.from(spki).fill(0x22, 20, 21)],
    ['compressed point', Uint8Array.from(spki).fill(0x02, 26, 27)],
  ])('rejects a %s key', async (_name, bytes) => {
    expect(Exit.isFailure(await Effect.runPromiseExit(pointFromSpki(bytes)))).toBe(true)
  })
})
