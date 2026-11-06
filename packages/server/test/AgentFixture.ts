import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { Effect, Option, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { sha256Hex } from '../src/Respond.ts'
import { sweepLiveErrands } from '../src/Sweep.ts'

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
  /** Where the errand is stuck; `settling` unless given. */
  state: Schema.optionalKey(Schema.Literals(['settling', 'awaiting_approval'])),
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

const ExpiresIn = Schema.Struct({ inSeconds: Schema.optionalKey(Schema.Finite) })

/** An invoice whose QR has gone stale: its expiry is already behind the server clock (or only `inSeconds` ahead). */
const expireInvoiceRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/test/vq/invoices/:invoiceId/expire',
    Effect.gen(function* () {
      const { invoiceId } = yield* HttpRouter.params
      const { inSeconds } = yield* body(ExpiresIn)
      const result = yield* database
        .prepare('UPDATE invoices SET expires_at = unixepoch() + ? WHERE id = ?')
        .bind(inSeconds ?? -1, invoiceId ?? '')
        .run()
      return HttpServerResponse.empty({ status: result.meta.changes === 1 ? 204 : 404 })
    }),
  )

const Age = Schema.Struct({ millis: Schema.Finite })

/** An errand intent that began `millis` earlier, as one left waiting that long would have. */
const ageIntentRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/test/vq/intents/:intentId/age',
    Effect.gen(function* () {
      const { intentId } = yield* HttpRouter.params
      const { millis } = yield* body(Age)
      const aged = yield* database
        .prepare('UPDATE intents SET created_at = created_at - ? WHERE id = ?')
        .bind(millis, intentId ?? '')
        .run()
      return HttpServerResponse.empty({ status: aged.meta.changes === 1 ? 204 : 404 })
    }),
  )

const MediaObject = Schema.Struct({ key: Schema.String, text: Schema.String })

