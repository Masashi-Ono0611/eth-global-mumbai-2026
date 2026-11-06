import type { SignedApproval } from '@ethmumbai/protocol/Approval'
import type { SignRequest } from '@ethmumbai/protocol/Chip'
import { ARC_DELEGATION_MANAGER, buildLeaf, delegationHash, ROOT_AUTHORITY } from '@ethmumbai/protocol/Delegation'
import { bytesToHex, concatBytes, type Hex, hexToBytes, uintToBytes } from '@ethmumbai/protocol/Hex'
import { ARC_USDC, invoiceHash, jsonHash } from '@ethmumbai/protocol/Invoice'
import { encodeAbiParameters, recoverAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'
import { approvalDigestFor, checkLease, evaluate, type PolicyContext } from '../src/policy.ts'

// Test-only keys: never funded, never used on any chain.
const chip = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const approver = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const stranger = privateKeyToAccount(`0x${'33'.repeat(32)}`)
const owner: Hex = '0x00000000000000000000000000000000000000aa'
const merchant: Hex = '0x000000000000000000000000000000000000c0de'
const restricted: Hex = '0x000000000000000000000000000000000000dead'
const relayer: Hex = '0x00000000000000000000000000000000000beef1'
const enforcer: Hex = '0x00000000000000000000000000000000000e0f0e'
const origin = 'https://app.example'
const now = 1_762_400_000
const word = (value: bigint) => uintToBytes(value, 32)

const grant = (chipAddress: Hex = chip.address) => ({
  delegate: chipAddress,
  delegator: owner,
  authority: ROOT_AUTHORITY,
  caveats: [
    {
      enforcer: '0x92Bf12322527cAA612fd31a0e810472BBB106A8F' as const,
      terms: bytesToHex(word(0n)),
      args: '0x' as const,
    },
    {
      enforcer: '0x474e3Ae7E169e940607cC624Da8A15Eb120139aB' as const,
      terms: bytesToHex(concatBytes(hexToBytes(ARC_USDC), word(1_000_000n), word(86_400n), word(BigInt(now - 60)))),
      args: '0x' as const,
    },
    {
      enforcer: '0x1046bb45C8d673d4ea75321280DB34899413c069' as const,
      terms: bytesToHex(concatBytes(uintToBytes(0n, 16), uintToBytes(BigInt(now + 86_400), 16))),
      args: '0x' as const,
    },
    {
      enforcer,
      terms: encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'address[]' }, { type: 'address' }],
        [300_000n, [merchant], approver.address],
      ),
      args: '0x' as const,
    },
  ],
  salt: '7',
  signature: '0x' as const,
})

const invoiceFor = (payTo: Hex, amount: string, expiresAt = now + 600) => {
  const id = 'abcdefghijklmnopqrstuvwxya'
  const fields = {
    id,
    url: `${origin}/api/i/${id}`,
    merchantId: 'duck-cafe',
    payTo,
    asset: ARC_USDC,
    amount,
    expiresAt,
    linesHash: jsonHash([{ sku: 'chai', name: 'Chai', qty: 1, unitAmount: amount }]),
    rulesHash: jsonHash([]),
    restricted: payTo === restricted,
  }
  return { ...fields, invoiceHash: invoiceHash(fields) }
}

const requestFor = (invoice: ReturnType<typeof invoiceFor>, approval: SignedApproval | null = null): SignRequest => {
  const delegation = grant()
  return {
    id: 'zyxwvutsrqponmlkjihgfedcba',
    kind: 'sign-invoice',
    expiresAt: now + 60,
    invoice,
    grant: { delegation, dailyCap: '1000000', perPaymentCap: '300000', allowlist: [merchant], expiresAt: now + 86_400 },
    approval,
    leaf: buildLeaf({
      chip: chip.address,
      grantHash: delegationHash(delegation),
      relayer,
      invoiceHash: invoice.invoiceHash,
      payTo: invoice.payTo,
      amount: BigInt(invoice.amount),
      expiresAt: invoice.expiresAt,
    }),
    chainId: 5042,
    delegationManager: ARC_DELEGATION_MANAGER,
  }
}

const context = (overrides: Partial<PolicyContext> = {}): PolicyContext => ({
  chip: chip.address,
  allowedOrigin: origin,
  nowSeconds: now,
  usedInvoiceHashes: new Set(),
  spentToday: 0n,
  approvalSigner: undefined,
  ...overrides,
})

const approve = async (request: SignRequest, signer = approver) => {
  const unsigned = {
    invoiceHash: request.invoice.invoiceHash,
    payee: request.invoice.payTo,
    amount: request.invoice.amount,
    expiry: now + 300,
    nonce: request.invoice.invoiceHash,
  }
  const draft = { ...request, approval: { ...unsigned, signature: `0x${'00'.repeat(65)}` as const } }
  const digest = approvalDigestFor(draft)
  if (digest === undefined) throw new Error('no approval digest')
  const signature = await signer.sign({ hash: digest })
  const withApproval = { ...request, approval: { ...unsigned, signature } }
  return { request: withApproval, approvalSigner: await recoverAddress({ hash: digest, signature }) }
}

const codeOf = (request: SignRequest, overrides: Partial<PolicyContext> = {}) => {
  const verdict = evaluate(request, context(overrides))
  return verdict.ok ? 'ok' : verdict.code
}

