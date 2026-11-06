import { Effect, Schema } from 'effect'

/** DER prefix of a P-256 SubjectPublicKeyInfo: SEQUENCE { id-ecPublicKey, prime256v1 } BIT STRING (26 bytes). */
const p256Prefix = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce,
  0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
])
const spkiLength = p256Prefix.length + 65

export class SpkiRejected extends Schema.TaggedError<SpkiRejected>()('SpkiRejected', {}) {}

/** The affine coordinates of a P-256 public key, each a 0x-prefixed 32-byte hex string. */
export type P256Point = { readonly x: string; readonly y: string }

export const toHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`

export const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.slice(2).match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16))

const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, index) => byte === right[index])

/** SPKI = the 26-byte P-256 prefix ‖ 0x04 ‖ x ‖ y (91 bytes); anything else is not a key the wallet can use. */
export const pointFromSpki = (spki: Uint8Array): Effect.Effect<P256Point, SpkiRejected> =>
  spki.length === spkiLength && sameBytes(spki.subarray(0, p256Prefix.length), p256Prefix) && spki[26] === 0x04
    ? Effect.succeed({ x: toHex(spki.subarray(27, 59)), y: toHex(spki.subarray(59, 91)) })
    : Effect.fail(SpkiRejected.make({}))

/** The uncompressed point 0x04 ‖ x ‖ y. */
export const uncompressedPoint = (point: P256Point): Uint8Array =>
  Uint8Array.from([0x04, ...fromHex(point.x), ...fromHex(point.y)])

export const spkiFromPoint = (point: P256Point): Uint8Array =>
  Uint8Array.from([...p256Prefix, ...uncompressedPoint(point)])
