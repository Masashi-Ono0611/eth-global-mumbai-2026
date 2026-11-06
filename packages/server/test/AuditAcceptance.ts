import { expect } from 'bun:test'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Schema } from 'effect'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import { encodeAbiParameters, getAddress, type Hex, keccak256, stringToHex } from 'viem'
import { freshConnections, randomId } from './AgentSamples.ts'
import { chaiDecideInput } from './DecideSamples.ts'
import { makeSoftwareAuthenticator, registerPasskey, sessionCookie } from './PasskeyFixture.ts'
import type { ZeroGStub } from './RobotAcceptance.ts'

type Urls = { readonly appUrl: string; readonly url: string; readonly apiUrl: string }
type ChainRecord = {
  readonly rootHash: Hex
  readonly requestIdsHash: Hex
  readonly recorder: Hex
  readonly recordedAt: bigint
}

/** The EpisodeLog address the native stack binds (no contract runs there: the stub chain answers for it). */
export const TEST_EPISODE_LOG = '0x00000000000000000000000000000000000e9105'

const decodeRpcCall = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.Finite, method: Schema.String }))

/** A 0G Chain stand-in on 127.0.0.1: every `eth_call` answers `EpisodeLog.records` with the record set last. */
export const startChainStub = () => {
  let record: ChainRecord = {
    rootHash: `0x${'00'.repeat(32)}`,
    requestIdsHash: `0x${'00'.repeat(32)}`,
    recorder: `0x${'00'.repeat(20)}`,
    recordedAt: 0n,
  }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const call = decodeRpcCall(await request.json())
      const result =
        call.method === 'eth_chainId'
          ? '0x40da'
          : call.method === 'eth_call'
            ? encodeAbiParameters(
                [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'uint64' }],
                [record.rootHash, record.requestIdsHash, record.recorder, record.recordedAt],
              )
            : null
      return Response.json(
        result === null
          ? { jsonrpc: '2.0', id: call.id, error: { code: -32601, message: 'method not found' } }
          : { jsonrpc: '2.0', id: call.id, result },
      )
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    setRecord: (next: ChainRecord) => {
      record = next
    },
  }
}
export type ChainStub = ReturnType<typeof startChainStub>

const Verified = Schema.Struct({
  matches: Schema.Struct({ rootHash: Schema.Boolean, requestIdsHash: Schema.Boolean }),
  onChain: Schema.NullOr(
    Schema.Struct({ rootHash: Schema.String, recorder: Schema.String, recordedAt: Schema.Finite }),
  ),
  stored: Schema.Struct({ rootHash: Schema.NullOr(Schema.String), requestIdsHash: Schema.String }),
  downloadCheckedBy: Schema.Literal('uploader'),
})
const Replayed = Schema.Struct({
  binding: Schema.Literal(false),
  same: Schema.Boolean,
  original: Schema.Struct({ action: Schema.String, requestId: Schema.NullOr(Schema.String) }),
  replay: Schema.Struct({
    ok: Schema.Boolean,
    action: Schema.optionalKey(Schema.String),
    requestId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
})

/** Audit acceptance: verify compares D1 with the chain record (stub RPC), replay re-asks the stub brain and writes nothing. */
export const registerAuditAcceptance = (
  test: TestApi['test'],
  stack: Effect.Effect<Urls>,
  zeroG: ZeroGStub,
  chain: ChainStub,
) =>
  test(
    'audit: verify an uploaded episode against EpisodeLog, replay its decision without side effects, 404 for another owner',
    Effect.gen(function* () {
      const { appUrl, url, apiUrl } = yield* stack
      const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator())
      const { response } = yield* registerPasskey(appUrl, authenticator, 'Audit Owner')
      const { accountId } = yield* Schema.decodeUnknownEffect(Schema.Struct({ accountId: Schema.String }))(
        yield* response.json,
      )
      const cookie = sessionCookie(response)
      const post = (path: string) =>
        HttpClient.post(`${apiUrl}${path}`, {
          headers: { origin: new URL(appUrl).origin, cookie },
          body: HttpBody.text('{}', 'application/json'),
        })
      const seed = (episodeId: string, owner: string) =>
        HttpClient.post(`${url}/test/vq/audit-episodes`, {
          body: HttpBody.text(
            JSON.stringify({
              episodeId,
              accountId: owner,
              requestId: 'orig-request-1',
              inputJson: JSON.stringify(chaiDecideInput),
              provider: 'router-api.0g.ai/qwen3-vl-plus',
              rootHash: `0x${'aa'.repeat(32)}`,
              storageTx: `0x${'bb'.repeat(32)}`,
              logTx: `0x${'cc'.repeat(32)}`,
            }),
            'application/json',
          ),
        })
      const mine = randomId()
      expect((yield* seed(mine, accountId)).status).toBe(204)
      const anchored: ChainRecord = {
        rootHash: `0x${'aa'.repeat(32)}`,
        requestIdsHash: keccak256(stringToHex('orig-request-1')),
        recorder: '0x00000000000000000000000000000000000c6ff0',
        recordedAt: 1_793_947_010n,
      }
      chain.setRecord(anchored)
      const verified = yield* Schema.decodeUnknownEffect(Verified)(
        yield* (yield* post(`/api/wallet/episodes/${mine}/verify`)).json,
      )
      expect(verified.matches).toEqual({ rootHash: true, requestIdsHash: true })
      expect(verified.stored.requestIdsHash).toBe(anchored.requestIdsHash)
      expect(verified.onChain).toMatchObject({ recorder: getAddress(anchored.recorder), recordedAt: 1_793_947_010 })
      chain.setRecord({ ...anchored, rootHash: `0x${'dd'.repeat(32)}` })
      const tampered = yield* Schema.decodeUnknownEffect(Verified)(
        yield* (yield* post(`/api/wallet/episodes/${mine}/verify`)).json,
      )
      expect(tampered.matches).toEqual({ rootHash: false, requestIdsHash: true })

      zeroG.setMode('pay')
      const replayed = yield* Schema.decodeUnknownEffect(Replayed)(
        yield* (yield* post(`/api/wallet/episodes/${mine}/replay`)).json,
      )
      expect(replayed).toMatchObject({
        binding: false,
        same: true,
        original: { action: 'pay', requestId: 'orig-request-1' },
      })
      expect(replayed.replay).toMatchObject({ ok: true, action: 'pay' })
      expect(replayed.replay.requestId).toMatch(/^stub-request-\d+$/)
      const decisions = yield* (yield* HttpClient.get(`${url}/test/vq/episodes/${mine}/decision-count`)).json
      expect(decisions).toEqual({ count: 1 })

      const theirs = randomId()
      expect((yield* seed(theirs, 'another-account')).status).toBe(204)
      expect((yield* post(`/api/wallet/episodes/${theirs}/verify`)).status).toBe(404)
      expect((yield* post(`/api/wallet/episodes/${theirs}/replay`)).status).toBe(404)
    }).pipe(Effect.provide(freshConnections)),
    { timeout: 60000 },
  )