describe('chip policy (spec §8)', () => {
  it('accepts a grant of the three stock caveats, capped by the request and the chip’s own maximum', () => {
    const request = requestFor(invoiceFor(merchant, '100000'))
    const stock = { ...request.grant.delegation, caveats: request.grant.delegation.caveats.slice(0, 3) }
    const stockRequest = { ...request, grant: { ...request.grant, delegation: stock } }
    const leaf = buildLeaf({
      chip: chip.address,
      grantHash: delegationHash(stock),
      relayer,
      invoiceHash: request.invoice.invoiceHash,
      payTo: merchant,
      amount: 100_000n,
      expiresAt: request.invoice.expiresAt,
    })
    expect(codeOf({ ...stockRequest, leaf })).toBe('ok')
    expect(codeOf(requestFor(invoiceFor(merchant, '500000')))).toBe('over_per_payment_cap')
    const big = requestFor(invoiceFor(merchant, '2500000'))
    const bigStock = { ...big.grant.delegation, caveats: big.grant.delegation.caveats.slice(0, 3) }
    // A request claiming a 9 USDC per-payment cap is still held to the chip's own 2 USDC maximum.
    const generous = { ...big, grant: { ...big.grant, delegation: bigStock, perPaymentCap: '9000000' } }
    expect(codeOf(generous)).toBe('over_per_payment_cap')
  })

  it('signs a within-limits invoice and re-derives exactly the leaf it was sent', () => {
    const request = requestFor(invoiceFor(merchant, '100000'))
    const verdict = evaluate(request, context())
    expect(verdict).toEqual({ ok: true, leaf: request.leaf, amount: 100_000n })
  })

  it('refuses a grant that is not this chip’s, not ours, or expired: no_grant', () => {
    const request = requestFor(invoiceFor(merchant, '100000'))
    expect(codeOf({ ...request, grant: { ...request.grant, delegation: grant(stranger.address) } })).toBe('no_grant')
    expect(codeOf({ ...request, grant: { ...request.grant, delegation: { ...grant(), caveats: [] } } })).toBe(
      'no_grant',
    )
    expect(codeOf(request, { nowSeconds: now + 86_401 })).toBe('no_grant')
  })

  it('refuses another DelegationManager and another asset', () => {
    const request = requestFor(invoiceFor(merchant, '100000'))
    expect(codeOf({ ...request, delegationManager: owner })).toBe('wrong_network')
    expect(codeOf({ ...request, invoice: { ...request.invoice, asset: owner } })).toBe('wrong_asset')
  })

  it('caps one payment and the day; only a valid approval lifts the per-payment cap', async () => {
    const over = requestFor(invoiceFor(merchant, '500000'))
    expect(codeOf(over)).toBe('over_per_payment_cap')
    expect(codeOf(requestFor(invoiceFor(merchant, '0')))).toBe('over_per_payment_cap')
    expect(codeOf(requestFor(invoiceFor(merchant, '100000')), { spentToday: 950_000n })).toBe('over_daily_cap')
    const approved = await approve(over)
    expect(codeOf(approved.request, { approvalSigner: approved.approvalSigner })).toBe('ok')
    expect(codeOf(approved.request, { approvalSigner: approved.approvalSigner, spentToday: 600_000n })).toBe(
      'over_daily_cap',
    )
    const forged = await approve(over, stranger)
    expect(codeOf(forged.request, { approvalSigner: forged.approvalSigner })).toBe('over_per_payment_cap')
  })

  it('refuses a payee off the allowlist unless approved', async () => {
    const offList = requestFor(invoiceFor(restricted, '100000'))
    expect(codeOf(offList)).toBe('payee_not_allowed')
    const approved = await approve(offList)
    expect(codeOf(approved.request, { approvalSigner: approved.approvalSigner })).toBe('ok')
    const otherInvoice = { ...approved.request.approval, invoiceHash: `0x${'99'.repeat(32)}` as const }
    expect(codeOf({ ...approved.request, approval: otherInvoice }, { approvalSigner: approved.approvalSigner })).toBe(
      'payee_not_allowed',
    )
  })

  it('refuses invoices from another origin, expired, too far ahead or already signed', () => {
    const request = requestFor(invoiceFor(merchant, '100000'))
    expect(codeOf({ ...request, invoice: { ...request.invoice, url: 'https://evil.example/api/i/x' } })).toBe(
      'bad_invoice_origin',
    )
    expect(codeOf(request, { nowSeconds: now + 600 })).toBe('invoice_expired')
    expect(codeOf(requestFor(invoiceFor(merchant, '100000', now + 901)))).toBe('expiry_too_far')
    expect(codeOf(request, { usedInvoiceHashes: new Set([request.invoice.invoiceHash.toLowerCase()]) })).toBe(
      'replayed_invoice',
    )
  })

  it('refuses a leaf that is not the one the invoice implies: leaf_mismatch', () => {
    const request = requestFor(invoiceFor(merchant, '100000'))
    const other = requestFor(invoiceFor(merchant, '200000'))
    expect(codeOf({ ...request, leaf: other.leaf })).toBe('leaf_mismatch')
    expect(codeOf({ ...request, invoice: { ...request.invoice, invoiceHash: other.invoice.invoiceHash } })).toBe(
      'leaf_mismatch',
    )
    const twoRedeemers = { ...request.leaf.caveats[3], terms: `${relayer}${relayer.slice(2)}` as const }
    const caveats = [
      ...request.leaf.caveats.slice(0, 3),
      { enforcer: owner, terms: twoRedeemers.terms, args: '0x' as const },
    ]
    expect(codeOf({ ...request, leaf: { ...request.leaf, caveats } })).toBe('leaf_mismatch')
  })

  it('answers no_lease once the lease has run out', () => {
    expect(checkLease(1_000, 2_000)).toBeUndefined()
    expect(checkLease(2_001, 2_000)).toMatchObject({ ok: false, code: 'no_lease' })
  })
})
