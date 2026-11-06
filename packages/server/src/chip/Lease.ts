import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { LEASE_MS } from '@ethmumbai/protocol/Chip'
import { Address } from '@ethmumbai/protocol/Hex'
import { RobotKind } from '@ethmumbai/protocol/Intent'
import { Clock, Effect, Schema } from 'effect'
import { firstRow } from '../Sql.ts'

export const RobotStatus = Schema.Literals(['unpaired', 'paired', 'revoked'])

/** The `robots` row (§3). `lease_until` is in ms (the wire's `lease.until`); the other `*_at` are unix seconds. */
export const RobotRow = Schema.Struct({
  id: Schema.String,
  account_id: Schema.String,
  name: Schema.NullOr(Schema.String),
  pairing_code: Schema.NullOr(Schema.String),
  pairing_expires_at: Schema.NullOr(Schema.Finite),
  chip_address: Schema.NullOr(Address),
  chip_token_hash: Schema.NullOr(Schema.String),
  paired_at: Schema.NullOr(Schema.Finite),
  last_poll_at: Schema.NullOr(Schema.Finite),
  lease_until: Schema.NullOr(Schema.Finite),
  status: RobotStatus,
  /** `chip` = hardware or CLI chip; `sim` = a simulator duck with the software chip in the browser. */
  kind: RobotKind,
  created_at: Schema.Finite,
})
export type RobotRow = typeof RobotRow.Type

export const readRobot = (database: QueryDatabaseClient, robotId: string) =>
  firstRow(database.prepare('SELECT * FROM robots WHERE id = ?').bind(robotId), RobotRow)

/** `until = serverTime + 35 000 ms`; stored on every poll so the console can show `online`. */
export const renewLease = Effect.fnUntraced(function* (database: QueryDatabaseClient, robotId: string) {
  const serverTime = yield* Clock.currentTimeMillis
  const until = serverTime + LEASE_MS
  yield* database
    .prepare('UPDATE robots SET last_poll_at = ?, lease_until = ? WHERE id = ?')
    .bind(Math.floor(serverTime / 1000), until, robotId)
    .run()
  return { serverTime, lease: { until } }
})

/** `online = now < lease_until` (spec §8). */
export const leaseOf = (robot: RobotRow, nowMillis: number) => ({
  until: robot.lease_until,
  online: robot.lease_until !== null && nowMillis < robot.lease_until,
})
