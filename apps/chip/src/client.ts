import { PairResponse, PollResponse, type RefusalCode, type SignRequest } from '@ethmumbai/protocol/Chip'
import type { Hex } from '@ethmumbai/protocol/Hex'
import { FRAME_MAX_BYTES, frameMessage, type FrameRequest } from '@ethmumbai/protocol/Frame'
import { scanMessage, type ScanRequest } from '@ethmumbai/protocol/Scan'
import { Clock, Data, Effect, Ref, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { sha256 } from 'viem'
import { approvalDigestFor, checkLease, evaluate } from './policy.ts'
import { recoverDigestSigner, type Signer } from './signer.ts'
import { type ChipState, dayOf, type PairingFile } from './state.ts'

// The chip's side of the chip protocol (spec §8), platform-agnostic: pairing, the long-poll, the policy-then-sign
// answer, the response and the signed scan. It runs on any `HttpClient` and any `ChipState`: the Bun CLI (main.ts,
// files) and the browser sim chip (apps/sim, IndexedDB). It reports what happens as `ChipEvent`s and never carries the
// key, the chip token or a signature in one.

export class ChipFailure extends Schema.TaggedError<ChipFailure>()('ChipFailure', { message: Schema.String }) {}

/** Everything the chip reports; the host turns these into log lines (main.ts) or UI (the sim). */
export type ChipEvent = Data.TaggedEnum<{
  LeaseOk: {}
  LeaseExpired: {}
  Signed: { readonly invoiceId: string }
  Refused: { readonly invoiceId: string; readonly code: RefusalCode; readonly detail: string }
  Payment: { readonly status: string; readonly txHash: string | undefined; readonly reason: string | undefined }
  ResponseRejected: { readonly requestId: string; readonly status: number }
  ResponseFailed: { readonly requestId: string; readonly message: string }
  /** A failed poll; only the first of a run of network failures is reported. */
  PollFailed: { readonly message: string }
}>
export const ChipEvent = Data.taggedEnum<ChipEvent>()

export type Report = (event: ChipEvent) => Effect.Effect<void>

const nowSeconds = Effect.map(Clock.currentTimeMillis, (millis) => Math.floor(millis / 1000))

const postJson = (url: string, body: unknown, token?: string) =>
  HttpClient.execute(
    HttpClientRequest.post(url).pipe(
      HttpClientRequest.bodyJsonUnsafe(body),
      token === undefined ? (request) => request : HttpClientRequest.bearerToken(token),
    ),
  )

/** Pair with `origin` (the PUBLIC app origin: invoices must live under it, or every payment is `bad_invoice_origin`). */
export const pair = Effect.fnUntraced(function* (origin: string, code: string, signer: Signer) {
  const sig = yield* signer.signPairing(code)
  const response = yield* postJson(`${origin}/api/chips/pair`, { pairingCode: code, address: signer.address, sig })
  if (response.status !== 200)
    return yield* new ChipFailure({ message: `pairing refused (${response.status}): ${yield* response.text}` })
  const paired = yield* Schema.decodeUnknownEffect(PairResponse)(yield* response.json)
  return { server: origin, robotId: paired.robotId, chipToken: paired.chipToken } satisfies PairingFile
})

export type Answer =
  | { readonly requestId: string; readonly ok: true; readonly signature: string; readonly leafHash: string }
  | {
      readonly requestId: string
      readonly ok: false
      readonly refused: { readonly code: RefusalCode; readonly detail: string }
    }

/** Policy first; the key is touched only for a request that passes every check. */
export const answer = <E>(request: SignRequest, signer: Signer, state: ChipState<E>, origin: string, report: Report) =>
  Effect.gen(function* () {
    const now = yield* nowSeconds
    const digest = approvalDigestFor(request)
    const approvalSigner =
      digest === undefined || request.approval === null
        ? undefined
        : yield* recoverDigestSigner(digest, request.approval.signature)
    const verdict = evaluate(request, {
      chip: signer.address,
      allowedOrigin: origin,
      nowSeconds: now,
      usedInvoiceHashes: yield* state.usedInvoices,
      spentToday: yield* state.spentOn(dayOf(now)),
      approvalSigner,
    })
    if (!verdict.ok) {
      yield* report(ChipEvent.Refused({ invoiceId: request.invoice.id, code: verdict.code, detail: verdict.detail }))
      return {
        requestId: request.id,
        ok: false,
        refused: { code: verdict.code, detail: verdict.detail },
      } satisfies Answer
    }
    const { signature, leafHash } = yield* signer.signLeaf(verdict.leaf)
    yield* state.recordSigned(request.invoice.invoiceHash, verdict.amount, dayOf(now))
    yield* report(ChipEvent.Signed({ invoiceId: request.invoice.id }))
    return { requestId: request.id, ok: true, signature, leafHash } satisfies Answer
  })

const PaymentAck = Schema.Struct({
  payment: Schema.Struct({
    status: Schema.String,
    txHash: Schema.optionalKey(Schema.String),
    reason: Schema.optionalKey(Schema.String),
  }),
})

/** POST the answer; the Worker settles inside this request (up to a minute for the receipt). */
export const respond = Effect.fnUntraced(function* (pairing: PairingFile, result: Answer, report: Report) {
  const url = `${pairing.server}/api/chips/${pairing.robotId}/responses`
  const response = yield* postJson(url, result, pairing.chipToken)
  if (response.status !== 200)
    return yield* report(ChipEvent.ResponseRejected({ requestId: result.requestId, status: response.status }))
  const ack = yield* Schema.decodeUnknownEffect(PaymentAck)(yield* response.json)
  const { status, txHash, reason } = ack.payment
  yield* report(ChipEvent.Payment({ status, txHash, reason }))
})

export interface Lease {
  /** Local-clock deadline in ms. */
  readonly until: Ref.Ref<number>
  readonly stopped: Ref.Ref<boolean>
}

/** STOP once when the lease runs out; the next successful poll resumes (spec §8). */
export const watchLease = (lease: Lease, report: Report) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const expired = now > (yield* Ref.get(lease.until))
    if (expired && !(yield* Ref.getAndSet(lease.stopped, true))) yield* report(ChipEvent.LeaseExpired())
  }).pipe(Effect.andThen(Effect.sleep('1 second')), Effect.forever)

