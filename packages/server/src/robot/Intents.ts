import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { generateId } from '@ethmumbai/protocol/Base32'
import { CreateIntentRequest, type IntentView, type NavTurnView } from '@ethmumbai/protocol/Intent'
import { Clock, Effect, Option } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { type ErrandDeps, LIVE_STATES, readEpisode, tickRobot } from './Errands.ts'
import { ErrandRefused, MERCHANT_ID, need } from './Start.ts'
import { IntentRow, navCallsOf, type NavTurnRow, navTurnsOf, readIntent } from './IntentRows.ts'
import { decodeTeeProof } from './TeeProof.ts'
import { CurrentSession, requireSession } from '../auth/Session.ts'
import { readRobot, type RobotRow } from '../chip/Lease.ts'
import { authenticateChip } from '../chip/Pairing.ts'
import { findItem, findMerchant } from '../merchant/Catalogue.ts'
import { json, jsonError, sha256Hex } from '../Respond.ts'
import { changes, firstRow } from '../Sql.ts'

// The owner's errand intents (protocol Intent.ts): one instruction for one robot, created the same way from a Buy
// chip, typed text or voice (`createIntent` is the one shared operation). A scan by that robot claims the open intent
// so the 0G `decide` sees the instruction; for a simulator robot the intent is also the 0G navigation session (Nav.ts).
// The instruction is owner text: it is stored for the owner and the prompt, logged only as its SHA-256.

/** An open intent with no navigation turn for this long ends `expired` (applied lazily on every read). */
const INTENT_IDLE_MS = 600_000

