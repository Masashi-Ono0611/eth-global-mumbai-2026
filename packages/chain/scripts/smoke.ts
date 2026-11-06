import { readFileSync } from 'node:fs'
import { generateId } from '@ethmumbai/protocol/Base32'
import { delegationHash, type Delegation } from '@ethmumbai/protocol/Delegation'
import { ARC_USDC, invoiceHash, jsonHash, usdcToUnits } from '@ethmumbai/protocol/Invoice'
import type { PaymentPayload, PaymentRequirements } from '@ethmumbai/protocol/X402'
import { Clock, Console, Effect } from 'effect'
import { type Address, createWalletClient, getAddress, type Hex, http, type StateOverride } from 'viem'
import { generatePrivateKey, type LocalAccount, privateKeyToAccount } from 'viem/accounts'
import {
  arcAddresses,
  arcChain,
  buildGrant,
  buildLeaf,
  buildRevoke,
  counterfactualEoaAccount,
  delegationHashOf,
  encodePermissionContext,
  makeArcClient,
  makeMemoryRelayerStore,
  makeRelayer,
  redeemCalldata,
  revokeExecution,
  settlementCall,
  settlePayment,
  signLeaf,
  verifyPayment,
} from '../src/index.ts'

// Mainnet smoke (spec §11 step 3): a fresh EOA-owned HybridDeleGator, funded and deployed by the relayer, grants a fresh
// chip key a tiny daily budget (stock enforcers only); the chip signs one leaf; the facilitator settles it on Arc; the
// same invoice is refused (IdEnforcer), the owner revokes the grant, and the next payment is refused
// (CannotUseADisabledDelegation). Refusals are proven by simulation from the relayer, never by paying for a revert.
// Usage: heavy --wait bun packages/chain/scripts/smoke.ts --amount 0.01 [--env-file .env.main.local]
// Prints only addresses, hashes and reasons; never a key or a signature.
const argument = (name: string) => {
  const index = Bun.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : Bun.argv[index + 1]
}
const envFile = argument('env-file') ?? '.env.main.local'
const fileEnv = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .flatMap((line) => {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      return match?.[1] === undefined ? [] : [[match[1], match[2] ?? ''] as const]
    }),
)
const setting = (name: string) => process.env[name] ?? fileEnv[name]
const relayerKey = setting('APP_RELAYER_PRIVATE_KEY')
if (relayerKey === undefined || !/^0x[0-9a-f]{64}$/.test(relayerKey)) throw new Error('APP_RELAYER_PRIVATE_KEY missing')
const rpcSetting = setting('APP_ARC_RPC_URL')
const rpcUrl = rpcSetting !== undefined && rpcSetting.startsWith('https://') ? rpcSetting : 'https://rpc.mainnet.arc.io'
const amount = usdcToUnits(argument('amount') ?? '0.01')
if (amount <= 0n || amount > 50_000n) throw new Error('--amount must be in (0, 0.05] USDC')
const payTo = getAddress(setting('APP_MERCHANT_PAY_TO') ?? privateKeyToAccount(generatePrivateKey()).address)

const client = makeArcClient(rpcUrl)
const relayer = makeRelayer({ client, privateKey: `0x${relayerKey.slice(2)}`, store: makeMemoryRelayerStore() })
const explorer = (hash: Hex) => `https://explorer.arc.io/tx/${hash}`
const step = (label: string, detail: string) => Console.log(`${label.padEnd(16)} ${detail}`)
const now = Clock.currentTimeMillis.pipe(Effect.map((millis) => Math.floor(millis / 1000)))
const dryRun = Bun.argv.includes('--dry-run')

const fundOwner = Effect.fn('smoke.fundOwner')(function* (owner: Address, value: bigint) {
  const wallet = createWalletClient({
    account: privateKeyToAccount(`0x${relayerKey.slice(2)}`),
    chain: arcChain,
    transport: http(rpcUrl),
  })
  const hash = yield* Effect.promise(() =>
    wallet.sendTransaction({ to: owner, value, maxFeePerGas: 40_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }),
  )
  const receipt = yield* Effect.promise(() => client.waitForTransactionReceipt({ hash, timeout: 60_000 }))
  return { hash, status: receipt.status }
})

