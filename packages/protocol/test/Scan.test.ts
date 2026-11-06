import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import {
  EpisodeEvidence,
  keccak256Utf8,
  requestIdsHash,
  SCAN_MAX_BYTES,
  scanMessage,
  ScanRequest,
  ScanResponse,
} from '../src/index.ts'
import golden from './fixtures/golden.json' with { type: 'json' }

const { scan } = golden
const accepts = <A>(schema: Schema.Schema<A>, value: unknown) => Schema.is(schema)(value)
const body = { invoiceId: scan.invoiceId, capturedAt: scan.capturedAt, frame: scan.frame, sig: scan.sig }
const encode = (value: unknown) =>
  JSON.stringify(Schema.encodeSync(EpisodeEvidence)(Schema.decodeUnknownSync(EpisodeEvidence)(value)))

describe('scan message', () => {
  test('matches the viem-signed golden message, and its EIP-191 digest matches viem hashMessage', () => {
    const message = scanMessage(scan.invoiceId, scan.frame.sha256, scan.capturedAt, scan.robotId)
    expect(message).toBe(scan.message)
    expect(keccak256Utf8(`\x19Ethereum Signed Message:\n${message.length}${message}`)).toBe(scan.digest)
  })

  test('spells the digest lowercase and the capture time as integer milliseconds', () => {
    expect(scanMessage(scan.invoiceId, scan.frame.sha256.toUpperCase().replace('0X', '0x'), 1794000123456, 'r')).toBe(
      `vitaquack-scan:v1|${scan.invoiceId}|${scan.frame.sha256}|1794000123456|r`,
    )
  })
})

describe('scan wire schemas', () => {
  test('the chip body decodes, and each malformed field is refused', () => {
    expect(accepts(ScanRequest, body)).toBe(true)
    const frame = (patch: object) => ({ ...body, frame: { ...scan.frame, ...patch } })
    expect(accepts(ScanRequest, frame({ mime: 'image/png' }))).toBe(false)
    expect(accepts(ScanRequest, frame({ sha256: scan.frame.sha256.toUpperCase().replace('0X', '0x') }))).toBe(false)
    expect(accepts(ScanRequest, frame({ sha256: scan.frame.sha256.slice(0, 64) }))).toBe(false)
    expect(accepts(ScanRequest, frame({ bytes: 0 }))).toBe(false)
    expect(accepts(ScanRequest, frame({ bytes: SCAN_MAX_BYTES + 1 }))).toBe(false)
    expect(accepts(ScanRequest, frame({ b64: 'not base64!' }))).toBe(false)
    expect(accepts(ScanRequest, { ...body, capturedAt: 1794000123.5 })).toBe(false)
    expect(accepts(ScanRequest, { ...body, invoiceId: 'short' })).toBe(false)
    expect(accepts(ScanRequest, { ...body, sig: scan.sig.slice(0, 130) })).toBe(false)
  })

  test('the scan response names the errand, its state and the observation', () => {
    const response = { episodeId: scan.invoiceId, state: 'deciding', observationId: scan.robotId }
    expect(accepts(ScanResponse, response)).toBe(true)
    expect(accepts(ScanResponse, { ...response, state: 'scanning' })).toBe(false)
  })
})

describe('episode evidence observations', () => {
  const evidence = {
    episodeId: scan.invoiceId,
    robotId: scan.robotId,
    item: 'chai',
    decisions: [],
    outcome: { state: 'paid' },
    requestIds: ['req-1', 'req-2'],
  }

  test('evidence without a scan has no observations key and encodes byte-identically', () => {
    expect(encode(evidence)).toBe(JSON.stringify(evidence))
    expect(encode(evidence)).not.toContain('observations')
  })

  test('a scan is carried as digest, size, capture time and chip signature, outside the request ids hash', () => {
    const observation = {
      sha256: scan.frame.sha256,
      bytes: scan.frame.bytes,
      capturedAt: scan.capturedAt,
      chipSig: scan.sig,
    }
    const scanned = { ...evidence, observations: [observation] }
    expect(encode(scanned)).toBe(JSON.stringify(scanned))
    expect(accepts(EpisodeEvidence, { ...evidence, observations: [{ ...observation, bytes: 0 }] })).toBe(false)
    expect(requestIdsHash(scanned.requestIds)).toBe(requestIdsHash(evidence.requestIds))
  })
})
