import { Effect, Layer, Option, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import { CurrentSession, requireSession } from '../auth/Session.ts'
import { json, jsonError } from '../Respond.ts'
import { allRows, firstRow } from '../Sql.ts'
import type { WalletDeps } from './Deps.ts'
import { type ObservationView, observationsOfEpisode } from './Observations.ts'
import {
  ApprovalAuditRow,
  ChipAuditRow,
  DecisionAuditRow,
  EpisodeAuditRow,
  EvidenceAuditRow,
  endedAt,
  InvoiceAuditRow,
  PaymentAuditRow,
  timelineOf,
  worldClaims,
} from './EpisodeTimeline.ts'

const Text = Schema.NullOr(Schema.String)
const Time = Schema.NullOr(Schema.Finite)

const ListRow = Schema.Struct({
  id: Schema.String,
  robot_id: Schema.String,
  robot_name: Schema.String,
  item: Schema.String,
  state: Schema.String,
  result: Text,
  state_changed_at: Time,
  created_at: Schema.Finite,
  action: Text,
  reason: Text,
  request_id: Text,
  provider: Text,
  latency_ms: Time,
  tx_hash: Text,
  payment_status: Text,
  approval_status: Text,
  amr_json: Text,
  evidence_status: Text,
  root_hash: Text,
  log_tx: Text,
})

const ListQuery = Schema.Struct({
  robotId: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(64))),
  limit: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\d{1,3}$/))),
})
const MAX_LIST = 50

/** The latest row per errand of each child table, picked by subquery so an errand stays one row. */
const LIST_SQL = `SELECT e.id, e.robot_id, r.name AS robot_name, e.item, e.state, e.result, e.state_changed_at, e.created_at,
    d.action, d.reason, d.request_id, d.provider, d.latency_ms,
    COALESCE(p.tx_hash, i.paid_tx) AS tx_hash, COALESCE(p.status, CASE WHEN i.paid_tx IS NULL THEN NULL ELSE 'settled' END) AS payment_status,
    a.status AS approval_status, a.amr_json,
    u.status AS evidence_status, u.root_hash, u.log_tx
  FROM episodes e JOIN robots r ON r.id = e.robot_id
    LEFT JOIN invoices i ON i.id = e.invoice_id
    LEFT JOIN decisions d ON d.id = (SELECT id FROM decisions WHERE episode_id = e.id ORDER BY step DESC, created_at DESC LIMIT 1)
    LEFT JOIN payments p ON p.invoice_hash = (SELECT invoice_hash FROM payments WHERE episode_id = e.id ORDER BY created_at DESC LIMIT 1)
    LEFT JOIN approvals a ON a.id = (SELECT id FROM approvals WHERE episode_id = e.id ORDER BY created_at DESC LIMIT 1)
    LEFT JOIN evidence_uploads u ON u.episode_id = e.id
  WHERE e.account_id = ? AND (? IS NULL OR e.robot_id = ?)
  ORDER BY e.created_at DESC LIMIT ?`

const listView = (row: typeof ListRow.Type) => ({
  id: row.id,
  robotId: row.robot_id,
  robotName: row.robot_name,
  item: row.item,
  state: row.state,
  result: row.result,
  createdAt: row.created_at,
  endedAt: endedAt(row),
  decision:
    row.action === null
      ? null
      : {
          action: row.action,
          reason: row.reason,
          requestId: row.request_id,
          provider: row.provider,
          latencyMs: row.latency_ms,
        },
  payment: row.payment_status === null ? null : { status: row.payment_status, txHash: row.tx_hash },
  approval: row.approval_status === null ? null : { status: row.approval_status, world: worldClaims(row.amr_json) },
  evidence:
    row.evidence_status === null ? null : { status: row.evidence_status, rootHash: row.root_hash, logTx: row.log_tx },
})

/** `GET /api/wallet/episodes?robotId=&limit=50` → the owner's errands, newest first, one row each with its latest
 * decision, payment, World approval and evidence. Another owner's robot simply has no rows here. */
const listEpisodes = (deps: WalletDeps) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    const query = yield* HttpServerRequest.schemaSearchParams(ListQuery).pipe(Effect.option)
    if (Option.isNone(query)) return yield* jsonError(400, 'expected ?robotId=<id>&limit=<1-50>')
    const robotId = query.value.robotId ?? null
    const limit = Math.min(MAX_LIST, Math.max(1, Number(query.value.limit ?? MAX_LIST)))
    const rows = yield* allRows(
      deps.database.prepare(LIST_SQL).bind(session.accountId, robotId, robotId, limit),
      ListRow,
    )
    return yield* json({ episodes: rows.map(listView) })
  })

const IdPath = Schema.Struct({ id: Schema.String.check(Schema.isMaxLength(64)) })

