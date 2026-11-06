import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { arcChain } from '@ethmumbai/chain/Arc'
import { arcAddresses } from '@ethmumbai/chain/Env'
import { buildGrant } from '@ethmumbai/chain/Grant'
import { encodePermissionContext } from '@ethmumbai/chain/Hashes'
import { signLeaf } from '@ethmumbai/chain/Leaf'
import { makeRelayer } from '@ethmumbai/chain/Relayer'
import { generateId } from '@ethmumbai/protocol/Base32'
import { buildLeaf, delegationHash } from '@ethmumbai/protocol/Delegation'
import { ARC_USDC, type Invoice, invoiceHash, jsonHash } from '@ethmumbai/protocol/Invoice'
import type { PaymentPayload } from '@ethmumbai/protocol/X402'
import { Cause, Clock, Effect, Exit, Random } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { createPublicClient, custom, keccak256, toHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { makeD1RelayerStore } from '../src/chain/RelayerStore.ts'
import { makeSettlement } from '../src/chain/Settlement.ts'
import { requirementsFor } from '../src/merchant/X402.ts'

// Test-only routes (RuntimeWorker mounts them under `/test/chain/`): the relayer's D1 store and the Settlement seam
// against the real D1 of the native stack, with an in-process Arc stand-in, so nothing reaches Arc.

const receiptFor = (transactionHash: string) => ({
  blockHash: keccak256(toHex('block')),
  blockNumber: '0x10',
  contractAddress: null,
  cumulativeGasUsed: '0x6d6d8',
  effectiveGasPrice: '0x4e3b29200',
  from: '0x0000000000000000000000000000000000000001',
  gasUsed: '0x6d6d8',
  logs: [],
  logsBloom: `0x${'0'.repeat(512)}`,
  status: '0x1',
  to: arcAddresses.delegationManager,
  transactionHash,
  transactionIndex: '0x0',
  type: '0x2',
})

/** An Arc node that accepts every simulation; `receipts: false` never returns a receipt (an unknown outcome). */
const stubArc = (options: { readonly pendingNonce: number; readonly receipts: boolean }) => {
  const fixed: Readonly<Record<string, string>> = {
    eth_chainId: toHex(5042),
    eth_blockNumber: '0x10',
    eth_getTransactionCount: toHex(options.pendingNonce),
    eth_estimateGas: toHex(505_000),
  }
  const request = async ({ method, params }: { method: string; params?: unknown }) => {
    const first: unknown = Array.isArray(params) ? params[0] : undefined
    const answer = fixed[method]
    if (answer !== undefined) return answer
    if (typeof first !== 'string') throw new Error(`stub arc: ${method}`)
    if (method === 'eth_sendRawTransaction') return keccak256(`0x${first.slice(2)}`)
    if (method === 'eth_getTransactionReceipt') return options.receipts ? receiptFor(first) : null
    throw new Error(`stub arc: ${method}`)
  }
  return createPublicClient({ chain: arcChain, pollingInterval: 50, transport: custom({ request }) })
}

const nonceBase = Random.nextIntBetween(1_000_000, 1_000_000_000)
const ORIGIN = 'https://native.invalid'

const tx = (key: string) => ({
  key,
  kind: 'settle' as const,
  to: arcAddresses.delegationManager,
  dataSha256: keccak256('0x01'),
})

/** claim once per key, failed-unsent re-claim, failed-after-broadcast stays claimed, unique nonce reservation. */
const relayerStoreRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/test/chain/relayer-store',
    Effect.gen(function* () {
      const store = yield* makeD1RelayerStore(database)
      const run = yield* generateId
      const [a, b, c] = [`settle:${run}:a`, `settle:${run}:b`, `settle:${run}:c`]
      const nonce = yield* nonceBase
      const firstClaim = yield* store.claim(tx(a))
      const secondClaim = yield* store.claim(tx(a))
      yield* store.claim(tx(b))
      const reservedA = yield* store.reserveNonce(a, nonce)
      const takenByB = yield* store.reserveNonce(b, nonce)
      const nextForB = yield* store.reserveNonce(b, nonce + 1)
      yield* store.markFailed(b, 'estimate failed', true)
      const reclaimB = yield* store.claim(tx(b))
      yield* store.claim(tx(c))
      const releasedForC = yield* store.reserveNonce(c, nonce + 1)
      const sentHash = keccak256(toHex(run))
      yield* store.markSent(a, sentHash)
      yield* store.markFailed(a, 'reverted on chain', false)
      const reclaimA = yield* store.claim(tx(a))
      return yield* HttpServerResponse.json({
        firstClaim,
        secondClaim,
        reservedA,
        takenByB,
        nextForB,
        reclaimB,
        releasedForC,
        reclaimA,
        sentHash,
      })
    }).pipe(Effect.orDie),
  )

