import { describe, expect, test } from 'vitest'
import { nativeValueOf, PLAIN_TRANSFER_GAS, transferGasLimit } from '../src/Fund.ts'

describe('sendUsdc gas limit', () => {
  test('a recipient without code gets exactly a plain transfer', () => {
    expect(transferGasLimit(21_000n)).toBe(PLAIN_TRANSFER_GAS)
  })

  test('a deployed recipient gets its estimate plus 25% headroom, rounded up', () => {
    // A HybridDeleGator owner's receive costs more than 21,000: the old fixed limit reverted out of gas there.
    expect(transferGasLimit(30_001n)).toBe(37_502n)
    expect(transferGasLimit(40_000n)).toBe(50_000n)
  })

  test('never below a plain transfer, even for a low estimate', () => {
    expect(transferGasLimit(1n)).toBe(PLAIN_TRANSFER_GAS)
  })

  test('USDC units become 18-decimal native value', () => {
    expect(nativeValueOf(100_000n)).toBe(100_000_000_000_000_000n)
  })
})
