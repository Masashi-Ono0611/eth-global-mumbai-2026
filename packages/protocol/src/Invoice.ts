import { Schema } from 'effect'
import { Id, invoiceIdBytes16 } from './Base32.ts'
import { hashTypedData, type StructType } from './Eip712.ts'
import { Address, Bytes32, type Hex, UintString, UnixSeconds } from './Hex.ts'
import { keccak256Utf8 } from './Keccak.ts'

export const ARC_CHAIN_ID = 5042
export const ARC_NETWORK = 'eip155:5042'
/** Arc's USDC: native balance in 18 dp is the same money as this ERC-20's balance in 6 dp. */
export const ARC_USDC: Hex = '0x3600000000000000000000000000000000000000'

/** The only implementation of the invoice hash (merchant, chip, facilitator and the Id caveat all use it). */
export const INVOICE_DOMAIN = { name: 'AgentMerchant', version: '1', chainId: ARC_CHAIN_ID } as const
export const INVOICE_TYPE: StructType = {
  name: 'Invoice',
  fields: [
    { name: 'merchantId', type: 'bytes32' },
    { name: 'invoiceId', type: 'bytes16' },
    { name: 'payTo', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'linesHash', type: 'bytes32' },
    { name: 'rulesHash', type: 'bytes32' },
  ],
}

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }
const isJsonArray = (value: Json): value is readonly Json[] => Array.isArray(value)

/** Sorted-key compact JSON (`JSON.stringify` spacing; keys in code-unit order, as Python's `sort_keys`). */
export const canonicalJson = (value: Json): string => {
  if (isJsonArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

export const jsonHash = (value: Json): Hex => keccak256Utf8(canonicalJson(value))
export const merchantIdHash = (merchantId: string): Hex => keccak256Utf8(merchantId)

export type InvoiceHashInput = {
  readonly merchantId: string
  readonly id: string
  readonly payTo: Hex
  readonly asset: Hex
  readonly amount: string | bigint
  readonly expiresAt: number
  readonly linesHash: Hex
  readonly rulesHash: Hex
}

export const invoiceHash = (invoice: InvoiceHashInput): Hex =>
  hashTypedData(INVOICE_DOMAIN, INVOICE_TYPE, {
    merchantId: merchantIdHash(invoice.merchantId),
    invoiceId: invoiceIdBytes16(invoice.id),
    payTo: invoice.payTo,
    asset: invoice.asset,
    amount: BigInt(invoice.amount),
    expiresAt: BigInt(invoice.expiresAt),
    linesHash: invoice.linesHash,
    rulesHash: invoice.rulesHash,
  })

/** The invoice as the merchant publishes it and the chip receives it (§7, §8). */
export const Invoice = Schema.Struct({
  id: Id,
  url: Schema.String,
  merchantId: Schema.String.check(Schema.isPattern(/^[a-z0-9-]{1,64}$/)),
  payTo: Address,
  asset: Address,
  amount: UintString,
  expiresAt: UnixSeconds,
  linesHash: Bytes32,
  rulesHash: Bytes32,
  invoiceHash: Bytes32,
  restricted: Schema.Boolean,
})
export type Invoice = typeof Invoice.Type

/** True when the published `invoiceHash` is the hash of the published fields. */
export const invoiceHashMatches = (invoice: Invoice): boolean =>
  invoiceHash(invoice).toLowerCase() === invoice.invoiceHash.toLowerCase()

/** One USDC is 1 000 000 base units; amounts on the wire are decimal strings of base units. */
export const usdcToUnits = (usdc: string): bigint => {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(usdc)
  if (match === null) throw new Error('usdcToUnits: expected a decimal with at most 6 places')
  return BigInt(match[1] ?? '0') * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'))
}

export const unitsToUsdc = (units: bigint): string => {
  const whole = units / 1_000_000n
  const fraction = (units % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return fraction === '' ? whole.toString() : `${whole}.${fraction}`
}
