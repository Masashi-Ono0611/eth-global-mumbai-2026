import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Effect, Option, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { sha256Hex } from '../src/Respond.ts'

// Test-only D1 writes for the merchant, chip and robot acceptance (RuntimeWorker mounts them under `/test/vq/`).
// They stand in for the Wallet's robot and grant pages, which these tests do not exercise.

const Robot = Schema.Struct({
  id: Schema.String,
  accountId: Schema.String,
  pairingCode: Schema.NullOr(Schema.String),
  chipAddress: Schema.NullOr(Schema.String),
  chipToken: Schema.NullOr(Schema.String),
})
const Grant = Schema.Struct({
  id: Schema.String,
  robotId: Schema.String,
  accountId: Schema.String,
  delegationHash: Schema.String,
  delegationJson: Schema.String,
  dailyCap: Schema.String,
  perPaymentCap: Schema.String,
  allowlistJson: Schema.String,
  startAt: Schema.Finite,
  expiresAt: Schema.Finite,
})
const QueuedRequest = Schema.Struct({
  id: Schema.String,
  robotId: Schema.String,
  episodeId: Schema.String,
  payloadJson: Schema.String,
  expiresAt: Schema.Finite,
})

const StuckEpisode = Schema.Struct({
  id: Schema.String,
  robotId: Schema.String,
  accountId: Schema.String,
  invoiceId: Schema.String,
  ageSeconds: Schema.Finite,
  settledTx: Schema.NullOr(Schema.String),
})

const body = <A>(schema: Schema.ConstraintDecoder<A>) => HttpServerRequest.schemaBodyJson(schema).pipe(Effect.orDie)
const noContent = HttpServerResponse.empty({ status: 204 })

const robotRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/test/vq/robots',
    Effect.gen(function* () {
      const robot = yield* body(Robot)
      const tokenHash = robot.chipToken === null ? null : yield* sha256Hex(robot.chipToken)
      yield* database
        .prepare(
          `INSERT INTO robots (id, account_id, name, pairing_code, pairing_expires_at, chip_address, chip_token_hash,
            paired_at, status, created_at) VALUES (?, ?, 'Native duck', ?, unixepoch() + 600, ?, ?, ?, ?, unixepoch() * 1000)`,
        )
        .bind(
          robot.id,
          robot.accountId,
          robot.pairingCode,
          robot.chipAddress,
          tokenHash,
          robot.chipAddress === null ? null : 0,
          robot.chipAddress === null ? 'unpaired' : 'paired',
        )
        .run()
      return noContent
    }),
  )

const grantRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/test/vq/grants',
    Effect.gen(function* () {
      const grant = yield* body(Grant)
      yield* database
        .prepare(
          `INSERT INTO grants (id, robot_id, account_id, delegation_hash, delegation_json, daily_cap, per_payment_cap,
            allowlist_json, start_at, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', unixepoch() * 1000)`,
        )
        .bind(
          grant.id,
          grant.robotId,
          grant.accountId,
          grant.delegationHash,
          grant.delegationJson,
          grant.dailyCap,
          grant.perPaymentCap,
          grant.allowlistJson,
          grant.startAt,
          grant.expiresAt,
        )
        .run()
      return noContent
    }),
  )

const queueRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/test/vq/chip-requests',
    Effect.gen(function* () {
      const request = yield* body(QueuedRequest)
      yield* database
        .prepare(
          `INSERT INTO chip_requests (id, robot_id, episode_id, kind, payload_json, status, expires_at, created_at)
            VALUES (?, ?, ?, 'sign-invoice', ?, 'queued', ?, unixepoch() * 1000)`,
        )
        .bind(request.id, request.robotId, request.episodeId, request.payloadJson, request.expiresAt)
        .run()
      return noContent
    }),
  )

const forcePaidRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/test/vq/invoices/:invoiceId/force-paid',
    Effect.gen(function* () {
      const { invoiceId } = yield* HttpRouter.params
      const result = yield* database
        .prepare(`UPDATE invoices SET status = 'paid', paid_tx = ? WHERE id = ? AND status = 'pending'`)
        .bind(`0x${'ab'.repeat(32)}`, invoiceId ?? '')
        .run()
      return HttpServerResponse.empty({ status: result.meta.changes === 1 ? 204 : 404 })
    }),
  )

/** An errand left in `settling` by a Worker that died, optionally with the payment D1 recorded as settled. */
const stuckEpisodeRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/test/vq/stuck-episodes',
    Effect.gen(function* () {
      const episode = yield* body(StuckEpisode)
      const statements = [
        database
          .prepare(
            `INSERT INTO episodes (id, robot_id, account_id, item, invoice_id, state, decision_count, state_changed_at,
              created_at) VALUES (?, ?, ?, 'chai', ?, 'settling', 0, unixepoch() - ?, unixepoch() * 1000)`,
          )
          .bind(episode.id, episode.robotId, episode.accountId, episode.invoiceId, episode.ageSeconds),
      ]
      if (episode.settledTx !== null)
        statements.push(
          database
            .prepare(
              `INSERT INTO payments (invoice_hash, invoice_id, robot_id, episode_id, status, tx_hash, created_at, settled_at)
                SELECT invoice_hash, id, ?, ?, 'settled', ?, unixepoch() * 1000, unixepoch() FROM invoices WHERE id = ?`,
            )
            .bind(episode.robotId, episode.id, episode.settledTx, episode.invoiceId),
        )
      yield* database.batch(statements)
      return noContent
    }),
  )

const ChipRequestStatus = Schema.Struct({ status: Schema.String })

const chipRequestRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'GET',
    '/test/vq/chip-requests/:requestId',
    Effect.gen(function* () {
      const { requestId } = yield* HttpRouter.params
      const row = yield* database
        .prepare('SELECT status FROM chip_requests WHERE id = ?')
        .bind(requestId ?? '')
        .first()
      const decoded = Schema.decodeUnknownOption(ChipRequestStatus)(row)
      return yield* Option.isNone(decoded)
        ? Effect.succeed(HttpServerResponse.empty({ status: 404 }))
        : HttpServerResponse.json(decoded.value).pipe(Effect.orDie)
    }),
  )

export const agentFixtureRoutes = (database: QueryDatabaseClient) =>
  HttpRouter.addAll([
    robotRoute(database),
    grantRoute(database),
    queueRoute(database),
    forcePaidRoute(database),
    chipRequestRoute(database),
    stuckEpisodeRoute(database),
  ])
