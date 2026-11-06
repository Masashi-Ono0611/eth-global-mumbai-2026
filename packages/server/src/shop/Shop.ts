import { ARC_CHAIN_ID } from '@ethmumbai/protocol/Invoice'
import { Schema } from 'effect'
import { getAddress } from 'viem'

// The shop (vitaquack.com/shop/): preorders and reservations paid in USDC on Arc, to one address Kris holds. Nothing
// here can move money: the shop only reads Arc to see that a payment arrived. Prices are USDC base units (6 dp).

/** Where every shop payment goes (Kris's MetaMask account, 7 Nov). A public address, never a key. */
export const SHOP_PAY_TO = getAddress('0x102b15E56A3a6869d0c8934296A61a091e877603')

/**
 * Arc's system emitter: it logs a `Transfer` (18 decimals) for every USDC movement, native sends and ERC-20
 * `transfer` alike (EIP-7708, docs.arc.io/arc/references/usdc-system-events). Reading only this stream sees each
 * payment exactly once, whichever way the buyer's wallet sends it.
 */
export const USDC_SYSTEM_EMITTER = getAddress('0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE')

/** 18-decimal native value per 6-decimal USDC base unit. */
export const NATIVE_PER_UNIT = 1_000_000_000_000n

const usdc = (whole: number) => BigInt(whole) * 1_000_000n

export const Kit = Schema.Literals(['full', 'dev'])
export type Kit = typeof Kit.Type
export const Pay = Schema.Literals(['full', 'reserve'])
export type Pay = typeof Pay.Type

/** The two kits: the founding price for the first `cap` orders (paid, or open and not expired), then the standard. */
export const KITS = {
  full: { name: 'Vitaquack Full Kit', founding: usdc(499), standard: usdc(599), cap: 20 },
  dev: { name: 'Vitaquack Dev Kit', founding: usdc(99), standard: usdc(149), cap: 50 },
} as const satisfies Record<Kit, { name: string; founding: bigint; standard: bigint; cap: number }>

/** A reservation holds a kit (and its founding price) for 50 USDC, which counts toward the price. */
export const RESERVATION = usdc(50)

/** An order's exact amount is open this long; a payment that lands later still marks it paid. */
export const ORDER_TTL_SECONDS = 60 * 60

/** The amount an order asks for before its unique suffix. */
export const priceOf = (kit: Kit, pay: Pay, founding: boolean): bigint =>
  pay === 'reserve' ? RESERVATION : founding ? KITS[kit].founding : KITS[kit].standard

/** The price plus 1 to 9999 millionths of a USDC, so a transfer's amount names its order. */
export const SUFFIX_MAX = 9999
export const withSuffix = (base: bigint, suffix: number): bigint => base + BigInt(suffix)

/** USDC base units as text with all six decimals, e.g. 499004213n → "499.004213". */
export const formatAmount = (units: bigint): string =>
  `${units / 1_000_000n}.${(units % 1_000_000n).toString().padStart(6, '0')}`

/**
 * The EIP-681 request a wallet can scan: a native USDC send of the exact amount to the shop on Arc (chain 5042),
 * `value` in the 18-decimal native unit.
 */
export const paymentRequest = (units: bigint): string =>
  `ethereum:${SHOP_PAY_TO}@${ARC_CHAIN_ID}?value=${units * NATIVE_PER_UNIT}`

/** A USDC transfer to the shop as the system emitter logged it, in 6-decimal units when it is a whole number of them. */
export const unitsOfNative = (value: bigint): bigint | undefined =>
  value % NATIVE_PER_UNIT === 0n ? value / NATIVE_PER_UNIT : undefined

export type OpenOrder = { readonly id: string; readonly amount: string }
export type SeenTransfer = { readonly id: string; readonly amount: string }

/**
 * Pairs each unmatched transfer with the one order asking for exactly its amount. An order takes at most one transfer
 * and a transfer at most one order; amounts are unique among open orders, so the first order with the amount wins.
 */
export const matchTransfers = (
  orders: ReadonlyArray<OpenOrder>,
  transfers: ReadonlyArray<SeenTransfer>,
): ReadonlyArray<{ readonly orderId: string; readonly transferId: string }> => {
  const taken = new Set<string>()
  const pairs: Array<{ readonly orderId: string; readonly transferId: string }> = []
  for (const transfer of transfers) {
    const order = orders.find((candidate) => candidate.amount === transfer.amount && !taken.has(candidate.id))
    if (order === undefined) continue
    taken.add(order.id)
    pairs.push({ orderId: order.id, transferId: transfer.id })
  }
  return pairs
}

const Text = (min: number, max: number) => Schema.String.check(Schema.isMinLength(min), Schema.isMaxLength(max))

/** What the buyer sends: the kit, full price or reservation, and where to ship. Validated here, trusted nowhere else. */
export const OrderBody = Schema.Struct({
  kit: Kit,
  pay: Pay,
  email: Schema.String.check(Schema.isMaxLength(200), Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
  name: Text(1, 120),
  address: Text(5, 600),
  country: Text(2, 80),
})
export type OrderBody = typeof OrderBody.Type
