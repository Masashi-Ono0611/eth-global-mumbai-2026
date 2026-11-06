import * as BunRuntime from '@effect/platform-bun/BunRuntime'
import * as BunServices from '@effect/platform-bun/BunServices'
import { PairResponse, PollResponse, type SignRequest } from '@ethmumbai/protocol/Chip'
import { Clock, Console, Effect, Layer, Option, Ref, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { approvalDigestFor, checkLease, evaluate } from './policy.ts'
import { loadOrCreateKey, makeSigner, recoverDigestSigner, type Signer } from './signer.ts'
import { type ChipState, dayOf, makeState, type PairingFile } from './state.ts'

// The mock chip (spec §8): `bun apps/chip/src/main.ts --server <URL> [--pair CODE] [--state DIR]`. One log line per
// event; never the key, the chip token or a signature.

class ChipFailure extends Schema.TaggedError<ChipFailure>()('ChipFailure', { message: Schema.String }) {}

const usage = 'usage: bun apps/chip/src/main.ts --server <URL> [--pair CODE] [--state DIR]'

const parseArgs = (argv: ReadonlyArray<string>, home: string) => {
  const value = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const server = value('--server')
  if (server === undefined) return undefined
  return {
    origin: new URL(server).origin,
    pairingCode: value('--pair'),
    stateDir: value('--state') ?? `${home}/.vitaquack-chip`,
  }
}

const log = (line: string) => Console.log(line)
const nowSeconds = Effect.map(Clock.currentTimeMillis, (millis) => Math.floor(millis / 1000))

const postJson = (url: string, body: unknown, token?: string) =>
  HttpClient.execute(
    HttpClientRequest.post(url).pipe(
      HttpClientRequest.bodyJsonUnsafe(body),
      token === undefined ? (request) => request : HttpClientRequest.bearerToken(token),
    ),
  )

const pair = Effect.fnUntraced(function* (origin: string, code: string, signer: Signer) {
  const sig = yield* signer.signPairing(code)
  const response = yield* postJson(`${origin}/api/chips/pair`, { pairingCode: code, address: signer.address, sig })
  if (response.status !== 200)
    return yield* new ChipFailure({ message: `pairing refused (${response.status}): ${yield* response.text}` })
  const paired = yield* Schema.decodeUnknownEffect(PairResponse)(yield* response.json)
  return { server: origin, robotId: paired.robotId, chipToken: paired.chipToken } satisfies PairingFile
})

type Answer =
  | { readonly requestId: string; readonly ok: true; readonly signature: string; readonly leafHash: string }
  | {
      readonly requestId: string
      readonly ok: false
      readonly refused: { readonly code: string; readonly detail: string }
    }

/** Policy first; the key is touched only for a request that passes every check. */
const answer = Effect.fnUntraced(function* (request: SignRequest, signer: Signer, state: ChipState, origin: string) {
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
    yield* log(`refused ${request.invoice.id} ${verdict.code}: ${verdict.detail}`)
    return {
      requestId: request.id,
      ok: false,
      refused: { code: verdict.code, detail: verdict.detail },
    } satisfies Answer
  }
  const { signature, leafHash } = yield* signer.signLeaf(verdict.leaf)
  yield* state.recordSigned(request.invoice.invoiceHash, verdict.amount, dayOf(now))
  yield* log(`signed ${request.invoice.id}`)
  return { requestId: request.id, ok: true, signature, leafHash } satisfies Answer
})

const PaymentAck = Schema.Struct({
  payment: Schema.Struct({
    status: Schema.String,
    txHash: Schema.optionalKey(Schema.String),
    reason: Schema.optionalKey(Schema.String),
  }),
})

const respond = Effect.fnUntraced(function* (pairing: PairingFile, result: Answer) {
  const url = `${pairing.server}/api/chips/${pairing.robotId}/responses`
  const response = yield* postJson(url, result, pairing.chipToken)
  if (response.status !== 200) return yield* log(`response rejected (${response.status}) for ${result.requestId}`)
  const ack = yield* Schema.decodeUnknownEffect(PaymentAck)(yield* response.json)
  const { status, txHash, reason } = ack.payment
  yield* log(`payment ${status}${txHash === undefined ? '' : ` ${txHash}`}${reason === undefined ? '' : `: ${reason}`}`)
})