/** Every row the errand touched, read in one batch of statements; none carries a key, token, signature or prompt. */
const readRows = Effect.fn('EthMumbai.Wallet.episodeRows')(function* (deps: WalletDeps, episodeId: string) {
  const byEpisode = <A>(sql: string, schema: Schema.ConstraintDecoder<A>) =>
    allRows(deps.database.prepare(sql).bind(episodeId), schema)
  return {
    decisions: yield* byEpisode(
      `SELECT id, step, model, request_id, chat_id, provider, latency_ms, prompt_sha256, input_json, action, reason,
         outcome, outcome_ref, error, created_at FROM decisions WHERE episode_id = ? ORDER BY step, created_at`,
      DecisionAuditRow,
    ),
    chipRequests: yield* byEpisode(
      `SELECT id, kind, status, refusal_code, leaf_hash, expires_at, delivered_at, responded_at, created_at
         FROM chip_requests WHERE episode_id = ? ORDER BY created_at`,
      ChipAuditRow,
    ),
    payments: yield* byEpisode(
      `SELECT invoice_id, status, tx_hash, gas_used, fail_reason, payer, approval_id, settled_at, created_at
         FROM payments WHERE episode_id = ? ORDER BY created_at`,
      PaymentAuditRow,
    ),
    approvals: yield* byEpisode(
      `SELECT id, status, error, amount, payee, auth_time, amr_json, decided_at, created_at
         FROM approvals WHERE episode_id = ? ORDER BY created_at`,
      ApprovalAuditRow,
    ),
    observations: yield* observationsOfEpisode(deps.database, episodeId),
    evidence: Option.getOrNull(
      yield* firstRow(
        deps.database
          .prepare(
            `SELECT status, root_hash, storage_tx, log_tx, request_ids_hash, attempts, error, uploaded_at, created_at
               FROM evidence_uploads WHERE episode_id = ?`,
          )
          .bind(episodeId),
        EvidenceAuditRow,
      ),
    ),
  }
})

/**
 * `GET /api/wallet/episodes/:id` → the whole errand for inspection: the episode, its invoice, every 0G decision with
 * the exact structured input and the prompt hash, the chip's sign request, the payment on Arc, the World approval
 * (status and the token's `acr`/`amr`), the evidence upload, and a timeline of every recorded moment.
 */
const readEpisodeAudit = (deps: WalletDeps) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    const { id } = yield* HttpRouter.schemaPathParams(IdPath).pipe(Effect.orDie)
    const episode = yield* firstRow(
      deps.database
        .prepare(
          `SELECT e.id, e.robot_id, r.name AS robot_name, r.chip_address, e.item, e.invoice_id, e.state, e.result,
             e.decision_count,
             e.request_ids_hash, e.state_changed_at, e.created_at
           FROM episodes e JOIN robots r ON r.id = e.robot_id WHERE e.id = ? AND e.account_id = ?`,
        )
        .bind(id, session.accountId),
      EpisodeAuditRow,
    )
    if (Option.isNone(episode)) return yield* jsonError(404, 'unknown episode')
    const rows = { episode: episode.value, ...(yield* readRows(deps, id)) }
    const invoice =
      episode.value.invoice_id === null
        ? Option.none()
        : yield* firstRow(
            deps.database
              .prepare(
                `SELECT id, merchant_id, item_id, pay_to, amount, restricted, status, paid_tx, invoice_hash, expires_at,
                   created_at FROM invoices WHERE id = ?`,
              )
              .bind(episode.value.invoice_id),
            InvoiceAuditRow,
          )
    return yield* json(auditView(rows, Option.getOrNull(invoice)))
  })

type AuditRows = Parameters<typeof timelineOf>[0] & { readonly observations: ReadonlyArray<ObservationView> }

const auditView = (rows: AuditRows, invoice: typeof InvoiceAuditRow.Type | null) => {
  const { episode } = rows
  return {
    episode: {
      id: episode.id,
      robotId: episode.robot_id,
      robotName: episode.robot_name,
      chipAddress: episode.chip_address,
      item: episode.item,
      state: episode.state,
      result: episode.result,
      requestIdsHash: episode.request_ids_hash,
      createdAt: episode.created_at,
      endedAt: endedAt(episode),
    },
    invoice: invoice === null ? null : { ...invoice, restricted: invoice.restricted === 1 },
    decisions: rows.decisions,
    chipRequests: rows.chipRequests,
    payments: rows.payments,
    approvals: rows.approvals.map(({ amr_json, ...approval }) => ({ ...approval, world: worldClaims(amr_json) })),
    evidence: rows.evidence,
    observations: rows.observations,
    timeline: timelineOf(rows),
  }
}

/** The audit view (owner-scoped, read-only); verify and replay are M+R's POST routes on the same paths. */
export const episodesRoutes = (deps: WalletDeps) =>
  Layer.mergeAll(
    HttpRouter.add('GET', '/api/wallet/episodes', requireSession(listEpisodes(deps))),
    HttpRouter.add('GET', '/api/wallet/episodes/:id', requireSession(readEpisodeAudit(deps))),
  )
