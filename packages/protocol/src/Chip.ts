import { Schema } from 'effect'
import { Id } from './Base32.ts'
import { SignedApproval } from './Approval.ts'
import { Delegation, UnsignedDelegation } from './Delegation.ts'
import { Address, Bytes32, EcdsaSignature, UintString, UnixSeconds } from './Hex.ts'
import { ARC_CHAIN_ID, Invoice } from './Invoice.ts'

// The chip protocol (§8): HTTPS long-polling between the Worker and the chip (mock chip on a laptop, later the Radxa).
export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const PAIRING_TTL_SECONDS = 600
export const POLL_HOLD_MS = 25_000
export const LEASE_MS = 35_000

export const PairingCode = Schema.String.check(Schema.isPattern(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/))

/** The EIP-191 message the chip `personal_sign`s to pair. */
export const pairMessage = (code: string, address: string) =>
  `Vitaquack pair ${code} ${address.toLowerCase()} ${ARC_CHAIN_ID}`

export const PairRequest = Schema.Struct({ pairingCode: PairingCode, address: Address, sig: EcdsaSignature })
export type PairRequest = typeof PairRequest.Type
export const PairResponse = Schema.Struct({ robotId: Id, chipToken: Schema.String, serverTime: Schema.Finite })
export type PairResponse = typeof PairResponse.Type

export const ChipGrant = Schema.Struct({
  delegation: Delegation,
  dailyCap: UintString,
  perPaymentCap: UintString,
  allowlist: Schema.Array(Address),
  expiresAt: UnixSeconds,
})
export type ChipGrant = typeof ChipGrant.Type

export const SignRequest = Schema.Struct({
  id: Id,
  kind: Schema.Literal('sign-invoice'),
  expiresAt: UnixSeconds,
  invoice: Invoice,
  grant: ChipGrant,
  approval: Schema.NullOr(SignedApproval),
  leaf: UnsignedDelegation,
  chainId: Schema.Literal(ARC_CHAIN_ID),
  delegationManager: Address,
})
export type SignRequest = typeof SignRequest.Type

export const PollResponse = Schema.Struct({
  serverTime: Schema.Finite,
  lease: Schema.Struct({ until: Schema.Finite }),
  requests: Schema.Array(SignRequest),
})
export type PollResponse = typeof PollResponse.Type

export const RefusalCode = Schema.Literals([
  'wrong_network',
  'wrong_asset',
  'over_per_payment_cap',
  'over_daily_cap',
  'payee_not_allowed',
  'bad_invoice_origin',
  'invoice_expired',
  'expiry_too_far',
  'replayed_invoice',
  'leaf_mismatch',
  'no_grant',
  'no_lease',
])
export type RefusalCode = typeof RefusalCode.Type

export const ChipSigned = Schema.Struct({
  requestId: Id,
  ok: Schema.Literal(true),
  signature: EcdsaSignature,
  leafHash: Bytes32,
})
export const ChipRefused = Schema.Struct({
  requestId: Id,
  ok: Schema.Literal(false),
  refused: Schema.Struct({ code: RefusalCode, detail: Schema.String.check(Schema.isMaxLength(200)) }),
})
export const ChipResponse = Schema.Union([ChipSigned, ChipRefused])
export type ChipResponse = typeof ChipResponse.Type

export const ChipResponseAck = Schema.Struct({
  accepted: Schema.Literal(true),
  payment: Schema.Struct({
    status: Schema.Literals(['settled', 'failed']),
    txHash: Schema.optionalKey(Bytes32),
    reason: Schema.optionalKey(Schema.String),
  }),
})
export type ChipResponseAck = typeof ChipResponseAck.Type