interface Lease {
  /** Local-clock deadline in ms. */
  readonly until: Ref.Ref<number>
  readonly stopped: Ref.Ref<boolean>
}

/** STOP once when the lease runs out; the next successful poll resumes (spec §8). */
const watchLease = (lease: Lease) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const expired = now > (yield* Ref.get(lease.until))
    if (expired && !(yield* Ref.getAndSet(lease.stopped, true))) yield* log('STOP motors (lease expired)')
  }).pipe(Effect.andThen(Effect.sleep('1 second')), Effect.forever)

const leaseRefusal = (lease: Lease) =>
  Effect.map(Effect.all([Clock.currentTimeMillis, Ref.get(lease.until)]), ([now, until]) => checkLease(now, until))

const pollOnce = Effect.fnUntraced(function* (pairing: PairingFile, lease: Lease) {
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
  if (yield* Ref.getAndSet(lease.stopped, false)) yield* log('lease ok')
  return poll.requests
})

const serve = Effect.fnUntraced(function* (pairing: PairingFile, signer: Signer, state: ChipState) {
  const lease: Lease = { until: yield* Ref.make(0), stopped: yield* Ref.make(true) }
  yield* Effect.forkChild(watchLease(lease))
  const failures = yield* Ref.make(0)
  const step = pollOnce(pairing, lease).pipe(
    Effect.tap(() => Ref.set(failures, 0)),
    Effect.flatMap((requests) =>
      Effect.forEach(requests, (request) =>
        Effect.gen(function* () {
          const refusal = yield* leaseRefusal(lease)
          const result: Answer =
            refusal === undefined
              ? yield* answer(request, signer, state, pairing.server)
              : { requestId: request.id, ok: false, refused: { code: refusal.code, detail: refusal.detail } }
          yield* respond(pairing, result)
        }),
      ),
    ),
    Effect.catchTag('ChipFailure', (failure) =>
      failure.message.includes('401')
        ? Effect.fail(failure)
        : log(failure.message).pipe(Effect.andThen(Effect.sleep('2 seconds'))),
    ),
    Effect.catch((error) =>
      Ref.getAndUpdate(failures, (count) => count + 1).pipe(
        Effect.flatMap((count) => (count === 0 ? log(`poll failed: ${String(error)}`) : Effect.void)),
        Effect.andThen(Effect.sleep('2 seconds')),
      ),
    ),
  )
  return yield* Effect.forever(step)
})

const main = Effect.fnUntraced(function* (argv: ReadonlyArray<string>, home: string) {
  const args = parseArgs(argv, home)
  if (args === undefined) return yield* new ChipFailure({ message: usage })
  const state = yield* makeState(args.stateDir)
  const key = yield* loadOrCreateKey(state)
  const signer = makeSigner(key.privateKey)
  yield* log(`chip ${signer.address}${key.created ? ' (new key)' : ''}`)
  const pairing =
    args.pairingCode === undefined
      ? Option.getOrUndefined(yield* state.readPairing)
      : yield* pair(args.origin, args.pairingCode, signer)
  if (pairing === undefined) return yield* new ChipFailure({ message: `not paired: ${usage}` })
  if (args.pairingCode !== undefined) {
    yield* state.writePairing(pairing)
    yield* log(`paired ${pairing.robotId}`)
  }
  if (pairing.server !== args.origin)
    return yield* new ChipFailure({ message: `paired with ${pairing.server}, not ${args.origin}` })
  return yield* serve(pairing, signer, state)
})

main(process.argv.slice(2), process.env.HOME ?? '.').pipe(
  Effect.catchTag('ChipFailure', (failure) =>
    Console.error(failure.message).pipe(Effect.andThen(Effect.fail(failure))),
  ),
  // No keep-alive: phone hotspots and proxies drop idle sockets, and a pooled socket reused after a 25 s hold resets.
  Effect.provide(
    Layer.mergeAll(
      BunServices.layer,
      FetchHttpClient.layer,
      Layer.succeed(FetchHttpClient.RequestInit, { keepalive: false }),
    ),
  ),
  BunRuntime.runMain,
)
