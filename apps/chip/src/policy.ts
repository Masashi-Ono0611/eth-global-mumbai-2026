import { approvalDigest, type SignedApproval } from '@ethmumbai/protocol/Approval'
import type { RefusalCode, SignRequest } from '@ethmumbai/protocol/Chip'
import {
  ARC_DELEGATION_MANAGER,
  buildLeaf,
  delegationHash,
  sameDelegation,
  type UnsignedDelegation,
} from '@ethmumbai/protocol/Delegation'
import { bytesToHex, type Hex, hexToBytes, isHex } from '@ethmumbai/protocol/Hex'
import { ARC_CHAIN_ID, ARC_USDC, invoiceHash } from '@ethmumbai/protocol/Invoice'
import { Predicate } from 'effect'

/** Everything the policy needs besides the request: the chip's own facts, never the server's. */
export interface PolicyContext {
  readonly chip: Hex
  /** The origin the chip paired with; every invoice must live under it. */
  readonly allowedOrigin: string
  readonly nowSeconds: number
  readonly usedInvoiceHashes: ReadonlySet<string>
  /** USDC base units this chip signed today. */
  readonly spentToday: bigint
  /** The address that signed the attached approval's digest, recovered before the policy runs. */
  readonly approvalSigner: Hex | undefined
}

export type Refusal = { readonly ok: false; readonly code: RefusalCode; readonly detail: string }
export type PolicyResult = { readonly ok: true; readonly leaf: UnsignedDelegation; readonly amount: bigint } | Refusal

/** Invoices may not be signed more than 15 minutes ahead of their expiry. */
const MAX_INVOICE_TTL_SECONDS = 900

const refuse = (code: RefusalCode, detail: string): Refusal => ({ ok: false, code, detail })
const sameHex = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

const word = (bytes: Uint8Array, index: number) => bytes.slice(index * 32, index * 32 + 32)
const wordUint = (bytes: Uint8Array, index: number) => BigInt(bytesToHex(word(bytes, index)))
const wordAddress = (bytes: Uint8Array, index: number) => bytesToHex(word(bytes, index).slice(12))

/** The limits the owner signed, read from the grant's caveat terms rather than the server's mirror fields. */
interface GrantTerms {
  readonly dailyCap: bigint
  readonly expiresAt: number
  readonly perPaymentCap: bigint
  readonly allowlist: ReadonlyArray<Hex>
  /** The approver and `RobotPaymentPolicyEnforcer` (the approval domain's verifying contract); absent on a grant
   * made of stock enforcers only, which can never carry an approval. */
  readonly approval: { readonly approver: Hex; readonly enforcer: Hex } | undefined
}

/** Without our policy caveat nothing on-chain caps one payment, so the chip never signs more than this by itself. */
const STOCK_GRANT_MAX_PAYMENT = 2_000_000n

const policyTermsOf = (terms: Uint8Array) => {
  if (terms.length < 128) return undefined
  const offset = Number(wordUint(terms, 1)) / 32
  const count = Number(wordUint(terms, offset))
  if (!Number.isInteger(offset) || terms.length < (offset + 1 + count) * 32) return undefined
  return {
    perPaymentCap: wordUint(terms, 0),
    allowlist: Array.from({ length: count }, (_, index) => wordAddress(terms, offset + 1 + index)),
    approver: wordAddress(terms, 2),
  }
}

/**
 * Caveat order (spec §5): ValueLte · ERC20PeriodTransfer(USDC ‖ dailyCap ‖ period ‖ start) · Timestamp(0 ‖ expiresAt)
 * · RobotPaymentPolicyEnforcer(abi.encode(perPaymentCap, address[] allowlist, approver)). A grant of the three stock
 * caveats only (before the enforcer is deployed) takes the per-payment cap and allowlist from the request, bounded
 * by {@link STOCK_GRANT_MAX_PAYMENT}.
 */
const grantTerms = (request: SignRequest): GrantTerms | undefined => {
  const [, period, timestamp, policy] = request.grant.delegation.caveats
  if (period === undefined || timestamp === undefined) return undefined
  const periodTerms = hexToBytes(period.terms)
  const timestampTerms = hexToBytes(timestamp.terms)
  if (periodTerms.length !== 116 || timestampTerms.length !== 32) return undefined
  if (!sameHex(bytesToHex(periodTerms.slice(0, 20)), ARC_USDC)) return undefined
  const signed = {
    dailyCap: BigInt(bytesToHex(periodTerms.slice(20, 52))),
    expiresAt: Number(BigInt(bytesToHex(timestampTerms.slice(16, 32)))),
  }
  if (policy === undefined) {
    const mirrored = BigInt(request.grant.perPaymentCap)
    return {
      ...signed,
      perPaymentCap: mirrored < STOCK_GRANT_MAX_PAYMENT ? mirrored : STOCK_GRANT_MAX_PAYMENT,
      allowlist: request.grant.allowlist,
      approval: undefined,
    }
  }
  const decoded = policyTermsOf(hexToBytes(policy.terms))
  if (decoded === undefined) return undefined
  const { perPaymentCap, allowlist, approver } = decoded
  return { ...signed, perPaymentCap, allowlist, approval: { approver, enforcer: policy.enforcer } }
}

