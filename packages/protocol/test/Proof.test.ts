import { describe, expect, test } from 'vitest'
import { anchorChecks, decodeRecord, recordsCallData } from '../src/Proof.ts'

// A real EpisodeLog record on 0G Galileo (0x4C947E6D…206A), read on 7 Nov 2026 with `eth_call` and this calldata:
// the chai of 6 Nov whose frame went to 0G Storage (docs/evidence/2026-11-06-frames-on-0g.md). Its episode JSON,
// downloaded from 0G Storage by the root below, names episodeId and requestIds as used here.
const episodeId = 'jg2wabvwez4mxe22ecnfjvigbq'
const rootHash = '0x11040dfc6bcf714618f8ade9c774ee1558c36e37d8dbb7fc99cc0c3118838c6c'
const requestIds = ['cd6c8ceb-b972-49af-a91e-112bc1fe7587']
const recorder = '0xc6ff8a666f4c7f674c1d129c73b46d61f2891fcd'
const result =
  '0x11040dfc6bcf714618f8ade9c774ee1558c36e37d8dbb7fc99cc0c3118838c6c' +
  '2067f1b9e31d63975063b086dc1a00ed143f48b5dcf163c5e87a720c6077606d' +
  '000000000000000000000000c6ff8a666f4c7f674c1d129c73b46d61f2891fcd' +
  '000000000000000000000000000000000000000000000000000000006aedf348'

describe('EpisodeLog.records from the browser', () => {
  test('calldata is the records(bytes32) selector and keccak256 of the episode id', () => {
    // 0x01e64725 = viem's toFunctionSelector('records(bytes32)').
    expect(recordsCallData(episodeId)).toMatch(/^0x01e64725[0-9a-f]{64}$/)
  })

  test('decodes the record 0G Chain returned, and reads an empty record as none', () => {
    expect(decodeRecord(result)).toEqual({
      rootHash,
      requestIdsHash: '0x2067f1b9e31d63975063b086dc1a00ed143f48b5dcf163c5e87a720c6077606d',
      recorder,
      recordedAt: 1793979208,
    })
    expect(decodeRecord(`0x${'0'.repeat(256)}`)).toBeNull()
    expect(decodeRecord('0x')).toBeNull()
  })

  test('the downloaded episode passes every check against its own record', () => {
    expect(anchorChecks(episodeId, rootHash, { episodeId, requestIds }, decodeRecord(result))).toEqual({
      recorded: true,
      rootMatches: true,
      requestIdsMatch: true,
      sameEpisode: true,
    })
  })

  test('a changed request id, another root, another episode or no record each fail their own check', () => {
    const record = decodeRecord(result)
    expect(anchorChecks(episodeId, rootHash, { episodeId, requestIds: ['forged'] }, record).requestIdsMatch).toBe(false)
    expect(anchorChecks(episodeId, `0x${'00'.repeat(32)}`, { episodeId, requestIds }, record).rootMatches).toBe(false)
    expect(anchorChecks(episodeId, rootHash, { episodeId: 'other', requestIds }, record).sameEpisode).toBe(false)
    expect(anchorChecks(episodeId, rootHash, { episodeId, requestIds }, null)).toEqual({
      recorded: false,
      rootMatches: false,
      requestIdsMatch: false,
      sameEpisode: true,
    })
  })
})
