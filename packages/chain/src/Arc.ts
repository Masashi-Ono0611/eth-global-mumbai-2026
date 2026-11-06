import { decodeRevertData } from '@metamask/smart-accounts-kit/utils'
import { Effect, Predicate, Schema } from 'effect'
import { BaseError, createPublicClient, defineChain, type Hex, http, type PublicClient, type Transport } from 'viem'
import { ARC_CHAIN_ID } from './Env.ts'

export const arcChain = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc explorer', url: 'https://explorer.arc.io' } },
})

/** Small retry budget only (spec §5): a Worker request must not sit in minute-long RPC backoff. */
export type ArcClient = PublicClient<Transport, typeof arcChain>

export const makeArcClient = (rpcUrl: string): ArcClient =>
  createPublicClient({
    chain: arcChain,
    transport: http(rpcUrl, { retryCount: 3, retryDelay: 500, timeout: 10_000 }),
    pollingInterval: 1_000,
  })

/** Arc drops transactions below 20 gwei silently: always 40 gwei max, 1 gwei priority, estimate × 1.2. */
export const GAS_POLICY = { maxFeePerGas: 40_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n } as const
export const withHeadroom = (estimate: bigint) => (estimate * 12n) / 10n

export class ArcRpcError extends Schema.TaggedError<ArcRpcError>()('ArcRpcError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

/** A decoded revert (`IdEnforcer:id-already-used`, `CannotUseADisabledDelegation`, …) or raw data when unknown. */
export const reasonOf = (data: Hex): string => {
  if (data === '0x') return 'empty revert data'
  try {
    const decoded = decodeRevertData(data)
    if (decoded === undefined) return data.slice(0, 74)
    if (decoded.errorName === 'Error') return decoded.message ?? 'Error'
    return decoded.message === undefined ? decoded.errorName : `${decoded.errorName} ${decoded.message}`
  } catch {
    return data.slice(0, 74)
  }
}

const revertData = (error: unknown): Hex | undefined => {
  let data: Hex | undefined
  if (error instanceof BaseError)
    error.walk((cause) => {
      if (Predicate.hasProperty(cause, 'data') && typeof cause.data === 'string' && cause.data.startsWith('0x'))
        data = `0x${cause.data.slice(2)}`
      return false
    })
  return data
}

/** The revert reason inside a viem error, else its first message line. */
export const revertReason = (error: unknown): string => {
  const data = revertData(error)
  if (data !== undefined && data !== '0x') return reasonOf(data)
  const message = error instanceof BaseError ? error.shortMessage : String(error)
  return message.split('\n')[0] ?? message
}

/** Lift one RPC promise into Effect with a typed failure carrying the decoded reason (never the request body). */
export const rpc = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (error) => new ArcRpcError({ operation, message: revertReason(error) }) })
