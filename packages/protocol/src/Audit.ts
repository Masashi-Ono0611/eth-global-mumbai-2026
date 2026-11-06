import { Schema } from 'effect'

/**
 * One stored 0G decision as the audit view returns it (`GET /api/wallet/episodes/:id`, the `decisions` table): the
 * exact structured input, the prompt hash, the brain and its request id, and what the errand made of the answer.
 */
export const AuditDecision = Schema.Struct({
  id: Schema.String,
  step: Schema.NullOr(Schema.Finite),
  model: Schema.NullOr(Schema.String),
  request_id: Schema.NullOr(Schema.String),
  chat_id: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  latency_ms: Schema.NullOr(Schema.Finite),
  prompt_sha256: Schema.NullOr(Schema.String),
  input_json: Schema.NullOr(Schema.String),
  action: Schema.String,
  reason: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(Schema.String),
  outcome_ref: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  created_at: Schema.Finite,
})
export type AuditDecision = typeof AuditDecision.Type
