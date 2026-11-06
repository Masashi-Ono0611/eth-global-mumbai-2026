import type { Delegation as KitDelegation } from '@metamask/smart-accounts-kit'
import { decodeDelegations, encodeDelegations, hashDelegation } from '@metamask/smart-accounts-kit/utils'
import type { Delegation, UnsignedDelegation } from '@ethmumbai/protocol/Delegation'
import { getAddress, type Hex, toHex } from 'viem'

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

export { DELEGATION_TYPES, delegationDomain, delegationMessage } from '@ethmumbai/protocol/Delegation'
