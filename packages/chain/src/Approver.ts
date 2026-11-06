import { type Approval, approvalDigest, type SignedApproval } from '@ethmumbai/protocol/Approval'
import { Effect } from 'effect'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

/**
 * The backend co-signer (D15): signs one `Approval` after a valid World ID token. Its address is the enforcer's
 * `approver` term, so a payment over the cap or to an unlisted payee lands only with this signature attached.
 */
export const makeApprover = (privateKey: Hex) => {
  const account = privateKeyToAccount(privateKey)
  const sign = Effect.fn('EthMumbai.Chain.Approver.sign')(function* (enforcer: Address, approval: Approval) {
    const signature = yield* Effect.promise(() => account.sign({ hash: approvalDigest(enforcer, approval) }))
    const signed: SignedApproval = { ...approval, signature }
    return signed
  })
  return { address: account.address, sign }
}
export type Approver = ReturnType<typeof makeApprover>
