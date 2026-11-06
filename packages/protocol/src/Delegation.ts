import { Schema } from 'effect'
import {
  Address,
  Bytes32,
  bytesToHex,
  concatBytes,
  type Hex,
  HexBytes,
  hexToBytes,
  uintToBytes,
  UintString,
  utf8ToBytes,
} from './Hex.ts'
import { ARC_CHAIN_ID, ARC_USDC } from './Invoice.ts'
import { keccak256, keccak256Bytes } from './Keccak.ts'

// MetaMask Delegation Framework v1.3.0 on Arc (delegation-deployments 2.1.0). Server code takes addresses from the kit's
// `getSmartAccountsEnvironment(5042)`; the chip has no kit, so it pins the few it re-derives a leaf from. A chain test
// asserts these equal the kit's, so a deployment change fails the gate instead of silently diverging.
export const ARC_DELEGATION_MANAGER: Hex = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3'
export const LEAF_ENFORCERS = {
  ExactExecutionEnforcer: '0x146713078D39eCC1F5338309c28405ccf85Abfbb',
  IdEnforcer: '0xC8B5D93463c893401094cc70e66A206fb5987997',
  TimestampEnforcer: '0x1046bb45C8d673d4ea75321280DB34899413c069',
  RedeemerEnforcer: '0xE144b0b2618071B4E56f746313528a669c7E65c5',
} as const satisfies Record<string, Hex>
export const ANY_BENEFICIARY: Hex = '0x0000000000000000000000000000000000000a11'
export const ROOT_AUTHORITY: Hex = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
export const TRANSFER_SELECTOR: Hex = '0xa9059cbb'

export const Caveat = Schema.Struct({ enforcer: Address, terms: HexBytes, args: HexBytes })
export type Caveat = typeof Caveat.Type

/** A delegation on the wire: `salt` is a decimal string (JSON has no bigint). */
export const UnsignedDelegation = Schema.Struct({
  delegate: Address,
  delegator: Address,
  authority: Bytes32,
  caveats: Schema.Array(Caveat),
  salt: UintString,
})
export type UnsignedDelegation = typeof UnsignedDelegation.Type

export const Delegation = Schema.Struct({ ...UnsignedDelegation.fields, signature: HexBytes })
export type Delegation = typeof Delegation.Type

/** The DelegationManager's EIP-712 types (viem `signTypedData` shape), shared by the chip and the server. */
export const DELEGATION_TYPES = {
  Delegation: [
    { name: 'delegate', type: 'address' },
    { name: 'delegator', type: 'address' },
    { name: 'authority', type: 'bytes32' },
    { name: 'caveats', type: 'Caveat[]' },
    { name: 'salt', type: 'uint256' },
  ],
  Caveat: [
    { name: 'enforcer', type: 'address' },
    { name: 'terms', type: 'bytes' },
  ],
} as const

export const delegationDomain = (delegationManager: Hex = ARC_DELEGATION_MANAGER) =>
  ({ name: 'DelegationManager', version: '1', chainId: ARC_CHAIN_ID, verifyingContract: delegationManager }) as const

/** The signed message of a wire delegation (salt as bigint, caveat args dropped). */
export const delegationMessage = (delegation: UnsignedDelegation) => ({
  delegate: delegation.delegate,
  delegator: delegation.delegator,
  authority: delegation.authority,
  caveats: delegation.caveats.map((caveat) => ({ enforcer: caveat.enforcer, terms: caveat.terms })),
  salt: BigInt(delegation.salt),
})

const CAVEAT_TYPE = 'Caveat(address enforcer,bytes terms)'
const DELEGATION_TYPE = `Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)${CAVEAT_TYPE}`
const word = (hex: Hex, size: number) => concatBytes(new Uint8Array(32 - size), hexToBytes(hex))

