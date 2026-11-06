import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { EpisodeEvidence, requestIdsHash, TeeProof } from '../src/index.ts'

const decision = {
  step: 1,
  model: 'glm-5.3',
  requestId: 'req-1',
  chatId: 'chat-1',
  provider: '0x00000000000000000000000000000000000000aa',
  latencyMs: 812,
  promptSha256: `0x${'1'.repeat(64)}`,
  action: 'pay',
  reason: 'Chai is within budget.',
  outcome: 'paid',
}
const evidence = {
  episodeId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
  robotId: 'baaaaaaaaaaaaaaaaaaaaaaaaa',
  item: 'chai',
  decisions: [decision],
  outcome: { state: 'paid' },
  requestIds: ['req-1'],
}
const tee = {
  signer: '0x942d6ce7412251652811D216A48D29Ff3E7CD1d3',
  text: '{"id":"chat-1","request_hash":"…","response_hash":"…"}',
  signature: `0x${'ab'.repeat(65)}`,
  fetchedAt: 1794000123456,
  verified: true,
}
const roundTrip = (value: unknown) =>
  JSON.stringify(Schema.encodeSync(EpisodeEvidence)(Schema.decodeUnknownSync(EpisodeEvidence)(value)))

describe('TEE proof in the evidence', () => {
  test('a decision without a proof has no tee key and encodes byte-identically', () => {
    expect(roundTrip(evidence)).toBe(JSON.stringify(evidence))
    expect(roundTrip(evidence)).not.toContain('"tee"')
  })

  test('a decision carries signer, signed text, signature, fetch time and the verdict, outside the request ids hash', () => {
    const proven = { ...evidence, decisions: [{ ...decision, tee }] }
    expect(roundTrip(proven)).toBe(JSON.stringify(proven))
    expect(requestIdsHash(proven.requestIds)).toBe(requestIdsHash(evidence.requestIds))
    expect(Schema.is(TeeProof)({ ...tee, verified: false })).toBe(true)
  })

  test('a malformed proof is refused', () => {
    const accepts = Schema.is(TeeProof)
    expect(accepts({ ...tee, signer: '0x1234' })).toBe(false)
    expect(accepts({ ...tee, signature: 'ab' })).toBe(false)
    expect(accepts({ ...tee, fetchedAt: 1.5 })).toBe(false)
    const { verified: _verified, ...unverdicted } = tee
    expect(accepts(unverdicted)).toBe(false)
  })
})
