import { Schema } from 'effect'

/** `0x`-prefixed hex, compatible with viem's `Hex` and `Address` template types. */
export type Hex = `0x${string}`

const hexPattern = (bytes: number | undefined) =>
  Schema.TemplateLiteral(['0x', Schema.String]).check(
    Schema.isPattern(bytes === undefined ? /^0x(?:[0-9a-fA-F]{2})*$/ : new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`)),
  )

export const HexBytes = hexPattern(undefined).annotate({ identifier: 'HexBytes' })
export const Address = hexPattern(20).annotate({ identifier: 'Address' })
export const Bytes32 = hexPattern(32).annotate({ identifier: 'Bytes32' })
/** A 65-byte `r‖s‖v` ECDSA signature. */
export const EcdsaSignature = hexPattern(65).annotate({ identifier: 'EcdsaSignature' })
/** A non-negative integer as a decimal string (uint256 amounts, salts). */
export const UintString = Schema.String.check(Schema.isPattern(/^(?:0|[1-9][0-9]{0,77})$/)).annotate({
  identifier: 'UintString',
})
/** Unix seconds. */
export const UnixSeconds = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

export const isHex = (value: string): value is Hex => /^0x(?:[0-9a-fA-F]{2})*$/.test(value)

export const bytesToHex = (bytes: Uint8Array): Hex => {
  let out = '0x'
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  if (!isHex(out)) throw new Error('bytesToHex: unreachable')
  return out
}

export const hexToBytes = (hex: string): Uint8Array<ArrayBuffer> => {
  if (!isHex(hex)) throw new Error('hexToBytes: not even-length 0x hex')
  const out = new Uint8Array((hex.length - 2) / 2)
  for (let index = 0; index < out.length; index++)
    out[index] = Number.parseInt(hex.slice(2 + index * 2, 4 + index * 2), 16)
  return out
}

export const utf8ToBytes = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)

export const concatBytes = (...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Big-endian unsigned integer in exactly `size` bytes. */
export const uintToBytes = (value: bigint, size: number): Uint8Array<ArrayBuffer> => {
  if (value < 0n || value >= 1n << BigInt(size * 8))
    throw new Error(`uintToBytes: value out of range for ${size} bytes`)
  const out = new Uint8Array(size)
  let rest = value
  for (let index = size - 1; index >= 0; index--) {
    out[index] = Number(rest & 0xffn)
    rest >>= 8n
  }
  return out
}
