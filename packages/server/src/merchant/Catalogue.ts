import { menus } from '@ethmumbai/protocol/Catalogue'
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
 * The catalogue is the public constant `menus` (@ethmumbai/protocol/Catalogue, spec §3), which the web's counter page
 * also renders. The server adds what only it decides: every listed merchant is known, and a restricted item pays the
 * restricted payee, every other item the merchant's own.
 */
export const merchants: ReadonlyArray<Merchant> = menus.map((menu) => ({
  ...menu,
  trust: 'known',
  items: menu.items.map((item) => ({ ...item, payee: item.restricted ? 'restricted' : 'merchant' })),
}))

export const findMerchant = (merchantId: string) =>
  Option.fromNullishOr(merchants.find((merchant) => merchant.id === merchantId))

export const findItem = (merchant: Merchant, itemId: string) =>
  Option.fromNullishOr(merchant.items.find((item) => item.itemId === itemId))

/** The two receiving addresses, from `MERCHANT_PAY_TO` and `RESTRICTED_PAY_TO`. */
export interface Payees {
  readonly merchant: Hex
  readonly restricted: Hex
}
