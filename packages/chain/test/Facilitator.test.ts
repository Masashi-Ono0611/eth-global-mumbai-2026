import { generateId } from '@ethmumbai/protocol/Base32'
import type { Delegation } from '@ethmumbai/protocol/Delegation'
import type { PaymentPayload, PaymentRequirements } from '@ethmumbai/protocol/X402'
import { createPublicClient, custom, toHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import {
  arcChain,
  buildGrant,
  decodePermissionContext,
  encodePermissionContext,
  signLeaf,
  verifyPayment,
} from '../src/index.ts'
import { paymentFor, run } from './LivePayments.ts'

// The facilitator's structural checks (the S2 spike's negative cases N1, N2, N7, N8, N9 and the §7 fixes) against a
// node that would accept any simulation: each refusal must come from our own checks, named, before Arc is asked.
const acceptingNode = createPublicClient({
  chain: arcChain,
  transport: custom({
    request: async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return toHex(5042)
      if (method === 'eth_estimateGas') return toHex(505_000)
      throw new Error(`accepting node: ${method}`)
    },
  }),
})
const relayer = privateKeyToAccount(generatePrivateKey()).address
const payTo = privateKeyToAccount(generatePrivateKey()).address
const context = { client: acceptingNode, relayer }

const setup = async () => {
  const ownerKey = privateKeyToAccount(generatePrivateKey())
  const chip = privateKeyToAccount(generatePrivateKey())
  const now = Math.floor(Date.now() / 1000)
  const grant = await run(
    signLeaf(
      ownerKey,
      buildGrant({
        grantId: await run(generateId),
        owner: ownerKey.address,
        chip: chip.address,
        dailyCap: 1_000_000n,
        perPaymentCap: 100_000n,
        allowlist: [payTo],
        startAt: now - 60,
        expiresAt: now + 3_600,
      }),
    ),
  )
  const paid = await paymentFor({ chip, grant, owner: ownerKey.address, relayer, payTo, amount: 100_000n })
  return { ownerKey, chip, grant, ...paid }
}

const failedChecks = async (payment: PaymentPayload, requirements: PaymentRequirements) => {
  const result = await run(verifyPayment(context, payment, requirements))
  return { result, failed: result.checks.filter((check) => !check.ok).map((check) => check.name) }
}

describe('facilitator verify (offline)', () => {
  test('a well-formed payment passes every check and carries the simulated gas', async () => {
    const { payment, requirements } = await setup()
    const { result, failed } = await failedChecks(payment, requirements)
    expect(failed).toEqual([])
    expect(result).toMatchObject({ isValid: true, simulation: { ok: true, gas: 505_000n } })
  })

  test('settling a different amount or payee than the leaf signed is refused (N1, N2)', async () => {
    const { payment, requirements } = await setup()
    const more = { ...requirements, amount: '200000' }
    expect((await failedChecks({ ...payment, accepted: more }, more)).failed).toContain(
      'leaf ExactExecution == USDC.transfer(payTo, amount)',
    )
    const elsewhere = { ...requirements, payTo: relayer }
    expect((await failedChecks({ ...payment, accepted: elsewhere }, elsewhere)).failed).toContain(
      'leaf ExactExecution == USDC.transfer(payTo, amount)',
    )
    expect((await failedChecks(payment, more)).failed).toContain(
      'accepted == requirements (asset, payTo, amount, invoiceHash)',
    )
  })

  test('another relayer (front-runner) is not the leaf’s redeemer (N7)', async () => {
    const { payment, requirements } = await setup()
    const thief = { client: acceptingNode, relayer: privateKeyToAccount(generatePrivateKey()).address }
    const result = await run(verifyPayment(thief, payment, requirements))
    expect(result.checks.filter((check) => !check.ok).map((check) => check.name)).toEqual([
      'leaf Redeemer includes the relayer',
    ])
  })

  test('a leaf not signed by its chip is refused off-chain (N8)', async () => {
    const { payment, requirements, grant, ownerKey } = await setup()
    const leaf = decodePermissionContext(payment.payload.permissionContext)[0]
    if (leaf === undefined) throw new Error('context has a leaf')
    const forged: Delegation = await run(signLeaf(ownerKey, leaf))
    const tampered = {
      ...payment,
      payload: { ...payment.payload, permissionContext: encodePermissionContext([forged, grant]) },
    }
    expect((await failedChecks(tampered, requirements)).failed).toEqual([
      'leaf signature recovers to the chip (leaf.delegator)',
    ])
  })

  test('an unknown DelegationManager is refused and never simulated (N9)', async () => {
    const { payment, requirements } = await setup()
    const foreign = { ...payment, payload: { ...payment.payload, delegationManager: relayer } }
    const result = await run(verifyPayment(context, foreign, requirements))
    expect(result).toMatchObject({ isValid: false, invalidReason: 'delegationManager allowlisted' })
    expect(result.simulation).toEqual({ ok: false, revert: 'not simulated' })
  })

  test('an expired leaf and a garbage context are refused', async () => {
    const { payment, requirements } = await setup()
    const late = await run(
      verifyPayment(context, payment, requirements, { blockTime: BigInt(requirements.extra.expiresAt) }),
    )
    expect(late.checks.filter((check) => !check.ok).map((check) => check.name)).toContain(
      'leaf Timestamp bounds hold now',
    )
    const garbage = { ...payment, payload: { ...payment.payload, permissionContext: '0x1234' as const } }
    expect((await failedChecks(garbage, requirements)).failed).toEqual(['context is leaf → grant'])
  })
})
