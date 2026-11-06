import { Effect, Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import {
  ARC_USDC,
  approvalDigest,
  approvalNonce,
  buildLeaf,
  canonicalJson,
  ChipResponse,
  decodeBase32,
  delegationDigest,
  delegationHash,
  encodeBase32,
  generateId,
  hexToBytes,
  Id,
  idFromBytes16,
  invoiceHash,
  invoiceHashMatches,
  invoiceIdBytes16,
  isTerminalState,
  jsonHash,
  keccak256Utf8,
  pairMessage,
  PaymentRequired,
  requestIdsHash,
  sameDelegation,
  SignRequest,
  UnsignedDelegation,
  unitsToUsdc,
  usdcToUnits,
  utf8ToBytes,
} from '../src/index.ts'
import golden from './fixtures/golden.json' with { type: 'json' }

const decode = <A>(schema: Schema.Schema<A>, value: unknown) => Schema.is(schema)(value)
const goldenLeaf = Schema.decodeUnknownSync(UnsignedDelegation)(golden.leaf.delegation)

const invoiceId = idFromBytes16(hexToBytes(golden.base32.bytes))
const invoice = {
  id: invoiceId,
  url: `https://vitaquack.example/api/i/${invoiceId}`,
  merchantId: golden.invoice.merchantId,
  payTo: '0x000000000000000000000000000000000000c0de',
  asset: ARC_USDC,
  amount: golden.invoice.amount,
  expiresAt: golden.invoice.expiresAt,
  linesHash: jsonHash(golden.invoice.lines),
  rulesHash: jsonHash(golden.invoice.restrictions),
  invoiceHash: '0x6c5d35a8d08ac51bafa5ea4a0d29a268f9a23b942a8af22c1fa1d9c38ae8bcf7',
  restricted: false,
} as const

describe('keccak256', () => {
  test.each(golden.keccak)('matches viem for "$char" x $repeat (padding and multi-block)', ({ char, repeat, hash }) => {
    expect(keccak256Utf8(char.repeat(repeat))).toBe(hash)
  })
})

describe('base32 ids', () => {
  test('RFC 4648 vector, lowercase, no padding', () => {
    expect(encodeBase32(utf8ToBytes(golden.base32.rfc4648.text))).toBe(golden.base32.rfc4648.base32)
    expect(new TextDecoder().decode(decodeBase32(golden.base32.rfc4648.base32))).toBe(golden.base32.rfc4648.text)
  })

  test('26-character id round-trips to the invoice id bytes16', () => {
    expect(invoiceId).toHaveLength(26)
    expect(invoiceIdBytes16(invoiceId)).toBe(golden.invoice.invoiceIdBytes16)
    expect(Schema.is(Id)(invoiceId)).toBe(true)
  })

  test('rejects non-canonical spellings, wrong lengths and upper case', () => {
    const lastIndex = 'abcdefghijklmnopqrstuvwxyz234567'.indexOf(invoiceId.charAt(25))
    const twin = invoiceId.slice(0, 25) + 'abcdefghijklmnopqrstuvwxyz234567'.charAt(lastIndex + 1)
    expect(invoiceIdBytes16(twin)).toBe(invoiceIdBytes16(invoiceId))
    expect(Schema.is(Id)(twin)).toBe(false)
    expect(Schema.is(Id)(invoiceId.slice(1))).toBe(false)
    expect(Schema.is(Id)(invoiceId.toUpperCase())).toBe(false)
  })

  test('generateId mints canonical ids from the Random service', () => {
    const ids = Effect.runSync(Effect.all(Array.from({ length: 32 }, () => generateId)))
    expect(ids.every(Schema.is(Id))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('invoice hash (the S2 spike invoice)', () => {
  test('lines and rules hash sorted-key compact JSON', () => {
    expect(canonicalJson({ sku: 'coffee', name: 'Coffee', unitAmount: '1500000', qty: 1 })).toBe(
      '{"name":"Coffee","qty":1,"sku":"coffee","unitAmount":"1500000"}',
    )
    expect(jsonHash(golden.invoice.lines)).toBe(golden.invoice.linesHash)
    expect(jsonHash(golden.invoice.restrictions)).toBe(golden.invoice.rulesHash)
  })

  test('EIP-712 digest equals viem hashTypedData', () => {
    expect(invoiceHash(invoice)).toBe(golden.invoice.invoiceHash)
    expect(invoiceHashMatches(invoice)).toBe(true)
  })

  test('every signed field changes the hash', () => {
    for (const changed of [
      { ...invoice, amount: '1500001' },
      { ...invoice, payTo: '0x000000000000000000000000000000000000dEaD' },
      { ...invoice, expiresAt: invoice.expiresAt + 1 },
      { ...invoice, merchantId: 'other-cafe' },
      { ...invoice, rulesHash: jsonHash(['restricted']) },
    ] as const)
      expect(invoiceHashMatches(changed)).toBe(false)
  })

  test('USDC decimals ↔ base units', () => {
    expect(usdcToUnits('0.10')).toBe(100_000n)
    expect(usdcToUnits('1')).toBe(1_000_000n)
    expect(usdcToUnits('0.000001')).toBe(1n)
    expect(() => usdcToUnits('0.0000001')).toThrow()
    expect(unitsToUsdc(250_000n)).toBe('0.25')
    expect(unitsToUsdc(5_000_000n)).toBe('5')
  })
})

describe('chip leaf', () => {
  const leaf = buildLeaf({
    chip: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    grantHash: '0x58e332bad678a1e09550d11cf54a9dd59638b746dbabd741c58a9d04ebbe8def',
    relayer: '0x00000000000000000000000000000000000beef1',
    invoiceHash: invoice.invoiceHash,
    payTo: invoice.payTo,
    amount: BigInt(invoice.amount),
    expiresAt: invoice.expiresAt,
  })

  test('is byte-identical to the spike leaf and hashes like the kit', () => {
    expect(sameDelegation(leaf, goldenLeaf)).toBe(true)
    expect(leaf.caveats.map((caveat) => hexToBytes(caveat.terms).length)).toEqual([120, 32, 32, 20])
    expect(delegationHash(leaf)).toBe(golden.leaf.hash)
    expect(delegationDigest(leaf)).toBe(golden.leaf.digest)
  })

  test('a changed caveat or salt is a different leaf', () => {
    const [first, ...rest] = leaf.caveats
    if (first === undefined) throw new Error('leaf has caveats')
    expect(sameDelegation(leaf, { ...leaf, salt: '1' })).toBe(false)
    expect(sameDelegation(leaf, { ...leaf, caveats: [...rest, first] })).toBe(false)
    expect(delegationHash({ ...leaf, salt: '1' })).not.toBe(golden.leaf.hash)
  })
})

describe('approval', () => {
  const enforcer = '0x00000000000000000000000000000000000e4f01'
  const base = {
    invoiceHash: invoice.invoiceHash,
    payee: invoice.payTo,
    amount: golden.approval.amount,
    expiry: golden.approval.expiry,
  }

  test('nonce and digest equal viem hashTypedData', () => {
    const nonce = approvalNonce(enforcer, base)
    expect(nonce).toBe(golden.approval.nonce)
    expect(approvalDigest(enforcer, { ...base, nonce })).toBe(golden.approval.digest)
    expect(approvalDigest('0x00000000000000000000000000000000000e4f02', { ...base, nonce })).not.toBe(
      golden.approval.digest,
    )
  })
})

describe('wire schemas', () => {
  test('x402 PAYMENT-REQUIRED body of §7', () => {
    const body = {
      x402Version: 2,
      error: 'payment-required',
      resource: { url: invoice.url, description: 'Chai', mimeType: 'application/json' },
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:5042',
          asset: ARC_USDC,
          payTo: invoice.payTo,
          amount: '100000',
          maxTimeoutSeconds: 120,
          extra: {
            assetTransferMethod: 'erc7710',
            invoiceHash: invoice.invoiceHash,
            invoiceId,
            expiresAt: 1762000000,
            delegationManager: '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',
            facilitators: ['0x00000000000000000000000000000000000beef1'],
            paymentIdentifier: invoiceId,
          },
        },
      ],
    }
    expect(decode(PaymentRequired, body)).toBe(true)
    expect(decode(PaymentRequired, { ...body, accepts: [{ ...body.accepts[0], network: 'eip155:1' }] })).toBe(false)
  })

  test('chip responses and sign requests', () => {
    expect(decode(ChipResponse, { requestId: invoiceId, ok: false, refused: { code: 'no_lease', detail: '' } })).toBe(
      true,
    )
    expect(decode(ChipResponse, { requestId: invoiceId, ok: false, refused: { code: 'nope', detail: '' } })).toBe(false)
    expect(
      decode(ChipResponse, {
        requestId: invoiceId,
        ok: true,
        signature: golden.leaf.signature,
        leafHash: golden.leaf.hash,
      }),
    ).toBe(true)
    const grant = { ...golden.leaf.delegation, signature: '0x1234' }
    const request = {
      id: invoiceId,
      kind: 'sign-invoice',
      expiresAt: invoice.expiresAt,
      invoice,
      grant: {
        delegation: grant,
        dailyCap: '1000000',
        perPaymentCap: '300000',
        allowlist: [invoice.payTo],
        expiresAt: 1,
      },
      approval: null,
      leaf: golden.leaf.delegation,
      chainId: 5042,
      delegationManager: '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',
    }
    expect(decode(SignRequest, request)).toBe(true)
    expect(decode(SignRequest, { ...request, chainId: 1 })).toBe(false)
  })

  test('pairing message, terminal states, request ids hash', () => {
    expect(pairMessage('K7Q2M9XZ', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8')).toBe(
      'Vitaquack pair K7Q2M9XZ 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 5042',
    )
    expect(isTerminalState('paid')).toBe(true)
    expect(isTerminalState('signing')).toBe(false)
    expect(requestIdsHash(['a', 'b'])).toBe(keccak256Utf8('a,b'))
  })
})
