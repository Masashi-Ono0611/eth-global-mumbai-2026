import type { Delegation as KitDelegation } from '@metamask/smart-accounts-kit'
import { decodeDelegations, encodeDelegations, hashDelegation } from '@metamask/smart-accounts-kit/utils'
import type { Delegation, UnsignedDelegation } from '@ethmumbai/protocol/Delegation'
import { type Address, getAddress, type Hex, toHex } from 'viem'
import { ARC_CHAIN_ID, arcAddresses } from './Env.ts'

// The wire form (`@ethmumbai/protocol`) carries `salt` as a decimal string; the kit's form carries it as hex.
export const toKitDelegation = (delegation: Delegation): KitDelegation => ({
  delegate: delegation.delegate,
  delegator: delegation.delegator,
  authority: delegation.authority,
  caveats: delegation.caveats.map((caveat) => ({ enforcer: caveat.enforcer, terms: caveat.terms, args: caveat.args })),
  salt: toHex(BigInt(delegation.salt)),
  signature: delegation.signature,
})

export const fromKitDelegation = (delegation: KitDelegation): Delegation => ({
  delegate: getAddress(delegation.delegate),
  delegator: getAddress(delegation.delegator),
  authority: delegation.authority,
  caveats: delegation.caveats.map((caveat) => ({
    enforcer: getAddress(caveat.enforcer),
    terms: caveat.terms,
    args: caveat.args,
  })),
  salt: BigInt(delegation.salt).toString(),
  signature: delegation.signature,
})

/** The kit's `hashDelegation` over a wire delegation (signature and args are not hashed). */
export const delegationHashOf = (delegation: UnsignedDelegation): Hex =>
  hashDelegation(toKitDelegation({ ...delegation, signature: '0x' }))

/** `encodeDelegations` for a chain ordered leaf first, root last (the permission context). */
export const encodePermissionContext = (chain: readonly Delegation[]): Hex =>
  encodeDelegations(chain.map(toKitDelegation))

export const decodePermissionContext = (context: Hex): readonly Delegation[] =>
  decodeDelegations(context).map(fromKitDelegation)

/** EIP-712 typed data of a delegation for the DelegationManager on Arc (what the chip and owner sign). */
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

export const delegationDomain = (delegationManager: Address = arcAddresses.delegationManager) =>
  ({ name: 'DelegationManager', version: '1', chainId: ARC_CHAIN_ID, verifyingContract: delegationManager }) as const

export const delegationMessage = (delegation: UnsignedDelegation) => ({
  delegate: delegation.delegate,
  delegator: delegation.delegator,
  authority: delegation.authority,
  caveats: delegation.caveats.map((caveat) => ({ enforcer: caveat.enforcer, terms: caveat.terms })),
  salt: BigInt(delegation.salt),
})
