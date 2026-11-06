import { Schema } from 'effect'
import { Id } from './Base32.ts'
import { Address, Bytes32, HexBytes, UintString, UnixSeconds } from './Hex.ts'
import { ARC_NETWORK } from './Invoice.ts'

// x402 v2, scheme `exact`, asset transfer method ERC-7710 (a delegation redeemed by our facilitator), §7.
export const X402_VERSION = 2
export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED'
export const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE'

export const PaymentRequirements = Schema.Struct({
  scheme: Schema.Literal('exact'),
  network: Schema.Literal(ARC_NETWORK),
  asset: Address,
  payTo: Address,
  amount: UintString,
  maxTimeoutSeconds: Schema.Finite,
  extra: Schema.Struct({
    assetTransferMethod: Schema.Literal('erc7710'),
    invoiceHash: Bytes32,
    invoiceId: Id,
    expiresAt: UnixSeconds,
    delegationManager: Address,
    facilitators: Schema.Array(Address),
    paymentIdentifier: Id,
  }),
})
export type PaymentRequirements = typeof PaymentRequirements.Type

export const PaymentRequired = Schema.Struct({
  x402Version: Schema.Literal(X402_VERSION),
  error: Schema.Literal('payment-required'),
  resource: Schema.Struct({ url: Schema.String, description: Schema.String, mimeType: Schema.String }),
  accepts: Schema.Array(PaymentRequirements),
})
export type PaymentRequired = typeof PaymentRequired.Type

export const Erc7710Payload = Schema.Struct({
  delegationManager: Address,
  /** `encodeDelegations([leaf, grantWithArgs])`, leaf first. */
  permissionContext: HexBytes,
  /** The owner smart account (the root delegator). */
  delegator: Address,
})
export type Erc7710Payload = typeof Erc7710Payload.Type

export const PaymentPayload = Schema.Struct({
  x402Version: Schema.Literal(X402_VERSION),
  accepted: PaymentRequirements,
  payload: Erc7710Payload,
})
export type PaymentPayload = typeof PaymentPayload.Type

export const PayRequest = Schema.Struct({ paymentPayload: PaymentPayload })
export type PayRequest = typeof PayRequest.Type

export const Check = Schema.Struct({
  name: Schema.String,
  ok: Schema.Boolean,
  detail: Schema.optionalKey(Schema.String),
})
export type Check = typeof Check.Type

export const SettleSuccess = Schema.Struct({
  success: Schema.Literal(true),
  transaction: Bytes32,
  network: Schema.Literal(ARC_NETWORK),
  payer: Address,
  invoiceId: Id,
  status: Schema.Literal('paid'),
})
export type SettleSuccess = typeof SettleSuccess.Type

export const SettleFailure = Schema.Struct({
  success: Schema.Literal(false),
  errorReason: Schema.String,
  checks: Schema.Array(Check),
})
export type SettleFailure = typeof SettleFailure.Type
