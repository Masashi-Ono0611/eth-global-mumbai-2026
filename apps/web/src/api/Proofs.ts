import { EpisodeEvidence } from '@ethmumbai/protocol/Errand'
import { decodeRecord, ProofList, ProofPointer, recordsCallData } from '@ethmumbai/protocol/Proof'
import { Effect, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { ApiFailure, getJson } from './Http.ts'

/**
 * The public proofs: the list and one episode's pointer come from our Worker; the episode itself, its frames and its
 * EpisodeLog record come straight from 0G (the indexer and the RPC both answer any origin), so the reader's browser
 * checks them without taking our word for it.
 */

export const listProofs = (after: string | null) =>
  getJson(after === null ? '/api/proofs' : `/api/proofs?after=${encodeURIComponent(after)}`, ProofList)

export const loadProofPointer = (episodeId: string) =>
  getJson(`/api/proofs/${encodeURIComponent(episodeId)}`, ProofPointer)

/** A file on 0G Storage by its root (the indexer's public download). */
export const storageFile = (indexerUrl: string, rootHash: string) =>
  `${indexerUrl.replace(/\/+$/, '')}/file?root=${encodeURIComponent(rootHash)}`

const zeroGFailure = (what: string) => () => ApiFailure.make({ status: 0, error: what })

const download = (url: string, what: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const response = yield* client.execute(HttpClientRequest.get(url)).pipe(Effect.mapError(zeroGFailure(what)))
    if (response.status !== 200) return yield* ApiFailure.make({ status: response.status, error: what })
    return response
  }).pipe(Effect.timeoutOrElse({ duration: '20 seconds', orElse: () => Effect.fail(zeroGFailure(what)()) }))

const decodeEvidence = Schema.decodeUnknownEffect(Schema.fromJsonString(EpisodeEvidence))

/** The episode JSON as 0G Storage holds it under `rootHash`. */
export const downloadEpisode = (indexerUrl: string, rootHash: string) =>
  download(storageFile(indexerUrl, rootHash), '0G Storage did not return the episode').pipe(
    Effect.flatMap((response) =>
      response.text.pipe(Effect.mapError(zeroGFailure('0G Storage did not return the episode'))),
    ),
    Effect.flatMap((text) =>
      decodeEvidence(text).pipe(Effect.mapError(zeroGFailure('the file on 0G Storage is not an episode'))),
    ),
  )

/** SHA-256 of a frame downloaded from 0G Storage by its root, as `0x…` lowercase hex. */
export const frameSha256 = (indexerUrl: string, rootHash: string) =>
  download(storageFile(indexerUrl, rootHash), '0G Storage did not return the frame').pipe(
    Effect.flatMap((response) =>
      response.arrayBuffer.pipe(Effect.mapError(zeroGFailure('0G Storage did not return the frame'))),
    ),
    Effect.flatMap((bytes) =>
      Effect.tryPromise({
        try: () => crypto.subtle.digest('SHA-256', bytes),
        catch: zeroGFailure('this browser cannot hash the frame'),
      }),
    ),
    Effect.map(
      (digest) => `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
    ),
  )

const RpcResult = Schema.Struct({ result: Schema.String })

/** `EpisodeLog.records(keccak256(episodeId))` by one `eth_call` to 0G Chain's public RPC. */
export const readChainRecord = (rpcUrl: string, episodeLog: string, episodeId: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const request = HttpClientRequest.post(rpcUrl).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: episodeLog, data: recordsCallData(episodeId) }, 'latest'],
      }),
    )
    const failed = zeroGFailure('0G Chain did not answer')
    const response = yield* client.execute(request).pipe(Effect.mapError(failed))
    const body = yield* response.json.pipe(Effect.mapError(failed))
    const { result } = yield* Schema.decodeUnknownEffect(RpcResult)(body).pipe(Effect.mapError(failed))
    return decodeRecord(result)
  }).pipe(
    Effect.timeoutOrElse({
      duration: '10 seconds',
      orElse: () => Effect.fail(zeroGFailure('0G Chain did not answer')()),
    }),
  )
