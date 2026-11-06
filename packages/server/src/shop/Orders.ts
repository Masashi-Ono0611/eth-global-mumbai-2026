import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { type ArcClient, rpc } from '@ethmumbai/chain/Arc'
import { generateId } from '@ethmumbai/protocol/Base32'
import { Clock, Effect, Option, Schema } from 'effect'
import { parseAbiItem } from 'viem'
import { randomBytes } from '../Respond.ts'
import { allRows, changes, firstRow } from '../Sql.ts'
import {
  KITS,
  type Kit,
  matchTransfers,
  ORDER_TTL_SECONDS,
  type OrderBody,
  priceOf,
  SHOP_PAY_TO,
  SUFFIX_MAX,
  unitsOfNative,
  USDC_SYSTEM_EMITTER,
  withSuffix,
} from './Shop.ts'

export const OrderRow = Schema.Struct({
  id: Schema.String,
  kit: Schema.Literals(['full', 'dev']),
  pay: Schema.Literals(['full', 'reserve']),
  founding: Schema.Literals([0, 1]),
  amount: Schema.String,
  status: Schema.Literals(['pending', 'paid', 'expired']),
  paid_tx: Schema.NullOr(Schema.String),
  expires_at: Schema.Finite,
  created_at: Schema.Finite,
})
export type OrderRow = typeof OrderRow.Type

const ORDER_COLUMNS = 'id, kit, pay, founding, amount, status, paid_tx, expires_at, created_at'

/** Founding spots a kit has taken: paid orders, and open ones whose amount has not expired. */
const takenSpots = (database: QueryDatabaseClient, kit: Kit, now: number) =>
  firstRow(
    database
      .prepare(
        `SELECT COUNT(*) AS taken FROM shop_orders WHERE kit = ? AND founding = 1
          AND (status = 'paid' OR (status = 'pending' AND expires_at > ?))`,
      )
      .bind(kit, now),
    Schema.Struct({ taken: Schema.Finite }),
  ).pipe(Effect.map((row) => Option.match(row, { onNone: () => 0, onSome: ({ taken }) => taken })))

/** Founding spots left per kit (never below zero). */
export const stock = Effect.fn('EthMumbai.Shop.stock')(function* (database: QueryDatabaseClient) {
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
  const left = (kit: Kit) => Effect.map(takenSpots(database, kit, now), (taken) => Math.max(0, KITS[kit].cap - taken))
  return {
    full: { cap: KITS.full.cap, left: yield* left('full') },
    dev: { cap: KITS.dev.cap, left: yield* left('dev') },
  }
})

/** A suffix whose amount no unpaid order uses, so a transfer names one order; none after a few unlucky draws. */
const freeAmount = (database: QueryDatabaseClient, base: bigint) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const [high = 0, low = 0] = yield* randomBytes(2)
      const suffix = 1 + ((high * 256 + low) % SUFFIX_MAX)
      const amount = withSuffix(base, suffix).toString()
      const clash = yield* firstRow(
        database.prepare(`SELECT id FROM shop_orders WHERE amount = ? AND status != 'paid'`).bind(amount),
        Schema.Struct({ id: Schema.String }),
      )
      if (Option.isNone(clash)) return Option.some(amount)
    }
    return Option.none<string>()
  })

