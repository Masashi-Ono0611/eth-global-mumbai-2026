import { describe, expect, test } from 'vitest'
import { formatUsdc } from '../src/wallet/Activity.ts'
import { MAX_DAILY_CAP, usdcBaseUnits } from '../src/wallet/Grants.ts'
import { PAIRING_ALPHABET, pairingCodeFrom } from '../src/wallet/Robots.ts'

describe('pairing codes', () => {
  test('use 8 characters of the unambiguous alphabet and drop biased bytes', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index * 8)
    const code = pairingCodeFrom(bytes)
    expect(code).toHaveLength(8)
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)
    expect(PAIRING_ALPHABET).not.toMatch(/[01ILO]/)
    // 248..255 would favour the first 8 characters; they never become a character.
    expect(pairingCodeFrom(Uint8Array.from([248, 249, 250, 255, 0, 1, 2, 3, 4, 5, 6, 7]))).toBe('ABCDEFGH')
    expect(pairingCodeFrom(Uint8Array.from([250, 251]))).toBe('')
  })
})

describe('USDC amounts', () => {
  test('owner-typed amounts become 6-decimal base units and back', () => {
    expect(usdcBaseUnits('1')).toBe(1_000_000n)
    expect(usdcBaseUnits('0.30')).toBe(300_000n)
    expect(usdcBaseUnits('0.000001')).toBe(1n)
    expect(usdcBaseUnits('10.00')).toBe(MAX_DAILY_CAP)
    expect(formatUsdc(1_230_000n)).toBe('1.23')
    expect(formatUsdc(100_000n)).toBe('0.10')
    expect(formatUsdc(1n)).toBe('0.000001')
    expect(formatUsdc(0n)).toBe('0.00')
  })
})
