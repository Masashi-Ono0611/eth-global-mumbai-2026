import { TerminalEpisodeState } from '@ethmumbai/protocol/Errand'
import { Option, Schema } from 'effect'

/**
 * The audit view's rows (one errand and everything it touched) and the timeline built from their timestamps. Columns
 * mix units: `created_at` is milliseconds everywhere; `state_changed_at`, `delivered_at`, `responded_at`, `settled_at`,
 * `decided_at` and `uploaded_at` are seconds. The timeline is in milliseconds.
 */

const Text = Schema.NullOr(Schema.String)
const Time = Schema.NullOr(Schema.Finite)

export const EpisodeAuditRow = Schema.Struct({
  id: Schema.String,
  robot_id: Schema.String,
  robot_name: Schema.String,
  item: Schema.String,
  invoice_id: Text,
  state: Schema.String,
  result: Text,
  decision_count: Time,
  request_ids_hash: Text,
  state_changed_at: Time,
  created_at: Schema.Finite,
})
export const InvoiceAuditRow = Schema.Struct({
  id: Schema.String,
  merchant_id: Text,
  item_id: Text,
  pay_to: Text,
  amount: Text,
  restricted: Time,
  status: Schema.String,
  paid_tx: Text,
  invoice_hash: Schema.String,
  expires_at: Time,
  created_at: Schema.Finite,
})
export const DecisionAuditRow = Schema.Struct({
  id: Schema.String,
  step: Time,
  model: Text,
  request_id: Text,
  chat_id: Text,
  provider: Text,
  latency_ms: Time,
  prompt_sha256: Text,
  input_json: Text,
  action: Schema.String,
  reason: Text,
  outcome: Text,
  outcome_ref: Text,
  error: Text,
  created_at: Schema.Finite,
})
export const ChipAuditRow = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  status: Schema.String,
  refusal_code: Text,
  leaf_hash: Text,
  expires_at: Time,
  delivered_at: Time,
  responded_at: Time,
  created_at: Schema.Finite,
})
export const PaymentAuditRow = Schema.Struct({
  invoice_id: Text,
  status: Schema.String,
  tx_hash: Text,
  gas_used: Text,
  fail_reason: Text,
  payer: Text,
  approval_id: Text,
  settled_at: Time,
  created_at: Schema.Finite,
})
export const ApprovalAuditRow = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  error: Text,
  amount: Text,
  payee: Text,
  auth_time: Time,
  amr_json: Text,
  decided_at: Time,
  created_at: Schema.Finite,
})
export const EvidenceAuditRow = Schema.Struct({
  status: Schema.String,
  root_hash: Text,
  storage_tx: Text,
  log_tx: Text,
  request_ids_hash: Text,
  attempts: Time,
  error: Text,
  uploaded_at: Time,
  created_at: Schema.Finite,
})

const StoredClaims = Schema.Union([
  Schema.Struct({ acr: Schema.NullOr(Schema.String), amr: Schema.Array(Schema.String) }),
  Schema.Array(Schema.String),
])
const decodeClaims = Schema.decodeUnknownOption(Schema.fromJsonString(StoredClaims))

/**
 * What World asserted about the approving sign-in, from `approvals.amr_json`: `{acr, amr}` since 95a92bd, a bare `amr`
 * array before it. Assurance class and methods only; the token, `jti` and `sub` never leave D1.
 */
export const worldClaims = (amrJson: string | null) =>
  amrJson === null
    ? null
    : Option.match(decodeClaims(amrJson), {
        onNone: () => null,
        onSome: (claims) => ('acr' in claims ? { acr: claims.acr, amr: claims.amr } : { acr: null, amr: claims }),
      })

export const isEnded = (state: string) => TerminalEpisodeState.literals.some((terminal) => terminal === state)

/** When the errand reached its terminal state (milliseconds), null while it runs. */
export const endedAt = (episode: { readonly state: string; readonly state_changed_at: number | null }) =>
  isEnded(episode.state) && episode.state_changed_at !== null ? episode.state_changed_at * 1000 : null

export type TimelineKind =
  | 'errand_started'
  | 'decision'
  | 'chip_requested'
  | 'chip_delivered'
  | 'chip_signed'
  | 'chip_refused'
  | 'payment_submitted'
  | 'payment_settled'
  | 'approval_requested'
  | 'approval_answered'
  | 'evidence_uploaded'
  | 'state'

export interface TimelineEvent {
  readonly at: number
  readonly kind: TimelineKind
  readonly detail: string | null
}

export interface EpisodeRows {
  readonly episode: typeof EpisodeAuditRow.Type
  readonly decisions: ReadonlyArray<typeof DecisionAuditRow.Type>
  readonly chipRequests: ReadonlyArray<typeof ChipAuditRow.Type>
  readonly payments: ReadonlyArray<typeof PaymentAuditRow.Type>
  readonly approvals: ReadonlyArray<typeof ApprovalAuditRow.Type>
  readonly evidence: typeof EvidenceAuditRow.Type | null
}

const event = (at: number | null, kind: TimelineKind, detail: string | null = null): ReadonlyArray<TimelineEvent> =>
  at === null ? [] : [{ at, kind, detail }]
const seconds = (value: number | null) => (value === null ? null : value * 1000)

const chipEvents = (row: typeof ChipAuditRow.Type) => [
  ...event(row.created_at, 'chip_requested', row.kind),
  ...event(seconds(row.delivered_at), 'chip_delivered'),
  ...(row.status === 'refused'
    ? event(seconds(row.responded_at), 'chip_refused', row.refusal_code)
    : event(seconds(row.responded_at), 'chip_signed')),
]

/**
 * Every recorded moment of the errand in time order. Half the columns only have whole seconds, so events are ordered
 * by their second and, within one second, in the errand's own order (started, decided, chip, payment, approval,
 * evidence, state). Only the latest state change has a time (`episodes.state_changed_at`).
 */
export const timelineOf = (rows: EpisodeRows): ReadonlyArray<TimelineEvent> =>
  causalOrder(rows)
    .map((entry, index) => ({ entry, index }))
    .toSorted(
      (left, right) => Math.floor(left.entry.at / 1000) - Math.floor(right.entry.at / 1000) || left.index - right.index,
    )
    .map(({ entry }) => entry)

const causalOrder = (rows: EpisodeRows): ReadonlyArray<TimelineEvent> => [
  ...event(rows.episode.created_at, 'errand_started', rows.episode.item),
  ...rows.decisions.flatMap((row) => event(row.created_at, 'decision', row.action)),
  ...rows.chipRequests.flatMap(chipEvents),
  ...rows.payments.flatMap((row) => [
    ...event(row.created_at, 'payment_submitted'),
    ...event(seconds(row.settled_at), 'payment_settled', row.tx_hash),
  ]),
  ...rows.approvals.flatMap((row) => [
    ...event(row.created_at, 'approval_requested'),
    ...event(seconds(row.decided_at), 'approval_answered', row.status),
  ]),
  ...event(seconds(rows.evidence?.uploaded_at ?? null), 'evidence_uploaded', rows.evidence?.root_hash ?? null),
  ...event(seconds(rows.episode.state_changed_at), 'state', rows.episode.state),
]