/** Stores a pending order at the founding price while the kit has spots left, else the standard price. */
export const createOrder = Effect.fn('EthMumbai.Shop.createOrder')(function* (
  database: QueryDatabaseClient,
  body: OrderBody,
) {
  const createdAt = yield* Clock.currentTimeMillis
  const now = Math.floor(createdAt / 1000)
  const founding = (yield* takenSpots(database, body.kit, now)) < KITS[body.kit].cap
  const amount = yield* freeAmount(database, priceOf(body.kit, body.pay, founding))
  if (Option.isNone(amount)) return Option.none<OrderRow>()
  const id = yield* generateId
  const row: OrderRow = {
    id,
    kit: body.kit,
    pay: body.pay,
    founding: founding ? 1 : 0,
    amount: amount.value,
    status: 'pending',
    paid_tx: null,
    expires_at: now + ORDER_TTL_SECONDS,
    created_at: createdAt,
  }
  yield* database
    .prepare(
      `INSERT INTO shop_orders (id, kit, pay, founding, amount, email, name, address, country, status, expires_at,
        created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      id,
      row.kit,
      row.pay,
      row.founding,
      row.amount,
      body.email,
      body.name,
      body.address,
      body.country,
      row.expires_at,
      createdAt,
    )
    .run()
  return Option.some(row)
})

/** An order as the buyer may see it (no shipping details), with an open amount past its time shown as expired. */
export const readOrder = Effect.fn('EthMumbai.Shop.readOrder')(function* (database: QueryDatabaseClient, id: string) {
  const row = yield* firstRow(
    database.prepare(`SELECT ${ORDER_COLUMNS} FROM shop_orders WHERE id = ?`).bind(id),
    OrderRow,
  )
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
  return Option.map(row, (order) =>
    order.status === 'pending' && order.expires_at <= now ? { ...order, status: 'expired' as const } : order,
  )
})

const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

/** Blocks read per `eth_getLogs`, and at most this many reads per scan, so one poll stays short. */
const CHUNK = 5000n
const MAX_CHUNKS = 10

type TransferLog = {
  readonly transactionHash: string | null
  readonly logIndex: number | null
  readonly blockNumber: bigint | null
  readonly args: { readonly from?: string | undefined; readonly value?: bigint | undefined }
}

/** One transfer to the shop, kept once by `txHash:logIndex`; a value that is no whole USDC unit is not a shop payment. */
const recordTransfer = (database: QueryDatabaseClient, log: TransferLog, seenAt: number) => {
  const units = log.args.value === undefined ? undefined : unitsOfNative(log.args.value)
  if (units === undefined || log.transactionHash === null || log.blockNumber === null) return Effect.void
  return database
    .prepare(
      `INSERT OR IGNORE INTO shop_payments (id, tx_hash, from_address, amount, block, seen_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `${log.transactionHash}:${log.logIndex}`,
      log.transactionHash,
      log.args.from ?? '',
      units.toString(),
      Number(log.blockNumber),
      seenAt,
    )
    .run()
}

/**
 * Reads Arc's USDC transfers to the shop since the last block read and records each once (`txHash:logIndex`). The
 * first scan starts a little before the newest block: orders are newer than the shop. Arc failing is logged and the
 * scan simply ends; the cursor only moves past blocks that were read.
 */
const readTransfers = (database: QueryDatabaseClient, arc: ArcClient) =>
  Effect.gen(function* () {
    const latest = yield* rpc('blockNumber', () => arc.getBlockNumber())
    const cursor = yield* firstRow(
      database.prepare(`SELECT block FROM shop_cursor WHERE id = 'arc'`),
      Schema.Struct({ block: Schema.Finite }),
    )
    let from = Option.match(cursor, { onNone: () => latest - CHUNK, onSome: ({ block }) => BigInt(block) + 1n })
    for (let chunk = 0; chunk < MAX_CHUNKS && from <= latest; chunk += 1) {
      const end = from + CHUNK - 1n
      const to = end < latest ? end : latest
      const logs = yield* rpc('getLogs', () =>
        arc.getLogs({
          address: USDC_SYSTEM_EMITTER,
          event: transferEvent,
          args: { to: SHOP_PAY_TO },
          fromBlock: from,
          toBlock: to,
        }),
      )
      const seenAt = yield* Clock.currentTimeMillis
      yield* Effect.forEach(logs, (log) => recordTransfer(database, log, seenAt), { discard: true })
      yield* database
        .prepare(
          `INSERT INTO shop_cursor (id, block) VALUES ('arc', ?) ON CONFLICT (id) DO UPDATE SET block = excluded.block`,
        )
        .bind(Number(to))
        .run()
      from = to + 1n
    }
  })

const Unmatched = Schema.Struct({ id: Schema.String, tx_hash: Schema.String, amount: Schema.String })
const Open = Schema.Struct({ id: Schema.String, amount: Schema.String })

/** Marks the order each unmatched transfer pays; a second scan of the same transfer changes nothing. */
export const settleTransfers = Effect.fn('EthMumbai.Shop.settleTransfers')(function* (database: QueryDatabaseClient) {
  const transfers = yield* allRows(
    database.prepare(`SELECT id, tx_hash, amount FROM shop_payments WHERE order_id IS NULL ORDER BY block, id`),
    Unmatched,
  )
  if (transfers.length === 0) return 0
  const orders = yield* allRows(
    database.prepare(`SELECT id, amount FROM shop_orders WHERE status != 'paid' ORDER BY created_at`),
    Open,
  )
  const paidAt = Math.floor((yield* Clock.currentTimeMillis) / 1000)
  let settled = 0
  for (const pair of matchTransfers(orders, transfers)) {
    const transfer = transfers.find((candidate) => candidate.id === pair.transferId)
    if (transfer === undefined) continue
    const won = yield* changes(
      database
        .prepare(`UPDATE shop_orders SET status = 'paid', paid_tx = ?, paid_at = ? WHERE id = ? AND status != 'paid'`)
        .bind(transfer.tx_hash, paidAt, pair.orderId),
    )
    if (won === 0) continue
    yield* database.prepare(`UPDATE shop_payments SET order_id = ? WHERE id = ?`).bind(pair.orderId, transfer.id).run()
    settled += 1
  }
  return settled
})

/** One look at Arc for shop payments; a failure is a warning and the orders keep their state. */
export const scanPayments = Effect.fn('EthMumbai.Shop.scanPayments')(function* (
  database: QueryDatabaseClient,
  arc: Option.Option<ArcClient>,
) {
  if (Option.isSome(arc)) {
    yield* readTransfers(database, arc.value).pipe(
      Effect.catchTag('ArcRpcError', ({ operation, message }) =>
        Effect.logWarning('shop scan: Arc did not answer', { operation, message }),
      ),
    )
  }
  return yield* settleTransfers(database)
})
