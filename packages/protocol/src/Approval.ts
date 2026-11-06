import { Schema } from 'effect'
import { hashTypedData, type StructType } from './Eip712.ts'
import { Address, Bytes32, EcdsaSignature, type Hex, UintString, UnixSeconds } from './Hex.ts'
import { ARC_CHAIN_ID } from './Invoice.ts'

// The approver's signature over one over-limit or restricted payment. Verified on Arc by RobotPaymentPolicyEnforcer
// (`contracts/studio/contracts/RobotPaymentPolicyEnforcer.sol`), whose address is the domain's verifyingContract.
export const APPROVAL_TYPE: StructType = {
  name: 'Approval',
  fields: [
    { name: 'invoiceHash', type: 'bytes32' },
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
    { name: 'nonce', type: 'bytes32' },
  ],
}

export const approvalDomain = (enforcer: Hex) =>
  ({ name: 'VitaquackApproval', version: '1', chainId: ARC_CHAIN_ID, verifyingContract: enforcer }) as const

export const Approval = Schema.Struct({
  invoiceHash: Bytes32,
  payee: Address,
  amount: UintString,
  expiry: UnixSeconds,
  nonce: Bytes32,
})
export type Approval = typeof Approval.Type

export const SignedApproval = Schema.Struct({ ...Approval.fields, signature: EcdsaSignature })
export type SignedApproval = typeof SignedApproval.Type

/** The digest the approver signs (`sign({ hash })`) and the enforcer recovers. */
export const approvalDigest = (enforcer: Hex, approval: Approval): Hex =>
  hashTypedData(approvalDomain(enforcer), APPROVAL_TYPE, {
    invoiceHash: approval.invoiceHash,
    payee: approval.payee,
    amount: BigInt(approval.amount),
    expiry: BigInt(approval.expiry),
    nonce: approval.nonce,
  })

/**
 * The approval's nonce (§9): the EIP-712 digest of the same struct with the invoice hash as its nonce. It doubles as the
 * World OIDC `nonce`, so the human's World ID token is bound to exactly this invoice, payee, amount and expiry.
 */
export const approvalNonce = (enforcer: Hex, approval: Omit<Approval, 'nonce'>): Hex =>
  approvalDigest(enforcer, { ...approval, nonce: approval.invoiceHash })
