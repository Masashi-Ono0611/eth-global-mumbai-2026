import { bytesToHex, type Hex, utf8ToBytes } from './Hex.ts'

// Keccak-256 (the Ethereum variant: pad 0x01…0x80, not SHA3's 0x06), so the protocol package stays dependency-free and
// browser-safe. Cross-checked against viem's keccak256 in packages/chain/test. Not a hot path: invoices and approvals only.
const MASK = (1n << 64n) - 1n
const RATE = 136
const ROUND_CONSTANTS = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
] as const
const ROTATIONS = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44] as const
const PI_LANES = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1] as const

const lane = (state: readonly bigint[], index: number) => state[index] ?? 0n
const rotl = (value: bigint, shift: number) => ((value << BigInt(shift)) | (value >> BigInt(64 - shift))) & MASK

const theta = (state: bigint[]) => {
  const columns = [0, 1, 2, 3, 4].map(
    (x) => lane(state, x) ^ lane(state, x + 5) ^ lane(state, x + 10) ^ lane(state, x + 15) ^ lane(state, x + 20),
  )
  for (let x = 0; x < 5; x++) {
    const mix = (columns[(x + 4) % 5] ?? 0n) ^ rotl(columns[(x + 1) % 5] ?? 0n, 1)
    for (let y = 0; y < 25; y += 5) state[y + x] = lane(state, y + x) ^ mix
  }
}

const rhoPi = (state: bigint[]) => {
  let carried = lane(state, 1)
  for (let step = 0; step < 24; step++) {
    const target = PI_LANES[step] ?? 0
    const next = lane(state, target)
    state[target] = rotl(carried, ROTATIONS[step] ?? 0)
    carried = next
  }
}

const chi = (state: bigint[]) => {
  for (let y = 0; y < 25; y += 5) {
    const row = state.slice(y, y + 5)
    for (let x = 0; x < 5; x++) state[y + x] = lane(row, x) ^ (~lane(row, (x + 1) % 5) & MASK & lane(row, (x + 2) % 5))
  }
}

const permute = (state: bigint[]) => {
  for (const constant of ROUND_CONSTANTS) {
    theta(state)
    rhoPi(state)
    chi(state)
    state[0] = lane(state, 0) ^ constant
  }
}

const readLane = (bytes: Uint8Array, offset: number) => {
  let value = 0n
  for (let index = 7; index >= 0; index--) value = (value << 8n) | BigInt(bytes[offset + index] ?? 0)
  return value
}

export const keccak256Bytes = (input: Uint8Array): Uint8Array<ArrayBuffer> => {
  const padded = new Uint8Array((Math.floor(input.length / RATE) + 1) * RATE)
  padded.set(input)
  padded[input.length] = 0x01
  padded[padded.length - 1] = (padded[padded.length - 1] ?? 0) | 0x80
  const state = Array.from({ length: 25 }, () => 0n)
  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let index = 0; index < RATE / 8; index++)
      state[index] = lane(state, index) ^ readLane(padded, offset + index * 8)
    permute(state)
  }
  const out = new Uint8Array(32)
  for (let index = 0; index < 32; index++)
    out[index] = Number((lane(state, index >> 3) >> BigInt((index & 7) * 8)) & 0xffn)
  return out
}

export const keccak256 = (input: Uint8Array): Hex => bytesToHex(keccak256Bytes(input))

export const keccak256Utf8 = (text: string): Hex => keccak256(utf8ToBytes(text))
