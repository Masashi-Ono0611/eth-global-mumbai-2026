import { expect } from 'bun:test'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

type Urls = { readonly url: string }

const StoreResult = Schema.Struct({
  sentHash: Schema.String,
  reclaimA: Schema.Struct({ existing: Schema.Struct({ txHash: Schema.String }) }),
})
const Rows = Schema.Struct({
  payment: Schema.Struct({ tx_hash: Schema.String, fail_reason: Schema.NullOr(Schema.String) }),
  invoice: Schema.Struct({ paid_tx: Schema.NullOr(Schema.String) }),
  relayerTx: Schema.Struct({ tx_hash: Schema.String }),
})
const SettlementResult = Schema.Struct({
  first: Schema.Struct({ value: Schema.Struct({ transaction: Schema.String }) }),
  again: Schema.Struct({ error: Schema.String }),
  unknown: Schema.Struct({ error: Schema.String }),
  afterPaid: Rows,
  afterLost: Rows,
})

const run = (url: string, path: string) =>
  HttpClient.execute(HttpClientRequest.post(`${url}${path}`)).pipe(
    Effect.flatMap((response) => {
      expect(response.status).toBe(200)
      return response.json
    }),
  )

/**
 * M2 (native, real D1, no Arc): the relayer's `relayer_txs` guard and nonce sequence, and the Settlement seam's
 * `payments`/`invoices` rows, including the unknown outcome after a broadcast whose receipt never arrives.
 */
export const registerChainAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>) => {
  test(
    'relayer_txs: one claim per key, failed-unsent re-claim, broadcast keys stay claimed, unique nonces',
    Effect.gen(function* () {
      const { url } = yield* stack
      const result = yield* run(url, '/test/chain/relayer-store')
      expect(result).toMatchObject({
        firstClaim: { claimed: true },
        secondClaim: { claimed: false, existing: { status: 'pending', txHash: null } },
        reservedA: true,
        takenByB: false,
        nextForB: true,
        reclaimB: { claimed: true },
        releasedForC: true,
        reclaimA: { claimed: false, existing: { status: 'failed', error: 'reverted on chain' } },
      })
      const { sentHash, reclaimA } = yield* Schema.decodeUnknownEffect(StoreResult)(result)
      expect(reclaimA.existing.txHash).toBe(sentHash)
    }),
    { timeout: 60000 },
  )

  test(
    'settlement: settled once (payments.settled, invoices.paid), AlreadySettled after, unknown outcome stays settling',
    Effect.gen(function* () {
      const { url } = yield* stack
      const result = yield* run(url, '/test/chain/settlement')
      expect(result).toMatchObject({
        first: { ok: true, value: { success: true, network: 'eip155:5042', status: 'paid' } },
        again: { ok: false },
        afterPaid: {
          payment: { status: 'settled', fail_reason: null },
          invoice: { status: 'paid' },
          relayerTx: { status: 'confirmed' },
        },
        unknown: { ok: false },
        afterLost: {
          payment: { status: 'settling' },
          invoice: { status: 'pending', paid_tx: null },
          relayerTx: { status: 'sent' },
        },
      })
      const typed = yield* Schema.decodeUnknownEffect(SettlementResult)(result)
      expect(typed.afterPaid.payment.tx_hash).toBe(typed.first.value.transaction)
      expect(typed.afterPaid.invoice.paid_tx).toBe(typed.first.value.transaction)
      expect(typed.afterPaid.relayerTx.tx_hash).toBe(typed.first.value.transaction)
      expect(typed.again.error).toContain('AlreadySettled')
      expect(typed.unknown.error).toContain('unknown outcome')
      expect(typed.afterLost.payment.tx_hash).toBe(typed.afterLost.relayerTx.tx_hash)
      expect(typed.afterLost.payment.fail_reason ?? '').toContain('unknown outcome')
    }),
    { timeout: 60000 },
  )
}
