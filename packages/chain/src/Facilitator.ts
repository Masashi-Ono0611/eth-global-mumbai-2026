import { ANY_BENEFICIARY, type Delegation, ROOT_AUTHORITY } from '@ethmumbai/protocol/Delegation'
import { ARC_NETWORK } from '@ethmumbai/protocol/Invoice'
import type { Check, PaymentPayload, PaymentRequirements } from '@ethmumbai/protocol/X402'
import { Clock, Effect, Schema } from 'effect'
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  isAddressEqual,
  parseAbi,
  type StateOverride,
} from 'viem'
import { type ArcClient, reasonOf, revertReason } from './Arc.ts'
import { arcAddresses, MULTICALL3, USDC } from './Env.ts'
import { redeemCalldata, singleExecution, transferCall } from './Grant.ts'
import { decodePermissionContext, delegationHashOf } from './Hashes.ts'
import { isSignedBy } from './Leaf.ts'
import type { Relayer, RelayerError } from './Relayer.ts'

// Our x402 `exact` + ERC-7710 facilitator for Arc (port of docs/research/spikes/s2-facilitator-spike.ts.txt with the
// spec §7 fixes): structural checks on the decoded permission context, off-chain recovery of the chip's leaf signature,
// and ALWAYS a simulation from the relayer. Arc's enforcers remain the authority; these checks only refuse early.
export type Simulation = { readonly ok: boolean; readonly revert?: string; readonly gas?: bigint }
export type VerifyResult = {
  readonly isValid: boolean
  readonly invalidReason?: string
  readonly payer: Address
  readonly checks: readonly Check[]
  readonly simulation: Simulation
}

/** Test hooks: state overrides, a block time, and earlier calls replayed in the same simulation (Multicall3 trick). */
export type SimulationHooks = {
  readonly stateOverride?: StateOverride
  readonly blockTime?: bigint
  readonly prelude?: readonly { readonly to: Address; readonly data: Hex }[]
  readonly multicallCode?: Hex
}

export class SettlementRejected extends Schema.TaggedError<SettlementRejected>()('SettlementRejected', {
  reason: Schema.String,
  checks: Schema.Array(
    Schema.Struct({ name: Schema.String, ok: Schema.Boolean, detail: Schema.optionalKey(Schema.String) }),
  ),
}) {}

export type SettleOutcome = { readonly transaction: Hex; readonly payer: Address; readonly gasUsed: bigint }

const multicallAbi = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
])

const sameHex = (left: string | undefined, right: string) => left?.toLowerCase() === right.toLowerCase()
const caveatTerms = (delegation: Delegation, enforcer: Address) =>
  delegation.caveats.find((caveat) => isAddressEqual(caveat.enforcer, enforcer))?.terms
const timestampBounds = (terms: Hex | undefined) =>
  terms === undefined || terms.length !== 66
    ? undefined
    : { after: BigInt(`0x${terms.slice(2, 34)}`), before: BigInt(`0x${terms.slice(34)}`) }
/** Redeemer terms are packed 20-byte addresses. */
const redeemers = (terms: Hex | undefined) =>
  terms === undefined ? [] : (terms.slice(2).match(/.{40}/g) ?? []).map((chunk) => `0x${chunk}`)

export const paymentExecution = (requirements: PaymentRequirements): Hex =>
  singleExecution(requirements.asset, transferCall(requirements.payTo, BigInt(requirements.amount)))

/** The relayer's `redeemDelegations` call for a payment. */
export const settlementCall = (payment: PaymentPayload, requirements: PaymentRequirements) => ({
  to: payment.payload.delegationManager,
  data: redeemCalldata(payment.payload.permissionContext, paymentExecution(requirements)),
})

const requirementChecks = (payment: PaymentPayload, requirements: PaymentRequirements, add: Adder) => {
  add(
    'scheme/network/method',
    requirements.scheme === 'exact' &&
      requirements.network === ARC_NETWORK &&
      requirements.extra.assetTransferMethod === 'erc7710',
  )
  add('asset is Arc USDC', isAddressEqual(requirements.asset, USDC))
  add(
    'accepted == requirements (asset, payTo, amount, invoiceHash)',
    isAddressEqual(payment.accepted.asset, requirements.asset) &&
      isAddressEqual(payment.accepted.payTo, requirements.payTo) &&
      payment.accepted.amount === requirements.amount &&
      sameHex(payment.accepted.extra.invoiceHash, requirements.extra.invoiceHash),
  )
}