const invoiceFor = Effect.fn('smoke.invoice')(function* (expiresAt: number) {
  const id = yield* generateId
  const lines = [{ name: 'Smoke chai', qty: 1, sku: 'chai', unitAmount: amount.toString() }]
  const fields = {
    merchantId: 'duck-cafe',
    id,
    payTo,
    asset: ARC_USDC,
    amount: amount.toString(),
    expiresAt,
    linesHash: jsonHash(lines),
    rulesHash: jsonHash([]),
  }
  return { ...fields, invoiceHash: invoiceHash(fields) }
})

const paymentFor = Effect.fn('smoke.payment')(function* (
  chip: LocalAccount,
  owner: Address,
  grant: Delegation,
  expiresAt: number,
) {
  const invoice = yield* invoiceFor(expiresAt)
  const leaf = buildLeaf({
    chip: chip.address,
    grantHash: delegationHashOf(grant),
    relayer: relayer.address,
    invoiceHash: invoice.invoiceHash,
    payTo,
    amount,
    expiresAt,
  })
  const signedLeaf = yield* signLeaf(chip, leaf)
  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: 'eip155:5042',
    asset: ARC_USDC,
    payTo,
    amount: amount.toString(),
    maxTimeoutSeconds: 120,
    extra: {
      assetTransferMethod: 'erc7710',
      invoiceHash: invoice.invoiceHash,
      invoiceId: invoice.id,
      expiresAt,
      delegationManager: arcAddresses.delegationManager,
      facilitators: [relayer.address],
      paymentIdentifier: invoice.id,
    },
  }
  const payment: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: {
      delegationManager: arcAddresses.delegationManager,
      permissionContext: encodePermissionContext([signedLeaf, grant]),
      delegator: owner,
    },
  }
  return { invoice, requirements, payment }
})

type History = { readonly prelude?: readonly { to: Address; data: Hex }[]; readonly stateOverride?: StateOverride }

const expectRefusal = Effect.fn('smoke.expectRefusal')(function* (
  label: string,
  payment: PaymentPayload,
  requirements: PaymentRequirements,
  expected: string,
  history: History = {},
) {
  const verified = yield* verifyPayment({ client, relayer: relayer.address }, payment, requirements, history)
  const revert = verified.simulation.revert ?? '(simulation passed)'
  const ok = !verified.isValid && revert.includes(expected)
  yield* step(label, `${ok ? 'REFUSED as expected' : 'UNEXPECTED'}: ${revert}`)
  return ok
})

const setup = Effect.gen(function* () {
  const ownerKey = privateKeyToAccount(generatePrivateKey())
  const chip = privateKeyToAccount(generatePrivateKey())
  const accountId = yield* generateId
  const owner = yield* counterfactualEoaAccount(accountId, ownerKey.address)
  yield* step(
    'mode',
    dryRun ? 'DRY RUN (eth_call simulation on live Arc state, nothing broadcast)' : 'MAINNET broadcast',
  )
  yield* step('relayer', relayer.address)
  yield* step('owner account', `${owner.smartAccount} (EOA-owned Hybrid, fresh)`)
  yield* step('chip', `${chip.address} (fresh)`)
  yield* step('merchant payTo', payTo)
  const startAt = (yield* now) - 120
  const grantUnsigned = buildGrant({
    grantId: accountId,
    owner: owner.smartAccount,
    chip: chip.address,
    dailyCap: amount * 3n,
    perPaymentCap: amount,
    allowlist: [payTo],
    startAt,
    expiresAt: startAt + 3_600,
  })
  const grant = yield* signLeaf(ownerKey, grantUnsigned)
  const revoke = yield* signLeaf(ownerKey, buildRevoke({ grantId: accountId, grant, relayer: relayer.address }))
  const revokeCall = {
    to: arcAddresses.delegationManager,
    data: redeemCalldata(encodePermissionContext([revoke]), revokeExecution(grant)),
  }
  const deployCall = { to: owner.factory, data: owner.factoryData }
  const first = yield* paymentFor(chip, owner.smartAccount, grant, (yield* now) + 600)
  const next = yield* paymentFor(chip, owner.smartAccount, grant, (yield* now) + 600)
  yield* step('grant', `${delegationHash(grantUnsigned)} (owner EOA signature, stock enforcers)`)
  yield* step('invoice', `${first.invoice.id} ${first.invoice.invoiceHash}`)
  return { owner, grantHash: delegationHash(grantUnsigned), revokeCall, deployCall, first, next }
})
type Setup = Effect.Success<typeof setup>

