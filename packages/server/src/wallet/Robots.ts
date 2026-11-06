import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { idFromBytes16 } from '@ethmumbai/protocol/Base32'
import { Address } from '@ethmumbai/protocol/Hex'
import { RobotKind } from '@ethmumbai/protocol/Intent'
import { Clock, Effect, Layer, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { decodeBody } from '../auth/Routes.ts'
import { CurrentSession, requireSession } from '../auth/Session.ts'
import { leaseOf, RobotRow } from '../chip/Lease.ts'
import { json, nowSeconds, randomBytes } from '../Respond.ts'
import { GrantRow } from '../robot/Budget.ts'
import { allRows } from '../Sql.ts'
import type { WalletDeps } from './Deps.ts'
import { answerWalletErrors } from './Errors.ts'
import { finalizeRevoke } from './Revoke.ts'

/** Pairing codes: 8 characters of this alphabet (no 0/O, 1/I/L), valid 10 minutes, single use (spec §8). */
export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const PAIRING_SECONDS = 600
const PAIRING_LENGTH = 8
/** The largest multiple of 31 below 256: bytes at or above it are dropped so every character is equally likely. */
const UNBIASED_LIMIT = Math.floor(256 / PAIRING_ALPHABET.length) * PAIRING_ALPHABET.length

export const pairingCodeFrom = (bytes: Uint8Array) =>
  [...bytes]
    .filter((byte) => byte < UNBIASED_LIMIT)
    .slice(0, PAIRING_LENGTH)
    .map((byte) => PAIRING_ALPHABET.charAt(byte % PAIRING_ALPHABET.length))
    .join('')

const newPairingCode: Effect.Effect<string> = Effect.flatMap(randomBytes(32), (bytes) => {
  const code = pairingCodeFrom(bytes)
  return code.length === PAIRING_LENGTH ? Effect.succeed(code) : newPairingCode
})

const NewRobot = Schema.Struct({
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(40)),
  /** `sim` adds a simulator duck (its software chip pairs from /sim/); absent = a real robot's chip. */
  kind: Schema.optionalKey(RobotKind),
})

/** `POST /api/robots {name, kind?}` → 201 `{robotId, name, kind, pairingCode, pairingExpiresAt}`: the "Add robot" button. */
const addRobot = (database: QueryDatabaseClient) =>
  Effect.gen(function* () {
    const { name, kind = 'chip' } = yield* decodeBody(NewRobot)
    const session = yield* CurrentSession
    const robotId = idFromBytes16(yield* randomBytes(16))
    const pairingCode = yield* newPairingCode
    const pairingExpiresAt = (yield* nowSeconds) + PAIRING_SECONDS
    yield* database
      .prepare(
        "INSERT INTO robots (id, account_id, name, pairing_code, pairing_expires_at, status, kind, created_at) VALUES (?, ?, ?, ?, ?, 'unpaired', ?, ?)",
      )
      .bind(robotId, session.accountId, name, pairingCode, pairingExpiresAt, kind, yield* Clock.currentTimeMillis)
      .run()
    yield* Effect.logInfo('robot added').pipe(Effect.annotateLogs({ robotId }))
    return yield* json({ robotId, name, kind, pairingCode, pairingExpiresAt }, 201)
  })

const Allowlist = Schema.fromJsonString(Schema.Array(Address))

/** The grant as the owner sees it: caps in USDC base units, the allowlist, the window, the revoke tx. */
export const grantView = (row: GrantRow) =>
  Effect.map(Schema.decodeUnknownEffect(Allowlist)(row.allowlist_json).pipe(Effect.orDie), (allowlist) => ({
    id: row.id,
    status: row.status,
    delegationHash: row.delegation_hash,
    dailyCap: row.daily_cap,
    perPaymentCap: row.per_payment_cap,
    allowlist,
    startAt: row.start_at,
    expiresAt: row.expires_at,
    revokeTx: row.revoke_tx,
  }))

/** `GET /api/robots` → the owner's robots, each with its lease and its latest grant that was signed. */
const listRobots = (deps: WalletDeps) =>
  Effect.gen(function* () {
    const { database } = deps
    const session = yield* CurrentSession
    const robots = yield* allRows(
      database.prepare('SELECT * FROM robots WHERE account_id = ? ORDER BY created_at DESC').bind(session.accountId),
      RobotRow,
    )
    const signedGrants = database
      .prepare("SELECT * FROM grants WHERE account_id = ? AND status != 'unsigned' ORDER BY created_at DESC")
      .bind(session.accountId)
    // A revoke whose receipt the request missed is settled here, from Arc's DelegationManager.
    const pending = (yield* allRows(signedGrants, GrantRow)).filter((grant) => grant.status === 'revoking')
    yield* Effect.forEach(pending, (grant) => finalizeRevoke(deps, grant), { discard: true })
    const grants = yield* allRows(signedGrants, GrantRow)
    const now = yield* nowSeconds
    const nowMillis = yield* Clock.currentTimeMillis
    const views = yield* Effect.forEach(robots, (robot) =>
      Effect.gen(function* () {
        const latest = grants.find((grant) => grant.robot_id === robot.id)
        const pairable = robot.status === 'unpaired' && (robot.pairing_expires_at ?? 0) > now
        return {
          id: robot.id,
          name: robot.name,
          kind: robot.kind,
          status: robot.status,
          chipAddress: robot.chip_address,
          pairingCode: pairable ? robot.pairing_code : null,
          pairingExpiresAt: pairable ? robot.pairing_expires_at : null,
          lease: leaseOf(robot, nowMillis),
          grant: latest === undefined ? null : yield* grantView(latest),
        }
      }),
    )
    return yield* json({ robots: views })
  })

export const robotsRoutes = (deps: WalletDeps) =>
  Layer.mergeAll(
    HttpRouter.add('POST', '/api/robots', requireSession(answerWalletErrors(addRobot(deps.database)))),
    HttpRouter.add('GET', '/api/robots', requireSession(listRobots(deps))),
  )
