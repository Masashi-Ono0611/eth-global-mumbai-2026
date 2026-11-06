import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { POLL_HOLD_MS, type SignRequest } from '@ethmumbai/protocol/Chip'
import { Clock, Effect, Option } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import type { ChipHooks } from './Hooks.ts'
import { renewLease } from './Lease.ts'
import { authenticateChip } from './Pairing.ts'
import { expireRequests, takeQueued } from './Requests.ts'
import { json, jsonError } from '../Respond.ts'

/** How often a held poll looks for queued requests: a short D1 read per tick, well inside the Worker's CPU budget. */
const POLL_INTERVAL = '1 second'

/** Hold until a request is queued or 25 s pass; return whatever was claimed (possibly nothing). */
const waitForRequests = Effect.fnUntraced(function* (database: QueryDatabaseClient, robotId: string) {
  const deadline = (yield* Clock.currentTimeMillis) + POLL_HOLD_MS
  let requests: ReadonlyArray<SignRequest> = []
  while (requests.length === 0) {
    const now = yield* Clock.currentTimeMillis
    // A transient D1 failure (SQLITE_BUSY under a concurrent write) costs one tick, not the whole held poll.
    requests = yield* takeQueued(database, robotId, Math.floor(now / 1000)).pipe(
      Effect.catchDefect((defect) =>
        Effect.as(Effect.logWarning('poll tick skipped: D1 read failed', String(defect).slice(0, 200)), []),
      ),
    )
    if (requests.length > 0 || now + 1000 > deadline) break
    yield* Effect.sleep(POLL_INTERVAL)
  }
  return requests
})

/** `GET /api/chips/:robotId/poll` (bearer chip token) → `{serverTime, lease:{until}, requests}` within 25 s. */
export const pollRoute = (database: QueryDatabaseClient, hooks: ChipHooks) =>
  HttpRouter.route(
    'GET',
    '/api/chips/:robotId/poll',
    Effect.gen(function* () {
      const { robotId } = yield* HttpRouter.params
      const robot = yield* authenticateChip(database, robotId ?? '')
      if (Option.isNone(robot)) return yield* jsonError(401, 'bad chip token')
      const id = robot.value.id
      yield* renewLease(database, id)
      yield* expireRequests(database, id, Math.floor((yield* Clock.currentTimeMillis) / 1000))
      yield* hooks.tick(id)
      const requests = yield* waitForRequests(database, id)
      const { serverTime, lease } = yield* renewLease(database, id)
      return yield* json({ serverTime, lease, requests }, 200, { 'cache-control': 'no-store' })
    }),
  )