/** An approval counts only for this exact invoice, payee and amount, before its expiry, signed by the grant's approver. */
const approvalValid = (
  approval: SignedApproval | null,
  request: SignRequest,
  terms: GrantTerms,
  context: PolicyContext,
) =>
  approval !== null &&
  sameHex(approval.invoiceHash, request.invoice.invoiceHash) &&
  sameHex(approval.payee, request.invoice.payTo) &&
  approval.amount === request.invoice.amount &&
  approval.expiry > context.nowSeconds &&
  context.approvalSigner !== undefined &&
  terms.approval !== undefined &&
  sameHex(context.approvalSigner, terms.approval.approver)

/** The digest whose signer `context.approvalSigner` must be (recovered by the caller with viem). */
export const approvalDigestFor = (request: SignRequest): Hex | undefined => {
  const enforcer = grantTerms(request)?.approval?.enforcer
  return enforcer === undefined || request.approval === null ? undefined : approvalDigest(enforcer, request.approval)
}

const checkGrant = (request: SignRequest, context: PolicyContext) => {
  const terms = grantTerms(request)
  if (terms === undefined) return refuse('no_grant', 'grant caveats are not the Vitaquack grant')
  if (!sameHex(request.grant.delegation.delegate, context.chip))
    return refuse('no_grant', 'grant is not addressed to this chip')
  if (terms.expiresAt <= context.nowSeconds) return refuse('no_grant', 'grant expired')
  return terms
}

const checkMoney = (request: SignRequest, terms: GrantTerms, context: PolicyContext) => {
  const { invoice } = request
  if (request.chainId !== ARC_CHAIN_ID || !sameHex(request.delegationManager, ARC_DELEGATION_MANAGER))
    return refuse('wrong_network', `chain ${request.chainId}`)
  if (!sameHex(invoice.asset, ARC_USDC)) return refuse('wrong_asset', invoice.asset)
  const amount = BigInt(invoice.amount)
  const approved = approvalValid(request.approval, request, terms, context)
  if (amount <= 0n) return refuse('over_per_payment_cap', 'amount must be positive')
  if (!approved && amount > terms.perPaymentCap)
    return refuse('over_per_payment_cap', `${amount} > ${terms.perPaymentCap}`)
  // Arc's period enforcer caps the day even with an approval, so the chip never signs past it.
  if (amount > terms.dailyCap - context.spentToday)
    return refuse('over_daily_cap', `${amount} > ${terms.dailyCap - context.spentToday} left today`)
  if (!approved && !terms.allowlist.some((payee) => sameHex(payee, invoice.payTo)))
    return refuse('payee_not_allowed', invoice.payTo)
  return amount
}

const checkInvoice = (request: SignRequest, context: PolicyContext) => {
  const { invoice } = request
  if (invoice.url !== `${context.allowedOrigin}/api/i/${invoice.id}`) return refuse('bad_invoice_origin', invoice.url)
  if (invoice.expiresAt <= context.nowSeconds) return refuse('invoice_expired', `${invoice.expiresAt}`)
  if (invoice.expiresAt > context.nowSeconds + MAX_INVOICE_TTL_SECONDS)
    return refuse('expiry_too_far', `${invoice.expiresAt}`)
  if (context.usedInvoiceHashes.has(invoice.invoiceHash.toLowerCase()))
    return refuse('replayed_invoice', invoice.invoiceHash)
  return undefined
}

/** Re-derive the leaf from the invoice and the grant; sign only that, never the server's copy as such. */
const deriveLeaf = (request: SignRequest, context: PolicyContext, amount: bigint) => {
  const { invoice, leaf } = request
  if (!sameHex(invoiceHash(invoice), invoice.invoiceHash)) return refuse('leaf_mismatch', 'invoice hash does not match')
  const relayer = leaf.caveats[3]?.terms
  if (relayer === undefined || !isHex(relayer) || hexToBytes(relayer).length !== 20)
    return refuse('leaf_mismatch', 'redeemer caveat is not one address')
  const derived = buildLeaf({
    chip: context.chip,
    grantHash: delegationHash(request.grant.delegation),
    relayer,
    invoiceHash: invoice.invoiceHash,
    payTo: invoice.payTo,
    amount,
    expiresAt: invoice.expiresAt,
  })
  return sameDelegation(derived, leaf) ? derived : refuse('leaf_mismatch', 'leaf caveats differ from the invoice')
}

const isRefusal = (value: unknown): value is Refusal => Predicate.hasProperty(value, 'ok') && value.ok === false

/** Without a live lease the chip answers every request `no_lease` (its motors are already stopped). */
export const checkLease = (nowMillis: number, leaseUntilMillis: number): Refusal | undefined =>
  nowMillis > leaseUntilMillis ? refuse('no_lease', 'lease expired') : undefined

/** Spec §8, in order, before the key is touched. */
export const evaluate = (request: SignRequest, context: PolicyContext): PolicyResult => {
  const terms = checkGrant(request, context)
  if (isRefusal(terms)) return terms
  const amount = checkMoney(request, terms, context)
  if (isRefusal(amount)) return amount
  const invoiceRefusal = checkInvoice(request, context)
  if (invoiceRefusal !== undefined) return invoiceRefusal
  const leaf = deriveLeaf(request, context, amount)
  return isRefusal(leaf) ? leaf : { ok: true, leaf, amount }
}