type Adder = (name: string, ok: boolean, detail?: string) => boolean

const chainChecks = (chain: readonly Delegation[], delegator: Address, relayer: Address, add: Adder) => {
  const leaf = chain[0]
  const root = chain.at(-1)
  if (leaf === undefined || root === undefined || chain.length < 2)
    return add('context is leaf → grant', false, `${chain.length} delegations`)
  add('root.delegator == payload.delegator', isAddressEqual(root.delegator, delegator))
  add('root authority is ROOT_AUTHORITY', sameHex(root.authority, ROOT_AUTHORITY))
  add(
    'chain links (authority = hash(parent), delegator = parent.delegate)',
    chain.slice(0, -1).every((delegation, index) => {
      const parent = chain[index + 1]
      return (
        parent !== undefined &&
        sameHex(delegation.authority, delegationHashOf(parent)) &&
        isAddressEqual(delegation.delegator, parent.delegate)
      )
    }),
  )
  add(
    'leaf delegate is ANY_BENEFICIARY or the relayer',
    [ANY_BENEFICIARY, relayer].some((a) => isAddressEqual(a, leaf.delegate)),
  )
  return true
}

const leafChecks = (
  leaf: Delegation,
  root: Delegation,
  requirements: PaymentRequirements,
  context: {
    readonly relayer: Address
    readonly now: bigint
    readonly add: Adder
  },
) => {
  const { add, now } = context
  const execution = caveatTerms(leaf, arcAddresses.exactExecution)
  add('leaf ExactExecution == USDC.transfer(payTo, amount)', sameHex(execution, paymentExecution(requirements)))
  add('leaf Id == invoiceHash', sameHex(caveatTerms(leaf, arcAddresses.id), requirements.extra.invoiceHash))
  const window = timestampBounds(caveatTerms(leaf, arcAddresses.timestamp))
  add(
    'leaf Timestamp bounds hold now',
    window !== undefined && window.after <= now && now < window.before,
    window === undefined ? 'missing' : `after=${window.after} before=${window.before} now=${now}`,
  )
  const grantWindow = timestampBounds(caveatTerms(root, arcAddresses.timestamp))
  add('grant not expired', grantWindow === undefined || now < grantWindow.before)
  add(
    'leaf Redeemer includes the relayer',
    redeemers(caveatTerms(leaf, arcAddresses.redeemer)).some((address) => sameHex(address, context.relayer)),
  )
}

type Context = { readonly client: ArcClient; readonly relayer: Address }
type Call = { readonly to: Address; readonly data: Hex }

const settleSimulation = (promise: Promise<bigint | undefined>) =>
  Effect.promise(() =>
    promise
      .then((gas): Simulation => (gas === undefined ? { ok: true } : { ok: true, gas }))
      .catch((error: unknown): Simulation => ({ ok: false, revert: revertReason(error) })),
  )

/** Replays `prelude` then `tx` in one eth_call with Multicall3's code at the relayer, so msg.sender stays the relayer. */
const simulateHistory = ({ client, relayer }: Context, tx: Call, hooks: SimulationHooks) =>
  Effect.promise(async (): Promise<Simulation> => {
    const calls = [...(hooks.prelude ?? []), tx].map((call) => ({
      target: call.to,
      allowFailure: true,
      callData: call.data,
    }))
    const overrides = (hooks.stateOverride ?? []).filter((entry) => !isAddressEqual(entry.address, relayer))
    try {
      const code = hooks.multicallCode ?? (await client.getCode({ address: MULTICALL3 }))
      const result = await client.call({
        to: relayer,
        data: encodeFunctionData({ abi: multicallAbi, functionName: 'aggregate3', args: [calls] }),
        gas: 10_000_000n,
        stateOverride: [...overrides, { address: relayer, code }],
        ...(hooks.blockTime === undefined ? {} : { blockOverrides: { time: hooks.blockTime } }),
      })
      const results = decodeFunctionResult({ abi: multicallAbi, functionName: 'aggregate3', data: result.data ?? '0x' })
      const failed = results.slice(0, -1).findIndex((entry) => !entry.success)
      if (failed >= 0)
        return { ok: false, revert: `prelude call ${failed} failed: ${reasonOf(results[failed]?.returnData ?? '0x')}` }
      const last = results.at(-1)
      return last?.success === true ? { ok: true } : { ok: false, revert: reasonOf(last?.returnData ?? '0x') }
    } catch (error) {
      return { ok: false, revert: revertReason(error) }
    }
  })

