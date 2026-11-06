import { createPublicClient, custom, toHex } from 'viem'
import { arcChain } from '../src/index.ts'

/** A client that answers only what the kit asks offline (chain id; "no code" for counterfactual accounts). */
export const offlineClient = createPublicClient({
  chain: arcChain,
  transport: custom({
    request: async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return toHex(5042)
      if (method === 'eth_getCode') return '0x'
      throw new Error(`offline test client: ${method}`)
    },
  }),
})
