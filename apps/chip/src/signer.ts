import { pairMessage } from '@ethmumbai/protocol/Chip'
import {
  DELEGATION_TYPES,
  delegationDomain,
  delegationHash,
  delegationMessage,
  type UnsignedDelegation,
} from '@ethmumbai/protocol/Delegation'
import type { Hex } from '@ethmumbai/protocol/Hex'
import { Effect, Option } from 'effect'
import { recoverAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { ChipState } from './state.ts'

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
    /** EIP-191 `personal_sign` of a scan's `scanMessage` (packages/protocol Scan.ts). */
    signScan: (message: string) => Effect.promise(() => account.signMessage({ message })),
    /** EIP-712 `Delegation` under the DelegationManager's domain; `args` are not part of the signed struct. */
    signLeaf: (leaf: UnsignedDelegation) =>
      Effect.promise(() =>
        account.signTypedData({
          domain: delegationDomain(),
          types: DELEGATION_TYPES,
          primaryType: 'Delegation',
          message: delegationMessage(leaf),
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
