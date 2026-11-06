import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { pairMessage, PairRequest } from '@ethmumbai/protocol/Chip'
import { Clock, Effect, Option } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import { getAddress, recoverMessageAddress } from 'viem'
import { readRobot, RobotRow } from './Lease.ts'
import { json, jsonError, randomBytes, sha256Hex } from '../Respond.ts'
import { changes, firstRow } from '../Sql.ts'

/** The chip proves it holds the key it pairs: EIP-191 over `Vitaquack pair <code> <address lowercase> 5042`. */
const signerOf = (code: string, address: string, sig: `0x${string}`) =>
  Effect.tryPromise(() => recoverMessageAddress({ message: pairMessage(code, address), signature: sig })).pipe(
    Effect.option,
  )

const pairRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/api/chips/pair',
    Effect.gen(function* () {
      const body = yield* HttpServerRequest.schemaBodyJson(PairRequest).pipe(Effect.option)
      if (Option.isNone(body)) return yield* jsonError(400, 'expected {pairingCode, address, sig}')
      const { pairingCode, address, sig } = body.value
      const signer = yield* signerOf(pairingCode, address, sig)
      if (Option.isNone(signer) || signer.value.toLowerCase() !== address.toLowerCase())
        return yield* jsonError(401, 'signature does not recover to address')
      const serverTime = yield* Clock.currentTimeMillis
      const now = Math.floor(serverTime / 1000)
      const robot = yield* firstRow(
        database.prepare('SELECT * FROM robots WHERE pairing_code = ?').bind(pairingCode),
        RobotRow,
      )
      if (Option.isNone(robot) || (robot.value.pairing_expires_at ?? 0) <= now)
        return yield* jsonError(404, 'unknown or expired pairing code')
      if (robot.value.status !== 'unpaired') return yield* jsonError(409, 'pairing code already used')
      const chipAddress = getAddress(address)
      const taken = yield* firstRow(
        database.prepare('SELECT * FROM robots WHERE chip_address = ?').bind(chipAddress),
        RobotRow,
      )
      if (Option.isSome(taken)) return yield* jsonError(409, 'chip already paired to a robot')
      const chipToken = Base64Url.encode(yield* randomBytes(32))
      const won = yield* changes(
        database
          .prepare(
            `UPDATE robots SET chip_address = ?, chip_token_hash = ?, paired_at = ?, status = 'paired'
              WHERE id = ? AND status = 'unpaired'`,
          )
          .bind(chipAddress, yield* sha256Hex(chipToken), now, robot.value.id),
      )
      if (won !== 1) return yield* jsonError(409, 'pairing code already used')
      yield* Effect.logInfo('chip paired').pipe(Effect.annotateLogs({ robotId: robot.value.id }))
      return yield* json({ robotId: robot.value.id, chipToken, serverTime })
    }),
  )

/** `Authorization: Bearer <chipToken>` for this paired robot; the token is stored only as its SHA-256. */
export const authenticateChip = Effect.fnUntraced(function* (database: QueryDatabaseClient, robotId: string) {
  const request = yield* HttpServerRequest.HttpServerRequest
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1]
  if (token === undefined) return Option.none()
  const robot = yield* readRobot(database, robotId)
  const hash = yield* sha256Hex(token)
  return Option.filter(robot, (row) => row.status === 'paired' && row.chip_token_hash === hash)
})

export const pairingRoutes = (database: QueryDatabaseClient) => HttpRouter.addAll([pairRoute(database)])
