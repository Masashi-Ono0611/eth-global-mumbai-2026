import { Effect, Random, Schema } from 'effect'
import { bytesToHex, type Hex } from './Hex.ts'

// RFC 4648 base32, lowercase alphabet `a-z2-7`, no padding. A 26-character id carries 130 bits: 16 bytes plus two zero
// padding bits in the last character. Ids are only ever minted from 16 random bytes, so the id ↔ bytes16 map is a
// bijection and the schema rejects non-canonical spellings (two ids must never share an on-chain invoiceId).
export const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

export const encodeBase32 = (bytes: Uint8Array): string => {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET.charAt((buffer >> (bits - 5)) & 31)
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET.charAt((buffer << (5 - bits)) & 31)
  return out
}

/** Decodes and drops the trailing partial byte (C1's chip does the same: first 16 bytes of 26 characters). */
export const decodeBase32 = (text: string): Uint8Array<ArrayBuffer> => {
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of text) {
    const value = BASE32_ALPHABET.indexOf(char)
    if (value < 0) throw new Error('decodeBase32: character outside a-z2-7')
    buffer = ((buffer << 5) | value) & 0xffff
    bits += 5
    if (bits >= 8) {
      out.push((buffer >> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

const isCanonicalId = (text: string) => BASE32_ALPHABET.indexOf(text.charAt(25)) % 4 === 0

/** A 26-character lowercase base32 id: every row id and every invoice id. */
export const Id = Schema.String.check(
  Schema.isPattern(/^[a-z2-7]{26}$/),
  Schema.makeFilter((text) => isCanonicalId(text) || 'id has non-zero padding bits'),
).annotate({ identifier: 'Id' })

/** The invoice id's on-chain form: the first 16 bytes of its base32 decode. */
export const invoiceIdBytes16 = (id: string): Hex => bytesToHex(decodeBase32(id).slice(0, 16))

export const idFromBytes16 = (bytes: Uint8Array): string => {
  if (bytes.length !== 16) throw new Error('idFromBytes16: expected 16 bytes')
  return encodeBase32(bytes)
}

/** A fresh 26-character id from 16 bytes of the Effect `Random` service (server code must not use `crypto` directly). */
export const generateId = Effect.gen(function* () {
  const bytes = new Uint8Array(16)
  for (let index = 0; index < bytes.length; index++) bytes[index] = yield* Random.nextIntBetween(0, 255)
  return idFromBytes16(bytes)
})
