import type { Bindings } from './Respond.ts'

// What a release has bound, as booleans only (never a value): `GET /api/health` reports it so anyone can see at a
// glance which features answer and which still say 503 "not configured". A binding counts when it is well-formed and
// not the `pending` placeholder (spec §10).
const set = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value !== 'pending'
const shaped = (pattern: RegExp) => (value: unknown) => set(value) && pattern.test(value)
const key = shaped(/^0x[0-9a-f]{64}$/)
const address = shaped(/^0x[0-9a-fA-F]{40}$/)
const https = shaped(/^https:\/\/\S+$/)
const longer = (length: number) => (value: unknown) => set(value) && value.length >= length

/** Scan-initiated errands (`SCANS_ENABLED`): on only for the exact string `true`; `pending` or anything else is off. */
export const scansEnabled = (env: Bindings) => env.SCANS_ENABLED === 'true'

/** The robot's live camera view (`LIVE_ENABLED`): on only for the exact string `true`, like scans. */
export const liveEnabled = (env: Bindings) => env.LIVE_ENABLED === 'true'

export const features = (env: Bindings) => ({
  arc: https(env.ARC_RPC_URL),
  relayer: key(env.RELAYER_PRIVATE_KEY),
  approver: key(env.APPROVER_PRIVATE_KEY),
  enforcer: address(env.ENFORCER_ADDRESS),
  zg: shaped(/^https?:\/\/\S+$/)(env.ZG_BASE_URL) && longer(8)(env.ZG_API_KEY) && set(env.ZG_MODEL),
  world: set(env.WORLD_CLIENT_ID) && set(env.WORLD_CLIENT_SECRET) && https(env.WORLD_ISSUER),
  merchant: address(env.MERCHANT_PAY_TO) && address(env.RESTRICTED_PAY_TO),
  gate: shaped(/^(0x)?[0-9a-fA-F]{64}$/)(env.GATE_ED25519_SEED),
  evidence: longer(16)(env.EVIDENCE_TOKEN),
  scans: scansEnabled(env),
  live: liveEnabled(env),
  telegram:
    shaped(/^\d{5,}:[A-Za-z0-9_-]{30,}$/)(env.TELEGRAM_BOT_TOKEN) &&
    shaped(/^[A-Za-z0-9_-]{16,256}$/)(env.TELEGRAM_WEBHOOK_SECRET),
})
export type Features = ReturnType<typeof features>
