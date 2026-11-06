import { buildGrant } from '@ethmumbai/chain/Grant'
import { idFromBytes16 } from '@ethmumbai/protocol/Base32'
import { PAIRING_ALPHABET, type SignRequest } from '@ethmumbai/protocol/Chip'
import { ARC_DELEGATION_MANAGER, buildLeaf, type Delegation, delegationHash } from '@ethmumbai/protocol/Delegation'
import type { Hex } from '@ethmumbai/protocol/Hex'
import { ARC_CHAIN_ID, ARC_USDC, invoiceHash, jsonHash } from '@ethmumbai/protocol/Invoice'
import { Layer } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'

// Test-only fixtures for the chip and robot acceptance. Every key and address here is a throwaway: never funded,
// never used on a chain.
const TEST_OWNER: Hex = '0x00000000000000000000000000000000000000aa'
const TEST_ENFORCER: Hex = '0x00000000000000000000000000000000000e0f0e'
const TEST_APPROVER: Hex = '0x00000000000000000000000000000000000a9905'
const TEST_RELAYER: Hex = '0x00000000000000000000000000000000000beef1'

/**
 * The tests' HTTP client without keep-alive: the local dev proxy closes idle sockets, and a pooled socket reused after a
 * long hold (a 25 s poll, a 10 s 0G timeout) comes back as ECONNRESET.
 */
export const freshConnections = Layer.mergeAll(
  FetchHttpClient.layer,
  Layer.succeed(FetchHttpClient.RequestInit, { keepalive: false }),
)

export const randomId = () => idFromBytes16(crypto.getRandomValues(new Uint8Array(16)))
export const randomPairingCode = () =>
  [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => PAIRING_ALPHABET.charAt(byte % 31)).join('')
const nowSeconds = () => Math.floor(Date.now() / 1000)

/** A grant's two limits, USDC base units. */
export interface Caps {
  readonly dailyCap: bigint
  readonly perPaymentCap: bigint
}
/** The spec's example caps: 1.00 a day, 0.30 per payment. */
export const SPEC_CAPS: Caps = { dailyCap: 1_000_000n, perPaymentCap: 300_000n }
/** The demo's defaults (6 Nov, Kris): 3.00 a day, 1.00 per payment; thali 2.00 needs the owner, a second one is over. */
export const DEMO_CAPS: Caps = { dailyCap: 3_000_000n, perPaymentCap: 1_000_000n }

/** A grant owner → chip with the spec's caveats (the spec's caps unless given), signed with a placeholder. */
export const sampleGrant = (chip: Hex, payee: Hex, caps: Caps = SPEC_CAPS): Delegation => ({
  ...buildGrant({
    grantId: randomId(),
    owner: TEST_OWNER,
    chip,
    dailyCap: caps.dailyCap,
    perPaymentCap: caps.perPaymentCap,
    allowlist: [payee],
    startAt: nowSeconds() - 60,
    expiresAt: nowSeconds() + 86_400,
    enforcer: TEST_ENFORCER,
    approver: TEST_APPROVER,
  }),
  signature: `0x${'ab'.repeat(65)}`,
})

/** The `grants` row body for the `/test/vq/grants` fixture. */
export const grantRow = (input: {
  robotId: string
  accountId: string
  delegation: Delegation
  payee: Hex
  caps?: Caps
}) => ({
  id: randomId(),
  robotId: input.robotId,
  accountId: input.accountId,
  delegationHash: delegationHash(input.delegation),
  delegationJson: JSON.stringify(input.delegation),
  dailyCap: (input.caps ?? SPEC_CAPS).dailyCap.toString(),
  perPaymentCap: (input.caps ?? SPEC_CAPS).perPaymentCap.toString(),
  allowlistJson: JSON.stringify([input.payee]),
  startAt: nowSeconds() - 60,
  expiresAt: nowSeconds() + 86_400,
})

/** A sign request exactly as the Worker queues it, for an invoice under `origin`. */
export const sampleSignRequest = (input: { chip: Hex; origin: string; payTo: Hex; amount: string }): SignRequest => {
  const grant = sampleGrant(input.chip, input.payTo)
  const id = randomId()
  const fields = {
    id,
    url: `${input.origin}/api/i/${id}`,
    merchantId: 'duck-cafe',
    payTo: input.payTo,
    asset: ARC_USDC,
    amount: input.amount,
    expiresAt: nowSeconds() + 600,
    linesHash: jsonHash([{ sku: 'chai', name: 'Chai', qty: 1, unitAmount: input.amount }]),
    rulesHash: jsonHash([]),
    restricted: false,
  }
  const invoice = { ...fields, invoiceHash: invoiceHash(fields) }
  return {
    id: randomId(),
    kind: 'sign-invoice',
    expiresAt: nowSeconds() + 60,
    invoice,
    grant: {
      delegation: grant,
      dailyCap: '1000000',
      perPaymentCap: '300000',
      allowlist: [input.payTo],
      expiresAt: nowSeconds() + 86_400,
    },
    approval: null,
    leaf: buildLeaf({
      chip: input.chip,
      grantHash: delegationHash(grant),
      relayer: TEST_RELAYER,
      invoiceHash: invoice.invoiceHash,
      payTo: input.payTo,
      amount: BigInt(input.amount),
      expiresAt: invoice.expiresAt,
    }),
    chainId: ARC_CHAIN_ID,
    delegationManager: ARC_DELEGATION_MANAGER,
  }
}