const paymentFixture = Effect.fn('Test.chainFixture.payment')(function* (relayer: `0x${string}`) {
  const owner = privateKeyToAccount(generatePrivateKey())
  const chip = privateKeyToAccount(generatePrivateKey())
  const payTo = privateKeyToAccount(generatePrivateKey()).address
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
  const grant = yield* signLeaf(
    owner,
    buildGrant({
      grantId: yield* generateId,
      owner: owner.address,
      chip: chip.address,
      dailyCap: 100_000n,
      perPaymentCap: 10_000n,
      allowlist: [payTo],
      startAt: now - 60,
      expiresAt: now + 3_600,
    }),
  )
  const id = yield* generateId
  const fields = {
    merchantId: 'duck-cafe',
    id,
    payTo,
    asset: ARC_USDC,
    amount: '10000',
    expiresAt: now + 600,
    linesHash: jsonHash([]),
    rulesHash: jsonHash([]),
  }
  const invoice: Invoice = {
    ...fields,
    url: `${ORIGIN}/api/i/${id}`,
    invoiceHash: invoiceHash(fields),
    restricted: false,
  }
  const leaf = yield* signLeaf(
    chip,
    buildLeaf({
      chip: chip.address,
      grantHash: delegationHash(grant),
      relayer,
      invoiceHash: invoice.invoiceHash,
      payTo,
      amount: 10_000n,
      expiresAt: invoice.expiresAt,
    }),
  )
  const requirements = requirementsFor(invoice, relayer)
  const payment: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: {
      delegationManager: arcAddresses.delegationManager,
      permissionContext: encodePermissionContext([leaf, grant]),
      delegator: owner.address,
    },
  }
  return { invoice, requirements, payment }
})

const insertInvoice = (database: QueryDatabaseClient, invoice: Invoice) =>
  Effect.flatMap(Clock.currentTimeMillis, (createdAt) =>
    database
      .prepare(
        `INSERT INTO invoices (id, merchant_id, item_id, pay_to, asset, amount, expires_at, lines_hash, rules_hash,
        invoice_hash, restricted, status, created_at) VALUES (?, ?, 'chai', ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?)`,
      )
      .bind(
        invoice.id,
        invoice.merchantId,
        invoice.payTo,
        invoice.asset,
        invoice.amount,
        invoice.expiresAt,
        invoice.linesHash,
        invoice.rulesHash,
        invoice.invoiceHash,
        createdAt,
      )
      .run(),
  )

const rowsOf = (database: QueryDatabaseClient, invoice: Invoice) =>
  Effect.all({
    payment: database
      .prepare('SELECT status, tx_hash, fail_reason FROM payments WHERE invoice_hash = ?')
      .bind(invoice.invoiceHash.toLowerCase())
      .first(),
    invoice: database.prepare('SELECT status, paid_tx FROM invoices WHERE id = ?').bind(invoice.id).first(),
    relayerTx: database
      .prepare('SELECT status, tx_hash, nonce FROM relayer_txs WHERE key = ?')
      .bind(`settle:${invoice.invoiceHash.toLowerCase()}`)
      .first(),
  })

const outcome = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.match(exit, {
    onSuccess: (value) => ({ ok: true, value }),
    onFailure: (cause) => ({ ok: false, error: JSON.stringify(Cause.squash(cause)).slice(0, 500) }),
  })

/** settle once → settled + paid; the same invoice again → AlreadySettled; a broadcast without a receipt → settling. */
const settlementRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/test/chain/settlement',
    Effect.gen(function* () {
      const store = yield* makeD1RelayerStore(database)
      const privateKey = generatePrivateKey()
      const relayerAddress = privateKeyToAccount(privateKey).address
      const settle = (receipts: boolean) =>
        Effect.flatMap(nonceBase, (pendingNonce) =>
          makeSettlement({
            database,
            client: stubArc({ pendingNonce, receipts }),
            relayer: makeRelayer({
              client: stubArc({ pendingNonce, receipts }),
              privateKey,
              store,
              receiptTimeoutMs: 1_500,
            }),
          }),
        )
      const paid = yield* paymentFixture(relayerAddress)
      yield* insertInvoice(database, paid.invoice)
      const settlement = yield* settle(true)
      const first = outcome(yield* Effect.exit(settlement.settle(paid)))
      const again = outcome(yield* Effect.exit(settlement.settle(paid)))
      const afterPaid = yield* rowsOf(database, paid.invoice)
      const lost = yield* paymentFixture(relayerAddress)
      yield* insertInvoice(database, lost.invoice)
      const unknown = outcome(yield* Effect.exit((yield* settle(false)).settle(lost)))
      const afterLost = yield* rowsOf(database, lost.invoice)
      return yield* HttpServerResponse.json({ first, again, afterPaid, unknown, afterLost })
    }).pipe(Effect.orDie),
  )

export const chainFixtureRoutes = (database: QueryDatabaseClient) =>
  HttpRouter.addAll([relayerStoreRoute(database), settlementRoute(database)])
