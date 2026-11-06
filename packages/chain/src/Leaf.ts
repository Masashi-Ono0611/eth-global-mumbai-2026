import { buildLeaf, type Delegation, type LeafInput, type UnsignedDelegation } from '@ethmumbai/protocol/Delegation'
import { Effect } from 'effect'
import { type Address, type Hex, isAddressEqual, recoverTypedDataAddress, zeroAddress } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { DELEGATION_TYPES, delegationDomain, delegationMessage } from './Hashes.ts'

export { buildLeaf, type LeafInput }

/** The chip's 65-byte `r‖s‖v` signature over the leaf's EIP-712 digest (mock chip, smoke script, tests). */
export const signLeaf = (account: LocalAccount, leaf: UnsignedDelegation, delegationManager?: Address) =>
  Effect.promise(() =>
    account.signTypedData({
      domain: delegationDomain(delegationManager),
      types: DELEGATION_TYPES,
      primaryType: 'Delegation',
      message: delegationMessage(leaf),
    }),
  ).pipe(Effect.map((signature): Delegation => ({ ...leaf, signature })))

/** Off-chain ECDSA recovery of an EOA-signed delegation; the zero address when the signature does not parse. */
export const recoverDelegationSigner = (delegation: Delegation, delegationManager?: Address) =>
  Effect.promise(() =>
    recoverTypedDataAddress({
      domain: delegationDomain(delegationManager),
      types: DELEGATION_TYPES,
      primaryType: 'Delegation',
      message: delegationMessage(delegation),
      signature: delegation.signature,
    }).catch((): Address => zeroAddress),
  )

export const isSignedBy = (delegation: Delegation, signer: Hex, delegationManager?: Address) =>
  recoverDelegationSigner(delegation, delegationManager).pipe(Effect.map((who) => isAddressEqual(who, signer)))
