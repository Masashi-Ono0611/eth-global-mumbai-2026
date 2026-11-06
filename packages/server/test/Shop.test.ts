import { Option, Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import {
  formatAmount,
  matchTransfers,
  NATIVE_PER_UNIT,
  OrderBody,
  paymentRequest,
  priceOf,
  SHOP_PAY_TO,
  unitsOfNative,
  withSuffix,
} from '../src/shop/Shop.ts'

describe('the shop', () => {
  test('pays Kris’s address, checksummed', () => {
    expect(SHOP_PAY_TO).toBe('0x102b15E56A3a6869d0c8934296A61a091e877603')
  })

  test('prices: founding, then standard; a reservation is 50 USDC whatever the kit', () => {
    expect(formatAmount(priceOf('full', 'full', true))).toBe('499.000000')
    expect(formatAmount(priceOf('full', 'full', false))).toBe('599.000000')
    expect(formatAmount(priceOf('dev', 'full', true))).toBe('99.000000')
    expect(formatAmount(priceOf('dev', 'full', false))).toBe('149.000000')
    expect(formatAmount(priceOf('full', 'reserve', false))).toBe('50.000000')
    expect(formatAmount(withSuffix(priceOf('full', 'full', true), 4213))).toBe('499.004213')
  })

  test('asks a wallet for a native USDC send of the exact amount on Arc', () => {
    expect(paymentRequest(499_004_213n)).toBe(
      'ethereum:0x102b15E56A3a6869d0c8934296A61a091e877603@5042?value=499004213000000000000',
    )
  })

  test('reads the 18-decimal system transfer as 6-decimal units, and skips a value that is no whole unit', () => {
    expect(unitsOfNative(499_004_213n * NATIVE_PER_UNIT)).toBe(499_004_213n)
    expect(unitsOfNative(499_004_213n * NATIVE_PER_UNIT + 1n)).toBeUndefined()
  })

  test('matches a transfer to the one order asking its exact amount, each at most once', () => {
    const orders = [
      { id: 'a', amount: '499004213' },
      { id: 'b', amount: '50000017' },
    ]
    expect(
      matchTransfers(orders, [
        { id: 't1', amount: '50000017' },
        { id: 't2', amount: '50000017' },
        { id: 't3', amount: '499000000' },
        { id: 't4', amount: '499004213' },
      ]),
    ).toEqual([
      { orderId: 'b', transferId: 't1' },
      { orderId: 'a', transferId: 't4' },
    ])
  })

  test('accepts a complete order and refuses a bad kit, a bad email or a missing address', () => {
    const decode = Schema.decodeUnknownOption(OrderBody)
    const order = {
      kit: 'full',
      pay: 'reserve',
      email: 'kris@example.com',
      name: 'Kris',
      address: '1 Duck Lane, Ljubljana',
      country: 'Slovenia',
    }
    expect(Option.isSome(decode(order))).toBe(true)
    expect(Option.isNone(decode({ ...order, kit: 'mega' }))).toBe(true)
    expect(Option.isNone(decode({ ...order, email: 'kris' }))).toBe(true)
    expect(Option.isNone(decode({ ...order, address: '' }))).toBe(true)
  })
})
