import { existsSync, readFileSync } from 'node:fs'
import { generateId } from '@ethmumbai/protocol/Base32'
import { approvalNonce } from '@ethmumbai/protocol/Approval'
import type { Delegation } from '@ethmumbai/protocol/Delegation'
import { Schema } from 'effect'
import type { Address, StateOverride } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import {
  buildGrant,
  counterfactualEoaAccount,
  makeApprover,
  makeArcClient,
  signLeaf,
  verifyPayment,
  withApprovalArgs,
} from '../src/index.ts'
import { paymentFor, run } from './LivePayments.ts'

// The approval path end to end on live Arc state, before the enforcer is deployed: Foundry's compiled
// RobotPaymentPolicyEnforcer runtime code is injected at a fixed address by state override, the grant carries its
// caveat, and our approver's EIP-712 signature travels in the caveat args. Skipped without ARC_RPC_URL or the artifact
// (`cd contracts && forge build`).
const rpcUrl = process.env.ARC_RPC_URL
// ENFORCER_ARTIFACT points at a Foundry artifact built elsewhere (`forge build -o <dir>`); default: contracts/out.
const artifactPath =
  process.env.ENFORCER_ARTIFACT ??
  new URL('../../../contracts/out/RobotPaymentPolicyEnforcer.sol/RobotPaymentPolicyEnforcer.json', import.meta.url)
    .pathname
const Artifact = Schema.Struct({
  deployedBytecode: Schema.Struct({ object: Schema.TemplateLiteral(['0x', Schema.String]) }),
})
const runtimeCode = existsSync(artifactPath)
  ? Schema.decodeUnknownSync(Schema.fromJsonString(Artifact))(readFileSync(artifactPath, 'utf8')).deployedBytecode
      .object
  : undefined
const enforcer: Address = '0x00000000000000000000000000000000000e4f01'
const relayer = privateKeyToAccount(generatePrivateKey()).address
const merchant = privateKeyToAccount(generatePrivateKey()).address
const restricted = privateKeyToAccount(generatePrivateKey()).address
const cap = 10_000n

describe.skipIf(rpcUrl === undefined || runtimeCode === undefined)('live Arc approval path (simulation only)', () => {
  const client = makeArcClient(rpcUrl ?? 'https://rpc.mainnet.arc.io')
  const context = { client, relayer }

  test('cap and allowlist hold without an approval; one valid approval lets exactly that payment through', async () => {
    const ownerKey = privateKeyToAccount(generatePrivateKey())
    const chip = privateKeyToAccount(generatePrivateKey())
    const approver = makeApprover(generatePrivateKey())
    const accountId = await run(generateId)
    const owner = await run(counterfactualEoaAccount(accountId, ownerKey.address))
    const now = Math.floor(Date.now() / 1000)
    const grant = await run(
      signLeaf(
        ownerKey,
        buildGrant({
          grantId: accountId,
          owner: owner.smartAccount,
          chip: chip.address,
          dailyCap: cap * 10n,
          perPaymentCap: cap,
          allowlist: [merchant],
          startAt: now - 120,
          expiresAt: now + 3_600,
          enforcer,
          approver: approver.address,
        }),
      ),
    )
    const stateOverride: StateOverride = [
      { address: owner.smartAccount, balance: 10n ** 18n },
      { address: enforcer, code: runtimeCode },
    ]
    const hooks = { prelude: [{ to: owner.factory, data: owner.factoryData }], stateOverride }
    const approve =
      (signer: typeof approver, payee: Address, amount: bigint) =>
      async (base: Delegation, invoiceHash: `0x${string}`) => {
        const fields = { invoiceHash, payee, amount: amount.toString(), expiry: now + 300 }
        const signed = await run(signer.sign(enforcer, { ...fields, nonce: approvalNonce(enforcer, fields) }))
        return withApprovalArgs(base, enforcer, signed)
      }
    const pay = async (payTo: Address, amount: bigint, withArgs?: Parameters<typeof paymentFor>[0]['withArgs']) => {
      const { payment, requirements } = await paymentFor({
        chip,
        grant,
        owner: owner.smartAccount,
        relayer,
        payTo,
        amount,
        ...(withArgs === undefined ? {} : { withArgs }),
      })
      return (await run(verifyPayment(context, payment, requirements, hooks))).simulation
    }

    expect(await pay(merchant, cap)).toEqual({ ok: true })
    expect((await pay(merchant, cap + 1n)).revert).toContain('RPP:approval-required')
    expect((await pay(restricted, 5_000n)).revert).toContain('RPP:approval-required')
    expect(await pay(merchant, cap * 2n, approve(approver, merchant, cap * 2n))).toEqual({ ok: true })
    expect(await pay(restricted, 5_000n, approve(approver, restricted, 5_000n))).toEqual({ ok: true })
    expect((await pay(restricted, 5_000n, approve(approver, merchant, 5_000n))).revert).toContain(
      'RPP:approval-payee-mismatch',
    )
    expect((await pay(merchant, cap * 2n, approve(approver, merchant, cap * 3n))).revert).toContain(
      'RPP:approval-amount-mismatch',
    )
    const stranger = makeApprover(generatePrivateKey())
    expect((await pay(merchant, cap * 2n, approve(stranger, merchant, cap * 2n))).revert).toContain(
      'RPP:invalid-approval-signature',
    )
  }, 180_000)
})