/** The DelegationManager's `getDelegationHash` (EIP-712 struct hash; `args` and `signature` are not hashed). */
export const delegationHash = (delegation: UnsignedDelegation): Hex => {
  const caveatHashes = delegation.caveats.map((caveat) =>
    keccak256Bytes(
      concatBytes(
        keccak256Bytes(utf8ToBytes(CAVEAT_TYPE)),
        word(caveat.enforcer, 20),
        keccak256Bytes(hexToBytes(caveat.terms)),
      ),
    ),
  )
  return keccak256(
    concatBytes(
      keccak256Bytes(utf8ToBytes(DELEGATION_TYPE)),
      word(delegation.delegate, 20),
      word(delegation.delegator, 20),
      hexToBytes(delegation.authority),
      keccak256Bytes(concatBytes(...caveatHashes)),
      uintToBytes(BigInt(delegation.salt), 32),
    ),
  )
}

/** `transfer(to, amount)` calldata (68 bytes). */
export const transferCalldata = (to: Hex, amount: bigint): Uint8Array<ArrayBuffer> =>
  concatBytes(hexToBytes(TRANSFER_SELECTOR), word(to, 20), uintToBytes(amount, 32))

/** The single execution a payment redeems: `encodePacked(address token, uint256 0, bytes transfer(payTo, amount))`. */
export const transferExecution = (payTo: Hex, amount: bigint, token: Hex = ARC_USDC): Uint8Array<ArrayBuffer> =>
  concatBytes(hexToBytes(token), uintToBytes(0n, 32), transferCalldata(payTo, amount))

/** `Timestamp` terms: `uint128 afterThreshold ‖ uint128 beforeThreshold`. */
export const timestampTerms = (after: bigint, before: bigint): Uint8Array<ArrayBuffer> =>
  concatBytes(uintToBytes(after, 16), uintToBytes(before, 16))

export type LeafInput = {
  readonly chip: Hex
  readonly grantHash: Hex
  readonly relayer: Hex
  readonly invoiceHash: Hex
  readonly payTo: Hex
  readonly amount: bigint
  readonly expiresAt: number
}

const caveat = (enforcer: Hex, terms: Uint8Array | Hex): Caveat => ({
  enforcer,
  terms: typeof terms === 'string' ? terms : bytesToHex(terms),
  args: '0x',
})

/**
 * The chip's one-time voucher (§5): chip → ANY_BENEFICIARY under the grant, salt = keccak256(invoiceHash), caveats
 * ExactExecution(USDC ‖ 0 ‖ transfer(payTo, amount)) · Id(invoiceHash) · Timestamp(0, expiresAt) · Redeemer(relayer).
 */
export const buildLeaf = (input: LeafInput): UnsignedDelegation => {
  return {
    delegate: ANY_BENEFICIARY,
    delegator: input.chip,
    authority: input.grantHash,
    caveats: [
      caveat(LEAF_ENFORCERS.ExactExecutionEnforcer, transferExecution(input.payTo, input.amount)),
      caveat(LEAF_ENFORCERS.IdEnforcer, input.invoiceHash),
      caveat(LEAF_ENFORCERS.TimestampEnforcer, timestampTerms(0n, BigInt(input.expiresAt))),
      caveat(LEAF_ENFORCERS.RedeemerEnforcer, input.relayer),
    ],
    salt: BigInt(keccak256(hexToBytes(input.invoiceHash))).toString(),
  }
}

const sameHex = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

/** Field-by-field equality of two unsigned delegations (addresses and hex compared case-insensitively). */
export const sameDelegation = (left: UnsignedDelegation, right: UnsignedDelegation): boolean =>
  sameHex(left.delegate, right.delegate) &&
  sameHex(left.delegator, right.delegator) &&
  sameHex(left.authority, right.authority) &&
  left.salt === right.salt &&
  left.caveats.length === right.caveats.length &&
  left.caveats.every((entry, index) => {
    const other = right.caveats[index]
    return (
      other !== undefined &&
      sameHex(entry.enforcer, other.enforcer) &&
      sameHex(entry.terms, other.terms) &&
      sameHex(entry.args, other.args)
    )
  })
