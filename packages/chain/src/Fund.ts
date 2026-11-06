import { Effect } from 'effect'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { type ArcClient, GAS_POLICY, rpc } from './Arc.ts'
import { ARC_CHAIN_ID } from './Env.ts'

/** USDC base units (6 dp) as Arc's native value (18 dp). */
export const nativeValueOf = (units: bigint) => units * 1_000_000_000_000n

/**
 * A plain USDC transfer from a key (scripts only: funding a demo owner from the relayer before a run). Outside the
 * keyed relayer store on purpose, so run it only while nothing else sends from that key.
 */
export const sendUsdc = Effect.fn('EthMumbai.Chain.sendUsdc')(function* (input: {
  readonly client: ArcClient
  readonly privateKey: Hex
  readonly to: Address
  readonly units: bigint
}) {
  const account = privateKeyToAccount(input.privateKey)
  const { client } = input
  const nonce = yield* rpc('getTransactionCount', () =>
    client.getTransactionCount({ address: account.address, blockTag: 'pending' }),
  )
  const serialized = yield* Effect.promise(() =>
    account.signTransaction({
      chainId: ARC_CHAIN_ID,
      type: 'eip1559',
      nonce,
      to: input.to,
      value: nativeValueOf(input.units),
      gas: 21_000n,
      ...GAS_POLICY,
    }),
  )
  const hash = yield* rpc('sendRawTransaction', () => client.sendRawTransaction({ serializedTransaction: serialized }))
  const receipt = yield* rpc('waitForTransactionReceipt', () =>
    client.waitForTransactionReceipt({ hash, timeout: 60_000 }),
  )
  return { hash, success: receipt.status === 'success' }
})
