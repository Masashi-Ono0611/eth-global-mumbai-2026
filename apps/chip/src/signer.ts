import { pairMessage } from '@ethmumbai/protocol/Chip'
import { ARC_DELEGATION_MANAGER, delegationHash, type UnsignedDelegation } from '@ethmumbai/protocol/Delegation'
import type { Hex } from '@ethmumbai/protocol/Hex'
import { ARC_CHAIN_ID } from '@ethmumbai/protocol/Invoice'
import { Effect, Option } from 'effect'
import { recoverAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { ChipState } from './state.ts'

const DELEGATION_TYPES = {
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

/** The chip's key: generated once into key.json (mode 600) and never printed. */
export const loadOrCreateKey = (state: ChipState) =>
  Effect.gen(function* () {
    const existing = yield* state.readKey
    if (Option.isSome(existing)) return { privateKey: existing.value.privateKey, created: false }
    const privateKey = generatePrivateKey()
    yield* state.writeKey(privateKey)
    return { privateKey, created: true }
  })

export const makeSigner = (privateKey: Hex) => {
  const account = privateKeyToAccount(privateKey)
  return {
    address: account.address,
    /** EIP-191 `personal_sign` of `Vitaquack pair <code> <address lowercase> 5042`. */
    signPairing: (code: string) =>
      Effect.promise(() => account.signMessage({ message: pairMessage(code, account.address) })),
    /** EIP-712 `Delegation` under the DelegationManager's domain; `args` are not part of the signed struct. */
    signLeaf: (leaf: UnsignedDelegation) =>
      Effect.promise(() =>
        account.signTypedData({
          domain: {
            name: 'DelegationManager',
            version: '1',
            chainId: ARC_CHAIN_ID,
            verifyingContract: ARC_DELEGATION_MANAGER,
          },
          types: DELEGATION_TYPES,
          primaryType: 'Delegation',
          message: {
            delegate: leaf.delegate,
            delegator: leaf.delegator,
            authority: leaf.authority,
            caveats: leaf.caveats.map(({ enforcer, terms }) => ({ enforcer, terms })),
            salt: BigInt(leaf.salt),
          },
        }),
      ).pipe(Effect.map((signature) => ({ signature, leafHash: delegationHash(leaf) }))),
  }
}

export type Signer = ReturnType<typeof makeSigner>

/** Who signed an approval digest (the approver signs the raw hash). Unrecoverable input → undefined. */
export const recoverDigestSigner = (digest: Hex, signature: Hex) =>
  Effect.tryPromise(() => recoverAddress({ hash: digest, signature })).pipe(
    Effect.map((address): Hex | undefined => address),
    Effect.orElseSucceed(() => undefined),
  )