const leaseRefusal = (lease: Lease) =>
  Effect.map(Effect.all([Clock.currentTimeMillis, Ref.get(lease.until)]), ([now, until]) => checkLease(now, until))

/** One held poll: renews the lease and returns the sign requests. A 401 means the chip token is gone. */
export const pollOnce = Effect.fnUntraced(function* (pairing: PairingFile, lease: Lease, report: Report) {
  const response = yield* HttpClient.execute(
    HttpClientRequest.get(`${pairing.server}/api/chips/${pairing.robotId}/poll`).pipe(
      HttpClientRequest.bearerToken(pairing.chipToken),
    ),
  ).pipe(Effect.timeout('35 seconds'))
  if (response.status === 401)
    return yield* new ChipFailure({ message: 'chip token rejected (401): pair again with --pair CODE' })
  if (response.status !== 200) return yield* new ChipFailure({ message: `poll answered ${response.status}` })
  const poll = yield* Schema.decodeUnknownEffect(PollResponse)(yield* response.json)
  const now = yield* Clock.currentTimeMillis
  yield* Ref.set(lease.until, now + (poll.lease.until - poll.serverTime))
  if (yield* Ref.getAndSet(lease.stopped, false)) yield* report(ChipEvent.LeaseOk())
  return poll.requests
})

/** Poll, answer and respond forever; fails only with the 401 `ChipFailure` (pair again). */
export const serve = <E>(pairing: PairingFile, signer: Signer, state: ChipState<E>, report: Report) =>
  Effect.gen(function* () {
    const lease: Lease = { until: yield* Ref.make(0), stopped: yield* Ref.make(true) }
    yield* Effect.forkChild(watchLease(lease, report))
    const failures = yield* Ref.make(0)
    const step = pollOnce(pairing, lease, report).pipe(
      Effect.tap(() => Ref.set(failures, 0)),
      Effect.flatMap((requests) =>
        Effect.forEach(requests, (request) =>
          Effect.gen(function* () {
            const refusal = yield* leaseRefusal(lease)
            const result: Answer =
              refusal === undefined
                ? yield* answer(request, signer, state, pairing.server, report)
                : { requestId: request.id, ok: false, refused: { code: refusal.code, detail: refusal.detail } }
            // The Worker settles inside this POST (up to a minute for the receipt): answer in the background and keep
            // polling, so the lease never lapses while a payment lands.
            yield* Effect.forkChild(
              respond(pairing, result, report).pipe(
                Effect.timeout('90 seconds'),
                Effect.catch((error) =>
                  report(ChipEvent.ResponseFailed({ requestId: result.requestId, message: String(error) })),
                ),
              ),
            )
          }),
        ),
      ),
      Effect.catch((error) => {
        if (error instanceof ChipFailure)
          return error.message.includes('401')
            ? Effect.fail(error)
            : report(ChipEvent.PollFailed({ message: error.message })).pipe(Effect.andThen(Effect.sleep('2 seconds')))
        return Ref.getAndUpdate(failures, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count === 0 ? report(ChipEvent.PollFailed({ message: `poll failed: ${String(error)}` })) : Effect.void,
          ),
          Effect.andThen(Effect.sleep('2 seconds')),
        )
      }),
    )
    return yield* Effect.forever(step)
  })

