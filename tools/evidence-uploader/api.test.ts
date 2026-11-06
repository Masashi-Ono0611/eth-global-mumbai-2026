import { describe, expect, test } from 'vitest'
import { makeEvidenceApi } from './api.ts'

type Sent = {
  readonly url: string
  readonly method: string
  readonly authorization: string | null
  readonly body: unknown
}

/** A Worker stand-in that answers every call with `reply` and records what it was sent. */
const worker = (reply: unknown, status = 200) => {
  const sent: Sent[] = []
  const fetcher = (url: string, init: RequestInit) => {
    sent.push({
      url,
      method: init.method ?? 'GET',
      authorization: new Headers(init.headers).get('authorization'),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    })
    return Promise.resolve(Response.json(reply, { status }))
  }
  return { sent, api: makeEvidenceApi('https://app.test', 'test-token-0123456789', fetcher) }
}

describe('evidence uploader ↔ Worker', () => {
  test('a failure is reported as exactly {error}, cut to 400 characters', async () => {
    const { sent, api } = worker({ status: 'failed' })
    await api.markFailed('ep1', 'x'.repeat(500))
    expect(sent).toEqual([
      {
        url: 'https://app.test/api/evidence/ep1/failed',
        method: 'POST',
        authorization: 'Bearer test-token-0123456789',
        body: { error: 'x'.repeat(400) },
      },
    ])
  })

  test('an upload is reported as {rootHash, storageTx, logTx}', async () => {
    const { sent, api } = worker({ status: 'uploaded' })
    const proof = { rootHash: `0x${'01'.repeat(32)}`, storageTx: `0x${'02'.repeat(32)}`, logTx: `0x${'03'.repeat(32)}` }
    await api.markUploaded('ep2', proof)
    expect(sent[0]).toMatchObject({ url: 'https://app.test/api/evidence/ep2/uploaded', method: 'POST', body: proof })
  })

  test('claiming keeps only well-formed episodes and a refused call throws', async () => {
    const good = { episodeId: 'ep3', requestIdsHash: `0x${'04'.repeat(32)}`, payloadJson: '{}' }
    const { sent, api } = worker({ episodes: [good, { episodeId: 'ep4' }] })
    expect(await api.claimPending()).toEqual([good])
    expect(sent[0]).toMatchObject({ url: 'https://app.test/api/evidence/pending', method: 'GET', body: null })
    await expect(worker({ error: 'bad evidence token' }, 401).api.claimPending()).rejects.toThrow(
      'GET /api/evidence/pending answered 401',
    )
  })
})
