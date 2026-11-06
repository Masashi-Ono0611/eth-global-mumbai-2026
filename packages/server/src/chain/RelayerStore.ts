import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { RelayerStore, RelayerTxRecord } from '@ethmumbai/chain/Relayer'
import { Bytes32 } from '@ethmumbai/protocol/Hex'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { Clock, Effect, Option, Schema } from 'effect'
import { nowSeconds } from '../Respond.ts'
import { changes, firstRow } from '../Sql.ts'

const RelayerTxRow = Schema.Struct({
  key: Schema.String,
  status: Schema.Literals(['pending', 'sent', 'confirmed', 'failed']),
  tx_hash: Schema.NullOr(Bytes32),
  error: Schema.NullOr(Schema.String),
})

/**
 * `relayer_txs` in D1: the persistent per-key guard and the relayer's nonce sequence (spec §3). Single statements are
 * atomic in D1, so a claim and a nonce reservation each decide their race in one write.
 */
export const makeD1RelayerStore = Effect.fn('EthMumbai.Chain.relayerStore')(function* (database: QueryDatabaseClient) {
  const runtime = yield* Effect.context<RuntimeContext>()
  const run = <A>(effect: Effect.Effect<A, never, RuntimeContext>) => effect.pipe(Effect.provideContext(runtime))
  const store: RelayerStore = {
    claim: (tx) =>
      run(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const claimed = yield* changes(
            database
              .prepare(
                `INSERT INTO relayer_txs (key, kind, to_address, data_sha256, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'pending', ?, ?)
                 ON CONFLICT(key) DO UPDATE SET status = 'pending', error = NULL, nonce = NULL,
                   to_address = excluded.to_address, data_sha256 = excluded.data_sha256, updated_at = excluded.updated_at
                 WHERE relayer_txs.status = 'failed' AND relayer_txs.tx_hash IS NULL`,
              )
              .bind(tx.key, tx.kind, tx.to, tx.dataSha256, now, Math.floor(now / 1000)),
          )
          if (claimed > 0) return { claimed: true as const }
          const row = yield* firstRow(
            database.prepare('SELECT * FROM relayer_txs WHERE key = ?').bind(tx.key),
            RelayerTxRow,
          )
          const existing: RelayerTxRecord = Option.match(row, {
            onNone: () => ({ key: tx.key, status: 'pending', txHash: null, error: null }),
            onSome: (found) => ({ key: found.key, status: found.status, txHash: found.tx_hash, error: found.error }),
          })
          return { claimed: false as const, existing }
        }),
      ),
    reserveNonce: (key, nonce) =>
      run(
        changes(
          database
            .prepare(
              `UPDATE relayer_txs SET nonce = ? WHERE key = ?
               AND NOT EXISTS (SELECT 1 FROM relayer_txs WHERE nonce = ? AND key <> ?)`,
            )
            .bind(nonce, key, nonce, key),
        ).pipe(Effect.map((updated) => updated > 0)),
      ),
    markSent: (key, txHash) => update(run, database, key, "status = 'sent', tx_hash = ?", [txHash]),
    markConfirmed: (key, gasUsed) =>
      update(run, database, key, "status = 'confirmed', gas_used = ?", [gasUsed.toString()]),
    markFailed: (key, error, releaseNonce) =>
      update(run, database, key, `status = 'failed', error = ?${releaseNonce ? ', nonce = NULL' : ''}`, [
        error.slice(0, 500),
      ]),
  }
  return store
})

const update = (
  run: <A>(effect: Effect.Effect<A, never, RuntimeContext>) => Effect.Effect<A>,
  database: QueryDatabaseClient,
  key: string,
  assignments: string,
  values: readonly unknown[],
) =>
  run(
    Effect.flatMap(nowSeconds, (now) =>
      database
        .prepare(`UPDATE relayer_txs SET ${assignments}, updated_at = ? WHERE key = ?`)
        .bind(...values, now, key)
        .run(),
    ),
  ).pipe(Effect.asVoid)
