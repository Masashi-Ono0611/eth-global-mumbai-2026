import { Effect, Option } from 'effect'
import { describe, expect, test } from 'vitest'
import { type ServiceSigning, signingAddressOf, teeSignerMatches } from '../src/robot/TeeProof.ts'

// A real proof, fetched once on 6 Nov 2026 from the glm-5.3 TeeML provider 0xD179…E503. The router named it, and its
// registry service (mainnet inference contract) names TEE signer 0x0766…9179, with TargetSeparated false. The text
// carries two digests of the sealed (end-to-end encrypted) request and response, not of our plaintext.
const LIVE = {
  signer: '0x0766BC72beB6dAe764eE51C781c0A68117E69179',
  text: 'zg-sig-v1/e2ee-ct:326168d2fe9db17a7ece1effd27ac017fa741879580dc099112b042e63b29e22:4f6de43627bde704e090976e1863c020c1731a84ea7afacb06b62afc3da88fb2',
  signature:
    '0x02dadc236044a205e1b922538e26405889bb3f821d7a2b8a5537bd1d37ade21f00d862ba55f154b85c0d15c84db02dc9e6a1cc06d1654ebc58a9ba5d2a8cf4571b',
} as const

const BROKER_SIGNER = '0x0766BC72beB6dAe764eE51C781c0A68117E69179'
const LLM_SIGNER = '0x00000000000000000000000000000000000071ee'
const service = (additionalInfo: unknown, overrides: Partial<ServiceSigning> = {}): ServiceSigning => ({
  verifiability: 'TeeML',
  additionalInfo: typeof additionalInfo === 'string' ? additionalInfo : JSON.stringify(additionalInfo),
  teeSignerAddress: BROKER_SIGNER,
  teeSignerAcknowledged: true,
  ...overrides,
})

describe('TEE proof of a 0G decision', () => {
  test('the live glm-5.3 signature recovers to the registered TEE signer; a changed text does not', async () => {
    expect(await Effect.runPromise(teeSignerMatches(LIVE))).toBe(true)
    expect(await Effect.runPromise(teeSignerMatches({ ...LIVE, text: `${LIVE.text.slice(0, -1)}0` }))).toBe(false)
    expect(await Effect.runPromise(teeSignerMatches({ ...LIVE, signer: LLM_SIGNER }))).toBe(false)
    expect(await Effect.runPromise(teeSignerMatches({ ...LIVE, signature: '0x1234' }))).toBe(false)
  })

  test('the signer follows the SDK rule: the LLM TEE only when separated and decentralized', () => {
    const separated = { TargetSeparated: true, TargetTeeAddress: LLM_SIGNER }
    expect(signingAddressOf(service({ TargetSeparated: false, TargetTeeAddress: '' }))).toEqual(
      Option.some(BROKER_SIGNER),
    )
    expect(signingAddressOf(service(separated))).toEqual(Option.some(LLM_SIGNER))
    expect(signingAddressOf(service({ ...separated, ProviderType: 'centralized' }))).toEqual(Option.some(BROKER_SIGNER))
    expect(signingAddressOf(service({ TargetSeparated: true, TargetTeeAddress: '' }))).toEqual(
      Option.some(BROKER_SIGNER),
    )
  })

  test('no signer for a service that is not TeeML, not acknowledged, or has unreadable additionalInfo', () => {
    expect(signingAddressOf(service({}, { verifiability: 'OpML' }))).toEqual(Option.none())
    expect(signingAddressOf(service({}, { teeSignerAcknowledged: false }))).toEqual(Option.none())
    expect(signingAddressOf(service('0x0766BC72beB6dAe764eE51C781c0A68117E69179'))).toEqual(Option.none())
  })
})