/** The newest open intent (running or scanned) of this robot. */
export const openIntent = (database: QueryDatabaseClient, robotId: string) =>
  firstRow(
    database
      .prepare(
        `SELECT * FROM intents WHERE robot_id = ? AND state IN ('running', 'scanned') ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(robotId),
    IntentRow,
  )

const LIVE = LIVE_STATES.map((state) => `'${state}'`).join(', ')

/**
 * Lazy timeouts, like `tickRobot`'s: an open intent idle for 10 minutes (no navigation turn since it began or since its
 * last turn) ends `expired`; a real robot's intent expires only while no scan claimed it (it never gets a navigation
 * turn), and its scanned intent ends `finished` once its errand ended (it has no navigation turn to finish it).
 */
export const settleIntents = Effect.fn('EthMumbai.Robot.settleIntents')(function* (
  database: QueryDatabaseClient,
  robotId: string,
) {
  yield* tickRobot(database, robotId)
  const now = yield* Clock.currentTimeMillis
  yield* database.batch([
    database
      .prepare(
        `UPDATE intents SET state = 'expired', ended_at = ?, busy_until = NULL, reason = CASE
            WHEN (SELECT kind FROM robots WHERE robots.id = intents.robot_id) = 'chip' THEN 'no scan within 10 minutes'
            ELSE 'no navigation turn for 10 minutes' END
          WHERE robot_id = ? AND state IN ('running', 'scanned')
          AND (state = 'running' OR (SELECT kind FROM robots WHERE robots.id = intents.robot_id) != 'chip')
          AND COALESCE((SELECT MAX(created_at) FROM nav_turns WHERE nav_turns.intent_id = intents.id), created_at) < ?`,
      )
      .bind(now, robotId, now - INTENT_IDLE_MS),
    database
      .prepare(
        `UPDATE intents SET state = 'finished', ended_at = ?,
          reason = (SELECT 'errand ' || episodes.state FROM episodes WHERE episodes.id = intents.episode_id)
          WHERE robot_id = ? AND state = 'scanned' AND busy_until IS NULL
          AND (SELECT kind FROM robots WHERE robots.id = intents.robot_id) = 'chip'
          AND EXISTS (SELECT 1 FROM episodes WHERE episodes.id = intents.episode_id AND episodes.state NOT IN (${LIVE}))`,
      )
      .bind(now, robotId),
  ])
})

/** Move an open intent to its end state (a lost race means it had already ended: nothing changes). */
export const endIntent = Effect.fnUntraced(function* (
  database: QueryDatabaseClient,
  intentId: string,
  state: 'finished' | 'stopped' | 'expired',
  reason: string,
) {
  const now = yield* Clock.currentTimeMillis
  return yield* changes(
    database
      .prepare(
        `UPDATE intents SET state = ?, reason = ?, ended_at = ?, busy_until = NULL
          WHERE id = ? AND state IN ('running', 'scanned')`,
      )
      .bind(state, reason, now, intentId),
  ).pipe(Effect.map((moved) => moved === 1))
})

/** A scan by the robot claims its running intent for the errand it started (once: the conditional move wins once). */
export const claimIntent = (database: QueryDatabaseClient, intentId: string, episodeId: string) =>
  changes(
    database
      .prepare(
        `UPDATE intents SET state = 'scanned', episode_id = ? WHERE id = ? AND state = 'running' AND episode_id IS NULL`,
      )
      .bind(episodeId, intentId),
  ).pipe(Effect.map((moved) => moved === 1))

/** What `decide` sees of the intent (DecideInput.owner). */
export const ownerOf = (intent: IntentRow) => ({
  instruction: intent.instruction,
  ...(intent.item === null ? {} : { item: intent.item }),
})

const turnView = (row: NavTurnRow): NavTurnView => ({
  step: row.step,
  model: row.model,
  chatId: row.chat_id,
  latencyMs: row.latency_ms,
  calls: navCallsOf(row.calls_json),
  reasoning: row.reasoning,
  error: row.error,
  tee: Option.getOrNull(decodeTeeProof(row.tee_json)),
  createdAt: row.created_at,
})

export const intentView = Effect.fnUntraced(function* (database: QueryDatabaseClient, intent: IntentRow) {
  const turns = yield* navTurnsOf(database, intent.id)
  const episode = intent.episode_id === null ? Option.none() : yield* readEpisode(database, intent.episode_id)
  return {
    id: intent.id,
    robotId: intent.robot_id,
    state: intent.state,
    instruction: intent.instruction,
    item: intent.item,
    episodeId: intent.episode_id,
    episodeState: Option.match(episode, { onNone: () => null, onSome: (row) => row.state }),
    reason: intent.reason,
    turns: turns.map(turnView),
    createdAt: intent.created_at,
  } satisfies IntentView
})

/**
 * The one shared operation behind the Buy chips, typed text and voice: a new `running` intent for this (owner-checked,
 * paired) robot. 409 while another intent of the robot is open (the check and the insert are one statement); 400 for
 * an item the café does not sell.
 */
export const createIntent = Effect.fn('EthMumbai.Robot.createIntent')(function* (
  deps: Pick<ErrandDeps, 'database'>,
  input: { readonly robot: RobotRow; readonly instruction: string; readonly item?: string | undefined },
) {
  const { database } = deps
  const { robot, instruction, item } = input
  if (robot.status !== 'paired') return yield* new ErrandRefused({ status: 409, error: 'robot is not paired' })
  if (item !== undefined) {
    const merchant = yield* need(findMerchant(MERCHANT_ID), 500, 'merchant catalogue is missing')
    yield* need(findItem(merchant, item), 400, 'unknown item')
  }
  yield* settleIntents(database, robot.id)
  const id = yield* generateId
  const instructionSha256 = `0x${yield* sha256Hex(instruction)}`
  const createdAt = yield* Clock.currentTimeMillis
  const inserted = yield* changes(
    database
      .prepare(
        `INSERT INTO intents (id, robot_id, account_id, instruction, instruction_sha256, item, state, turn, created_at)
          SELECT ?, ?, ?, ?, ?, ?, 'running', 0, ?
          WHERE NOT EXISTS (SELECT 1 FROM intents WHERE robot_id = ? AND state IN ('running', 'scanned'))`,
      )
      .bind(id, robot.id, robot.account_id, instruction, instructionSha256, item ?? null, createdAt, robot.id),
  )
  if (inserted !== 1)
    return yield* new ErrandRefused({ status: 409, error: 'this robot already has an open errand intent' })
  yield* Effect.logInfo('intent created').pipe(
    Effect.annotateLogs({ robotId: robot.id, intentId: id, instructionSha256 }),
  )
  const row = yield* need(yield* readIntent(database, id), 500, 'intent lost after insert')
  return yield* intentView(database, row)
})

/** The signed-in owner's own robot (another account's robot is indistinguishable from a missing one). */
const ownRobot = Effect.fnUntraced(function* (deps: ErrandDeps) {
  const session = yield* CurrentSession
  const robot = yield* readRobot(deps.database, (yield* HttpRouter.params).robotId ?? '')
  return yield* need(
    Option.filter(robot, (row) => row.account_id === session.accountId),
    404,
    'unknown robot',
  )
})

/** The owner's intent of that robot. */
const ownIntent = Effect.fnUntraced(function* (deps: ErrandDeps) {
  const robot = yield* ownRobot(deps)
  yield* settleIntents(deps.database, robot.id)
  const intent = yield* readIntent(deps.database, (yield* HttpRouter.params).intentId ?? '')
  return yield* need(
    Option.filter(intent, (row) => row.robot_id === robot.id),
    404,
    'unknown intent',
  )
})

const answerRefusals = <R>(handler: Effect.Effect<HttpServerResponse.HttpServerResponse, ErrandRefused, R>) =>
  handler.pipe(Effect.catchTag('ErrandRefused', ({ status, error }) => jsonError(status, error)))

const create = (deps: ErrandDeps) =>
  answerRefusals(
    Effect.gen(function* () {
      const robot = yield* ownRobot(deps)
      const body = yield* need(
        yield* HttpServerRequest.schemaBodyJson(CreateIntentRequest).pipe(Effect.option),
        400,
        'expected {"instruction": string (1–200 chars), "item"?: string}',
      )
      return yield* json(yield* createIntent(deps, { robot, instruction: body.instruction, item: body.item }), 201)
    }),
  )

const read = (deps: ErrandDeps) =>
  answerRefusals(
    Effect.gen(function* () {
      const intent = yield* ownIntent(deps)
      return yield* json(yield* intentView(deps.database, intent))
    }),
  )

const stop = (deps: ErrandDeps) =>
  answerRefusals(
    Effect.gen(function* () {
      const intent = yield* ownIntent(deps)
      yield* endIntent(deps.database, intent.id, 'stopped', 'stopped by the owner')
      const stopped = yield* need(yield* readIntent(deps.database, intent.id), 500, 'intent lost')
      return yield* json(yield* intentView(deps.database, stopped))
    }),
  )

/** The chip's (the sim's) read: its newest open intent, 204 without one. */
const chipRead = (deps: ErrandDeps) =>
  answerRefusals(
    Effect.gen(function* () {
      const robot = yield* need(
        yield* authenticateChip(deps.database, (yield* HttpRouter.params).robotId ?? ''),
        401,
        'bad chip token',
      )
      yield* settleIntents(deps.database, robot.id)
      const intent = yield* openIntent(deps.database, robot.id)
      if (Option.isNone(intent)) return HttpServerResponse.empty({ status: 204 })
      return yield* json(yield* intentView(deps.database, intent.value))
    }),
  )

/** Owner routes (session + Origin) and the chip's read; `RobotAgent` mounts them only while `SCANS_ENABLED`. */
export const intentRoutes = (deps: ErrandDeps) =>
  HttpRouter.addAll([
    HttpRouter.route('POST', '/api/robots/:robotId/intents', requireSession(create(deps))),
    HttpRouter.route('GET', '/api/robots/:robotId/intents/:intentId', requireSession(read(deps))),
    HttpRouter.route('POST', '/api/robots/:robotId/intents/:intentId/stop', requireSession(stop(deps))),
    HttpRouter.route('GET', '/api/chips/:robotId/intent', chipRead(deps)),
  ])