/** The chip signs no more than a QR crop (spec rule 4, the Worker's limit too), checked before the key is touched. */
export const MAX_SCAN_BYTES = 64 * 1024

/** Why `bytes` is not a crop the chip signs (a JPEG of at most 64 KB), or undefined if it is. */
export const cropProblem = (bytes: Uint8Array) =>
  bytes.length > MAX_SCAN_BYTES
    ? 'crop is larger than 64 KB'
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? undefined
      : 'crop is not a JPEG'

/** The scan body for `POST /api/chips/:robotId/scans`: the crop's SHA-256, signed EIP-191 over `scanMessage`. */
export const signScan = Effect.fnUntraced(function* (
  pairing: PairingFile,
  signer: Signer,
  invoiceId: string,
  jpeg: Uint8Array,
  capturedAt: number,
) {
  const problem = cropProblem(jpeg)
  if (problem !== undefined) return yield* new ChipFailure({ message: problem })
  const digest: Hex = sha256(jpeg)
  const sig = yield* signer.signScan(scanMessage(invoiceId, digest, capturedAt, pairing.robotId))
  return {
    invoiceId,
    capturedAt,
    frame: { mime: 'image/jpeg', sha256: digest, bytes: jpeg.length, b64: Base64.encode(jpeg) },
    sig,
  } satisfies ScanRequest
})

/** Forward a signed scan to the Worker; the caller reads the status and JSON. */
export const postScan = (pairing: PairingFile, body: ScanRequest) =>
  postJson(`${pairing.server}/api/chips/${pairing.robotId}/scans`, body, pairing.chipToken).pipe(
    Effect.timeout('60 seconds'),
  )

/** Why `bytes` is not a live frame the chip signs (a JPEG of at most 64 KB), or undefined if it is. */
export const frameProblem = (bytes: Uint8Array) =>
  bytes.length > FRAME_MAX_BYTES
    ? 'frame is larger than 64 KB'
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? undefined
      : 'frame is not a JPEG'

/** The live frame body for `POST /api/chips/:robotId/frames`: the JPEG's SHA-256, signed EIP-191 over `frameMessage`. */
export const signFrame = Effect.fnUntraced(function* (
  pairing: PairingFile,
  signer: Signer,
  jpeg: Uint8Array,
  capturedAt: number,
) {
  const problem = frameProblem(jpeg)
  if (problem !== undefined) return yield* new ChipFailure({ message: problem })
  const digest: Hex = sha256(jpeg)
  const sig = yield* signer.signFrame(frameMessage(pairing.robotId, digest, capturedAt))
  return {
    capturedAt,
    frame: { mime: 'image/jpeg', sha256: digest, bytes: jpeg.length, b64: Base64.encode(jpeg) },
    sig,
  } satisfies FrameRequest
})

/**
 * Forward a signed live frame to the Worker; the caller reads the status and JSON. Unlike every other chip call it
 * reuses the connection: frames come about once a second, so the socket never idles long enough for a hotspot to drop
 * it, and a new TLS handshake per frame was most of its ~2 s. A reset socket costs one frame; the next one reconnects.
 */
export const postFrame = (pairing: PairingFile, body: FrameRequest) =>
  postJson(`${pairing.server}/api/chips/${pairing.robotId}/frames`, body, pairing.chipToken).pipe(
    Effect.timeout('10 seconds'),
    Effect.provideService(FetchHttpClient.RequestInit, {}),
  )