/** Overwrite an R2 object, as someone with bucket access tampering with a stored scan crop would. */
const tamperMediaRoute = (media: ReadWriteBucketClient) =>
  HttpRouter.route(
    'POST',
    '/test/vq/media',
    Effect.gen(function* () {
      const { key, text } = yield* body(MediaObject)
      yield* media.put(key, text).pipe(Effect.orDie)
      return noContent
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
              created_at) VALUES (?, ?, ?, 'chai', ?, ?, 0, unixepoch() - ?, unixepoch() * 1000)`,
          )
          .bind(
            episode.id,
            episode.robotId,
            episode.accountId,
            episode.invoiceId,
            episode.state ?? 'settling',
            episode.ageSeconds,
          ),
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

const SettledBody = Schema.Struct({ txHash: Schema.String })

/** A stand-in for a settlement that landed on Arc: the errand moves to `settling` (old enough to reconcile) and D1
 * holds a settled payment for its invoice, as the Settlement would have written it. */
const settledRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/test/vq/episodes/:episodeId/settled',
    Effect.gen(function* () {
      const { episodeId } = yield* HttpRouter.params
      const { txHash } = yield* body(SettledBody)
      yield* database.batch([
        database
          .prepare(
            `UPDATE episodes SET state = 'settling', state_changed_at = unixepoch() - 200 WHERE id = ? AND state = 'signing'`,
          )
          .bind(episodeId ?? ''),
        database
          .prepare(
            `INSERT INTO payments (invoice_hash, invoice_id, robot_id, episode_id, status, tx_hash, created_at, settled_at)
              SELECT invoices.invoice_hash, invoices.id, episodes.robot_id, episodes.id, 'settled', ?, unixepoch() * 1000,
                unixepoch() FROM episodes JOIN invoices ON invoices.id = episodes.invoice_id WHERE episodes.id = ?`,
          )
          .bind(txHash, episodeId ?? ''),
      ])
      return noContent
    }),
  )

const AuditEpisode = Schema.Struct({
  episodeId: Schema.String,
  accountId: Schema.String,
  requestId: Schema.String,
  inputJson: Schema.String,
  provider: Schema.String,
  rootHash: Schema.String,
  storageTx: Schema.String,
  logTx: Schema.String,
})

/** A finished, uploaded errand with one decision, as the audit routes read it. */
const auditEpisodeRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/test/vq/audit-episodes',
    Effect.gen(function* () {
      const episode = yield* body(AuditEpisode)
      yield* database.batch([
        database
          .prepare(
            `INSERT INTO episodes (id, robot_id, account_id, item, state, decision_count, result, state_changed_at, created_at)
              VALUES (?, 'audit-robot', ?, 'chai', 'paid', 1, ?, unixepoch(), unixepoch() * 1000)`,
          )
          .bind(episode.episodeId, episode.accountId, `0x${'6a'.repeat(32)}`),
        database
          .prepare(
            `INSERT INTO decisions (id, episode_id, step, model, request_id, chat_id, provider, latency_ms, prompt_sha256,
              input_json, action, reason, outcome, created_at) VALUES (?, ?, 1, 'm', ?, ?, ?, 1000, 'sha', ?, 'pay',
              'as asked', 'paid', unixepoch() * 1000)`,
          )
          .bind(
            `d-${episode.episodeId}`,
            episode.episodeId,
            episode.requestId,
            episode.requestId,
            episode.provider,
            episode.inputJson,
          ),
        database
          .prepare(
            `INSERT INTO evidence_uploads (episode_id, status, payload_json, request_ids_hash, root_hash, storage_tx, log_tx,
              attempts, uploaded_at, created_at) VALUES (?, 'uploaded', '{}', NULL, ?, ?, ?, 1, unixepoch(), unixepoch() * 1000)`,
          )
          .bind(episode.episodeId, episode.rootHash, episode.storageTx, episode.logTx),
      ])
      return noContent
    }),
  )

const DecisionCount = Schema.Struct({ count: Schema.Finite })

const decisionCountRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'GET',
    '/test/vq/episodes/:episodeId/decision-count',
    Effect.gen(function* () {
      const { episodeId } = yield* HttpRouter.params
      const row = yield* database
        .prepare('SELECT count(*) AS count FROM decisions WHERE episode_id = ?')
        .bind(episodeId ?? '')
        .first()
      const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(DecisionCount)(row))
      return yield* HttpServerResponse.json({ count: decoded?.count ?? -1 }).pipe(Effect.orDie)
    }),
  )

const SignedInvoice = Schema.Struct({ invoiceId: Schema.NullOr(Schema.String) })

/** Which invoice the chip was asked to sign for an errand (from the queued request's payload). */
const chipInvoiceRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'GET',
    '/test/vq/episodes/:episodeId/chip-invoice',
    Effect.gen(function* () {
      const { episodeId } = yield* HttpRouter.params
      const row = yield* database
        .prepare(
          `SELECT json_extract(payload_json, '$.invoice.id') AS invoiceId FROM chip_requests WHERE episode_id = ?`,
        )
        .bind(episodeId ?? '')
        .first()
      const decoded = Schema.decodeUnknownOption(SignedInvoice)(row)
      return yield* HttpServerResponse.json({
        invoiceId: Option.match(decoded, { onNone: () => null, onSome: (value) => value.invoiceId }),
      }).pipe(Effect.orDie)
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

const WorldSubBody = Schema.Struct({ accountId: Schema.String, sub: Schema.String })

/** A wallet whose World account is already bound (its first approval would bind it): Telegram may then send a link. */
const worldSubRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/test/vq/world-sub',
    Effect.gen(function* () {
      const { accountId, sub } = yield* body(WorldSubBody)
      yield* database.prepare('UPDATE accounts SET world_sub = ? WHERE id = ?').bind(sub, accountId).run()
      return noContent
    }),
  )

/** The approval message goes out again (as a retry would): the next flush renders it afresh. */
const notifyAgainRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/test/vq/notifications/:subjectId/again',
    Effect.gen(function* () {
      const { subjectId } = yield* HttpRouter.params
      yield* database
        .prepare("UPDATE notifications SET status = 'pending' WHERE kind = 'approval_needed' AND subject_id = ?")
        .bind(subjectId ?? '')
        .run()
      return noContent
    }),
  )

const SweepBody = Schema.Struct({ episodeId: Schema.String })
const EpisodeState = Schema.Struct({ state: Schema.String })

/** The Cron Trigger's errand sweep, run on demand; answers the errand's state as D1 holds it (no read-side tick). */
const sweepRoute = (database: QueryDatabaseClient) =>
  HttpRouter.route(
    'POST',
    '/test/vq/sweep',
    Effect.gen(function* () {
      const { episodeId } = yield* body(SweepBody)
      yield* sweepLiveErrands(database).pipe(Effect.orDie)
      const row = yield* database.prepare('SELECT state FROM episodes WHERE id = ?').bind(episodeId).first()
      const state = yield* Schema.decodeUnknownEffect(EpisodeState)(row).pipe(Effect.orDie)
      return yield* HttpServerResponse.json(state).pipe(Effect.orDie)
    }),
  )

export const agentFixtureRoutes = (database: QueryDatabaseClient, media: ReadWriteBucketClient) =>
  HttpRouter.addAll([
    robotRoute(database),
    expireInvoiceRoute(database),
    ageIntentRoute(database),
    tamperMediaRoute(media),
    grantRoute(database),
    queueRoute(database),
    forcePaidRoute(database),
    chipRequestRoute(database),
    stuckEpisodeRoute(database),
    sweepRoute(database),
    worldSubRoute(database),
    notifyAgainRoute(database),
    settledRoute(database),
    chipInvoiceRoute(database),
    auditEpisodeRoute(database),
    decisionCountRoute(database),
  ])