/** Every step as one simulated history from the relayer: deploy (+ funds by override) → settle → replay → revoke. */
const dryRunSteps = Effect.fn('smoke.dryRun')(function* (run: Setup) {
  const stateOverride: StateOverride = [{ address: run.owner.smartAccount, balance: 10n ** 18n }]
  const { first, next, deployCall, revokeCall } = run
  const settle = yield* verifyPayment({ client, relayer: relayer.address }, first.payment, first.requirements, {
    prelude: [deployCall],
    stateOverride,
  })
  yield* step('settle (sim)', settle.isValid ? 'would succeed' : `UNEXPECTED: ${settle.invalidReason ?? ''}`)
  const replay = yield* expectRefusal('replay (sim)', first.payment, first.requirements, 'IdEnforcer:id-already-used', {
    prelude: [deployCall, settlementCall(first.payment, first.requirements)],
    stateOverride,
  })
  const afterRevoke = yield* expectRefusal(
    'after revoke',
    next.payment,
    next.requirements,
    'CannotUseADisabledDelegation',
    {
      prelude: [deployCall, revokeCall],
      stateOverride,
    },
  )
  return settle.isValid && replay && afterRevoke
})

const broadcastSteps = Effect.fn('smoke.broadcast')(function* (run: Setup) {
  const { owner, first, next } = run
  const funded = yield* fundOwner(owner.smartAccount, amount * 2n * 1_000_000_000_000n)
  yield* step('fund owner', `${funded.status} ${explorer(funded.hash)}`)
  const deploy = yield* relayer.send({ key: `deploy:${owner.smartAccount}`, kind: 'deploy', ...run.deployCall })
  yield* step('deploy', `${deploy.success ? 'success' : 'REVERTED'} gas=${deploy.gasUsed} ${explorer(deploy.txHash)}`)
  const settled = yield* settlePayment(client, relayer, first.payment, first.requirements)
  yield* step('settle', `success gas=${settled.gasUsed} ${explorer(settled.transaction)}`)
  const replay = yield* expectRefusal('replay', first.payment, first.requirements, 'IdEnforcer:id-already-used')
  const revoked = yield* relayer.send({ key: `revoke:${run.grantHash}`, kind: 'revoke', ...run.revokeCall })
  yield* step(
    'revoke',
    `${revoked.success ? 'success' : 'REVERTED'} gas=${revoked.gasUsed} ${explorer(revoked.txHash)}`,
  )
  const afterRevoke = yield* expectRefusal(
    'after revoke',
    next.payment,
    next.requirements,
    'CannotUseADisabledDelegation',
  )
  return funded.status === 'success' && deploy.success && revoked.success && replay && afterRevoke
})

const program = setup.pipe(Effect.flatMap((run) => (dryRun ? dryRunSteps(run) : broadcastSteps(run))))

const passed = await Effect.runPromise(
  program.pipe(
    Effect.catch((error) =>
      Console.error(`smoke failed: ${'message' in error ? error.message : JSON.stringify(error)}`).pipe(
        Effect.as(false),
      ),
    ),
  ),
)
process.exit(passed ? 0 : 1)
