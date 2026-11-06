import { generateId } from '@ethmumbai/protocol/Base32'
import type { Delegation } from '@ethmumbai/protocol/Delegation'
import { ARC_USDC, invoiceHash, jsonHash } from '@ethmumbai/protocol/Invoice'
import type { PaymentPayload, PaymentRequirements } from '@ethmumbai/protocol/X402'
import { Effect } from 'effect'
import type { Address } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { arcAddresses, buildLeaf, delegationHashOf, encodePermissionContext, signLeaf } from '../src/index.ts'

export const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

/** A chip-signed x402 payment of `amount` to `payTo` under `grant`, redeemable only by `relayer`. */
export const paymentFor = async (input: {
  readonly chip: LocalAccount
  readonly grant: Delegation
  readonly owner: Address
  readonly relayer: Address
  readonly payTo: Address
  readonly amount: bigint
  readonly withArgs?: (grant: Delegation, invoiceHash: `0x${string}`) => Promise<Delegation>
}) => {
  const { chip, grant, owner, relayer, payTo, amount } = input
  const id = await run(generateId)
  const expiresAt = Math.floor(Date.now() / 1000) + 600
  const fields = {
    merchantId: 'duck-cafe',
    id,
    payTo,
    asset: ARC_USDC,
    amount: amount.toString(),
    expiresAt,
    linesHash: jsonHash([]),
    rulesHash: jsonHash([]),
  }
  const hash = invoiceHash(fields)
  const leaf = await run(
    signLeaf(
      chip,
      buildLeaf({
        chip: chip.address,
        grantHash: delegationHashOf(grant),
        relayer,
        invoiceHash: hash,
        payTo,
        amount,
        expiresAt,
      }),
    ),
  )
  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: 'eip155:5042',
    asset: ARC_USDC,
    payTo,
    amount: amount.toString(),
    maxTimeoutSeconds: 120,
    extra: {
      assetTransferMethod: 'erc7710',
      invoiceHash: hash,
      invoiceId: id,
      expiresAt,
      delegationManager: arcAddresses.delegationManager,
      facilitators: [relayer],
      paymentIdentifier: id,
    },
  }
  const payment: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: {
      delegationManager: arcAddresses.delegationManager,
      permissionContext: encodePermissionContext([
        leaf,
        input.withArgs === undefined ? grant : await input.withArgs(grant, hash),
      ]),
      delegator: owner,
    },
  }
  return { payment, requirements, invoiceHash: hash }
}