/** Always from the relayer: eth_estimateGas in production; eth_call with overrides or Multicall3 history in tests. */
export const simulateFromRelayer = (
  context: Context,
  tx: Call,
  hooks: SimulationHooks = {},
): Effect.Effect<Simulation> => {
  const { client, relayer } = context
  if (hooks.prelude !== undefined && hooks.prelude.length > 0) return simulateHistory(context, tx, hooks)
  if (hooks.blockTime !== undefined)
    return settleSimulation(
      client
        .call({
          account: relayer,
          ...tx,
          stateOverride: hooks.stateOverride,
          blockOverrides: { time: hooks.blockTime },
          gas: 2_000_000n,
        })
        .then(() => undefined),
    )
  return settleSimulation(client.estimateGas({ account: relayer, ...tx, stateOverride: hooks.stateOverride }))
}

const managerAllowed = (payment: PaymentPayload, requirements: PaymentRequirements) =>
  isAddressEqual(payment.payload.delegationManager, arcAddresses.delegationManager) &&
  isAddressEqual(requirements.extra.delegationManager, arcAddresses.delegationManager)

const verdict = (checks: readonly Check[], simulation: Simulation, payer: Address): VerifyResult => {
  const failed = checks.find((check) => !check.ok)
  if (failed !== undefined) return { isValid: false, invalidReason: failed.name, payer, checks, simulation }
  if (!simulation.ok)
    return { isValid: false, invalidReason: simulation.revert ?? 'simulation failed', payer, checks, simulation }
  return { isValid: true, payer, checks, simulation }
}

/** The facilitator `verify` (§7): every structural check, then the simulation (both always run, all checks reported). */
export const verifyPayment = Effect.fn('EthMumbai.Chain.Facilitator.verify')(function* (
  context: Context,
  payment: PaymentPayload,
  requirements: PaymentRequirements,
  hooks: SimulationHooks = {},
) {
  const checks: Check[] = []
  const add: Adder = (name, ok, detail) => {
    checks.push(detail === undefined ? { name, ok } : { name, ok, detail })
    return ok
  }
  const { delegationManager, permissionContext, delegator } = payment.payload
  requirementChecks(payment, requirements, add)
  if (!add('delegationManager allowlisted', managerAllowed(payment, requirements), delegationManager))
    return verdict(checks, { ok: false, revert: 'not simulated' }, delegator)
  const now = hooks.blockTime ?? BigInt(Math.floor((yield* Clock.currentTimeMillis) / 1000))
  const chain = yield* Effect.try(() => decodePermissionContext(permissionContext)).pipe(
    Effect.orElseSucceed((): readonly Delegation[] => []),
  )
  const leaf = chain[0]
  const root = chain.at(-1)
  if (chainChecks(chain, delegator, context.relayer, add) && leaf !== undefined && root !== undefined) {
    leafChecks(leaf, root, requirements, { relayer: context.relayer, now, add })
    add(
      'leaf signature recovers to the chip (leaf.delegator)',
      yield* isSignedBy(leaf, leaf.delegator, delegationManager),
    )
  }
  const simulation = yield* simulateFromRelayer(context, settlementCall(payment, requirements), hooks)
  return verdict(checks, simulation, delegator)
})

/** verify, then broadcast through the relayer under the persistent guard `settle:<invoiceHash>`. */
export const settlePayment = Effect.fn('EthMumbai.Chain.Facilitator.settle')(function* (
  client: ArcClient,
  relayer: Relayer,
  payment: PaymentPayload,
  requirements: PaymentRequirements,
) {
  const verified = yield* verifyPayment({ client, relayer: relayer.address }, payment, requirements)
  if (!verified.isValid)
    return yield* new SettlementRejected({ reason: verified.invalidReason ?? 'invalid', checks: verified.checks })
  const sent = yield* relayer
    .send({
      key: `settle:${requirements.extra.invoiceHash.toLowerCase()}`,
      kind: 'settle',
      ...settlementCall(payment, requirements),
    })
    .pipe(
      Effect.catchTag('RelayerError', (error: RelayerError) =>
        Effect.fail(new SettlementRejected({ reason: `${error.stage}: ${error.message}`, checks: verified.checks })),
      ),
    )
  if (!sent.success)
    return yield* new SettlementRejected({ reason: `reverted on chain (${sent.txHash})`, checks: verified.checks })
  const outcome: SettleOutcome = { transaction: sent.txHash, payer: payment.payload.delegator, gasUsed: sent.gasUsed }
  return outcome
})
