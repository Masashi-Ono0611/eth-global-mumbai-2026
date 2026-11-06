import { Effect, Exit } from 'effect'
import { createPublicClient, custom, type Hex, keccak256, parseTransaction, toHex } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { expect, test } from 'vitest'
import { arcChain, makeMemoryRelayerStore, makeRelayer, type RelayerStore } from '../src/index.ts'

// The relayer against a fake Arc node: what it signs and sends, the per-key guard, and nonce serialisation.
const fakeArc = (options: { pendingNonce: number; status?: '0x1' | '0x0' }) => {
  const sent: Hex[] = []
  const methods: string[] = []
  const receipt = (hash: string) => ({
    blockHash: keccak256(toHex('block')),
    blockNumber: '0x10',
    contractAddress: null,
    cumulativeGasUsed: '0x5208',
    effectiveGasPrice: '0x4a817c800',
    from: '0x0000000000000000000000000000000000000001',
    gasUsed: '0x7a120',
    logs: [],
    logsBloom: `0x${'0'.repeat(512)}`,
    status: options.status ?? '0x1',
    to: '0x0000000000000000000000000000000000000002',
    transactionHash: hash,
    transactionIndex: '0x0',
    type: '0x2',
  })
  const client = createPublicClient({
    chain: arcChain,
    transport: custom({
      request: async ({ method, params }: { method: string; params?: unknown }) => {
        methods.push(method)
        if (method === 'eth_chainId') return toHex(5042)
        if (method === 'eth_getTransactionCount') return toHex(options.pendingNonce)
        if (method === 'eth_estimateGas') return toHex(500_000)
        if (method === 'eth_blockNumber') return '0x10'
        if (method === 'eth_sendRawTransaction' && Array.isArray(params) && typeof params[0] === 'string') {
          sent.push(`0x${params[0].slice(2)}`)
          return keccak256(`0x${params[0].slice(2)}`)
        }
        if (method === 'eth_getTransactionReceipt' && Array.isArray(params)) return receipt(String(params[0]))
        throw new Error(`fake arc: ${method}`)
      },
    }),
    pollingInterval: 10,
  })
  return { client, sent, methods }
}

const tx = {
  key: 'settle:0xabc',
  kind: 'settle' as const,
  to: '0x0000000000000000000000000000000000000002',
  data: '0x1234',
} as const

test('sends once per key: a second send of the same key is AlreadySubmitted before anything is signed', async () => {
  const arc = fakeArc({ pendingNonce: 7 })
  const relayer = makeRelayer({ client: arc.client, privateKey: generatePrivateKey(), store: makeMemoryRelayerStore() })
  const first = await Effect.runPromise(relayer.send(tx))
  expect(first.success).toBe(true)
  expect(first.gasUsed).toBe(500_000n)
  expect(first.txHash).toBe(keccak256(arc.sent[0] ?? '0x'))
  // Arc drops transactions under 20 gwei: 40 gwei max, 1 gwei priority, estimate × 1.2, the node's pending nonce.
  expect(parseTransaction(arc.sent[0] ?? '0x')).toMatchObject({
    chainId: 5042,
    type: 'eip1559',
    nonce: 7,
    gas: 600_000n,
    maxFeePerGas: 40_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    to: tx.to,
    data: tx.data,
  })
  const second = await Effect.runPromiseExit(relayer.send(tx))
  expect(Exit.isFailure(second)).toBe(true)
  expect(String(second)).toContain('AlreadySubmitted')
  expect(arc.sent).toHaveLength(1)
})

test('a taken nonce moves to the next one (serialised nonce over relayer_txs)', async () => {
  const arc = fakeArc({ pendingNonce: 3 })
  const store = makeMemoryRelayerStore()
  const relayer = makeRelayer({ client: arc.client, privateKey: generatePrivateKey(), store })
  // Another in-flight transaction already holds nonce 3 in the store (the node has not seen it yet).
  await Effect.runPromise(store.claim({ key: 'deploy:0x1', kind: 'deploy', to: tx.to, dataSha256: '0x00' }))
  expect(await Effect.runPromise(store.reserveNonce('deploy:0x1', 3))).toBe(true)
  const result = await Effect.runPromise(relayer.send(tx))
  expect(result.success).toBe(true)
  expect(await Effect.runPromise(store.reserveNonce('other', 4))).toBe(false)
})

test('a reverted receipt is reported, and the key stays claimed (no blind resend)', async () => {
  const arc = fakeArc({ pendingNonce: 0, status: '0x0' })
  const store: RelayerStore = makeMemoryRelayerStore()
  const relayer = makeRelayer({ client: arc.client, privateKey: generatePrivateKey(), store })
  const result = await Effect.runPromise(relayer.send(tx))
  expect(result.success).toBe(false)
  const again = await Effect.runPromise(store.claim({ key: tx.key, kind: 'settle', to: tx.to, dataSha256: '0x00' }))
  expect(again.claimed).toBe(false)
})
