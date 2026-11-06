import { generateId } from '@ethmumbai/protocol/Base32'
import { delegationDigest, type Delegation } from '@ethmumbai/protocol/Delegation'
import { ARC_USDC, invoiceHash, jsonHash } from '@ethmumbai/protocol/Invoice'
import type { PaymentPayload, PaymentRequirements } from '@ethmumbai/protocol/X402'
import { Effect } from 'effect'
import { hexToBytes, type StateOverride } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import {
  arcAddresses,
  buildGrant,
  buildLeaf,
  buildRevoke,
  counterfactualAccount,
  delegationHashOf,
  encodeDeleGatorSignature,
  encodePermissionContext,
  makeArcClient,
  redeemCalldata,
  revokeExecution,
  settlementCall,
  signLeaf,
  verifyPayment,
} from '../src/index.ts'
import { keyId, makeAuthenticator } from './SoftwarePasskey.ts'

// Tag live-arc (spec §5): eth_call / eth_estimateGas against live Arc mainnet state, nothing broadcast. A software
// passkey owns a counterfactual HybridDeleGator, deployed inside the simulated history; the passkey signs the grant's
// EIP-712 digest and our encoder produces the signature Arc's P-256 verifier checks. Skipped without ARC_RPC_URL.
const rpcUrl = process.env.ARC_RPC_URL
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
const relayer = privateKeyToAccount(generatePrivateKey()).address
const payTo = privateKeyToAccount(generatePrivateKey()).address
const amount = 10_000n

const passkeyOwnedGrant = async () => {
  const passkey = await makeAuthenticator()
  const accountId = await run(generateId)
  const owner = await run(counterfactualAccount({ accountId, keyId, x: String(passkey.x), y: String(passkey.y) }))
  const chip = privateKeyToAccount(generatePrivateKey())
  const now = Math.floor(Date.now() / 1000)
  const grantFor = (delegate: `0x${string}`) =>
    buildGrant({
      grantId: accountId,
      owner: owner.smartAccount,
      chip: delegate,
      dailyCap: amount * 3n,
      perPaymentCap: amount,
      allowlist: [payTo],
      startAt: now - 120,
      expiresAt: now + 3_600,
    })
  const sign = async (unsigned: ReturnType<typeof grantFor>): Promise<Delegation> => {
    const assertion = await passkey.assert(hexToBytes(delegationDigest(unsigned)))
    return { ...unsigned, signature: encodeDeleGatorSignature({ keyId, ...assertion }) }
  }
  const grant = await sign(grantFor(chip.address))
  // A real passkey signature, but over another delegation: Arc must refuse it for this grant.
  const otherSignature = (await sign(grantFor(relayer))).signature
  return { owner, passkey, accountId, chip, grant, forged: { ...grant, signature: otherSignature } }
}

const paymentFor = async (chip: ReturnType<typeof privateKeyToAccount>, grant: Delegation, owner: `0x${string}`) => {
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
      permissionContext: encodePermissionContext([leaf, grant]),
      delegator: owner,
    },
  }
  return { payment, requirements }
}

describe.skipIf(rpcUrl === undefined)('live Arc (simulation only)', () => {
  const client = makeArcClient(rpcUrl ?? 'https://rpc.mainnet.arc.io')
  const context = { client, relayer }

  test('a passkey-owned Hybrid pays through a chip leaf; replay, revoke and a foreign signature are refused', async () => {
    const setup = await passkeyOwnedGrant()
    const { grant, chip, owner, passkey } = setup
    const stateOverride: StateOverride = [{ address: owner.smartAccount, balance: 10n ** 18n }]
    const deploy = { to: owner.factory, data: owner.factoryData }
    const first = await paymentFor(chip, grant, owner.smartAccount)

    const settle = await run(
      verifyPayment(context, first.payment, first.requirements, { prelude: [deploy], stateOverride }),
    )
    expect(settle.checks.filter((check) => !check.ok)).toEqual([])
    expect(settle.simulation).toEqual({ ok: true })

    const replay = await run(
      verifyPayment(context, first.payment, first.requirements, {
        prelude: [deploy, settlementCall(first.payment, first.requirements)],
        stateOverride,
      }),
    )
    expect(replay.simulation.revert).toContain('IdEnforcer:id-already-used')

    const revokeUnsigned = buildRevoke({ grantId: setup.accountId, grant, relayer })
    const revokeAssertion = await passkey.assert(hexToBytes(delegationDigest(revokeUnsigned)))
    const revoke: Delegation = { ...revokeUnsigned, signature: encodeDeleGatorSignature({ keyId, ...revokeAssertion }) }
    const revokeCall = {
      to: arcAddresses.delegationManager,
      data: redeemCalldata(encodePermissionContext([revoke]), revokeExecution(grant)),
    }
    const next = await paymentFor(chip, grant, owner.smartAccount)
    const afterRevoke = await run(
      verifyPayment(context, next.payment, next.requirements, { prelude: [deploy, revokeCall], stateOverride }),
    )
    expect(afterRevoke.simulation.revert).toContain('CannotUseADisabledDelegation')

    const tampered = await paymentFor(chip, setup.forged, owner.smartAccount)
    const refused = await run(
      verifyPayment(context, tampered.payment, tampered.requirements, { prelude: [deploy], stateOverride }),
    )
    expect(refused.simulation.ok).toBe(false)
  }, 120_000)
})
