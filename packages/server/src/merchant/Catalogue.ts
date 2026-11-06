import type { Hex } from '@ethmumbai/protocol/Hex'
import { Option } from 'effect'

export type PayeeRole = 'merchant' | 'restricted'

export interface CatalogueItem {
  readonly itemId: string
  readonly name: string
  /** USDC base units (6 dp) as a decimal string. */
  readonly amount: string
  readonly restricted: boolean
  /** Which configured address receives the payment: restricted items pay a second address no grant allowlists. */
  readonly payee: PayeeRole
}

export interface Merchant {
  readonly id: string
  readonly name: string
  readonly trust: 'known' | 'untrusted'
  readonly items: ReadonlyArray<CatalogueItem>
}

/**
 * The merchant catalogue is a constant (spec §3): chai 0.10, samosa 0.25 and thali 2.00, the counter item above the
 * demo grant's 1.00 per-payment cap, so it needs the owner's World approval. The demo's approval story is spending
 * limits only (6 Nov, Kris): no restricted item is sold, though `restricted` items and their separate payee still work.
 */
export const merchants: ReadonlyArray<Merchant> = [
  {
    id: 'duck-cafe',
    name: 'Duck Café',
    trust: 'known',
    items: [
      { itemId: 'chai', name: 'Chai', amount: '100000', restricted: false, payee: 'merchant' },
      { itemId: 'samosa', name: 'Samosa', amount: '250000', restricted: false, payee: 'merchant' },
      { itemId: 'thali', name: 'Thali', amount: '2000000', restricted: false, payee: 'merchant' },
    ],
  },
]

export const findMerchant = (merchantId: string) =>
  Option.fromNullishOr(merchants.find((merchant) => merchant.id === merchantId))

export const findItem = (merchant: Merchant, itemId: string) =>
  Option.fromNullishOr(merchant.items.find((item) => item.itemId === itemId))

/** The two receiving addresses, from `MERCHANT_PAY_TO` and `RESTRICTED_PAY_TO`. */
export interface Payees {
  readonly merchant: Hex
  readonly restricted: Hex
}
