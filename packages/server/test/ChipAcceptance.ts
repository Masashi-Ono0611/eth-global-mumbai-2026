import { expect } from 'bun:test'
import { pairMessage, PairResponse, PollResponse } from '@ethmumbai/protocol/Chip'
import type { TestApi } from 'alchemy/Test/Bun'
import { Clock, Effect, Fiber, Schema } from 'effect'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { freshConnections, randomId, randomPairingCode, sampleSignRequest } from './AgentSamples.ts'
import { TEST_MERCHANT_PAY_TO } from './MerchantAcceptance.ts'

type Urls = { readonly appUrl: string; readonly url: string; readonly apiUrl: string }

// Throwaway chip keys, fresh per run: D1 keeps `robots.chip_address` unique across tests and reruns.
const chip = privateKeyToAccount(generatePrivateKey())
const impostor = privateKeyToAccount(generatePrivateKey())

const postJson = (url: string, body: unknown, token?: string) =>
  HttpClient.post(url, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    body: HttpBody.text(JSON.stringify(body), 'application/json'),
  })

const poll = (appUrl: string, robotId: string, token: string) =>
  HttpClient.get(`${appUrl}/api/chips/${robotId}/poll`, { headers: { authorization: `Bearer ${token}` } })

const seedRobot = (url: string, robotId: string, pairingCode: string) =>
  postJson(`${url}/test/vq/robots`, {
    id: robotId,
    accountId: 'native-account',
    pairingCode,
    chipAddress: null,
    chipToken: null,
  })

/** M4 acceptance (server): pair → 409 on reuse → 401 on a bad token → a queued request is delivered to a held poll → one response accepted → an empty poll returns within 25 s with a 35 s lease. */
export const registerChipAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>) =>
  test(
    'chip protocol: pairing, bearer token, long-poll delivery, lease and single response',
    Effect.gen(function* () {
      const { appUrl, url, apiUrl } = yield* stack
      const robotId = randomId()
      const code = randomPairingCode()
      expect((yield* seedRobot(url, robotId, code)).status).toBe(204)
      const forged = yield* postJson(`${appUrl}/api/chips/pair`, {
        pairingCode: code,
        address: chip.address,
        sig: yield* Effect.promise(() => impostor.signMessage({ message: pairMessage(code, chip.address) })),
      })
      expect(forged.status).toBe(401)
      const pairBody = {
        pairingCode: code,
        address: chip.address,
        sig: yield* Effect.promise(() => chip.signMessage({ message: pairMessage(code, chip.address) })),
      }
      const paired = yield* postJson(`${appUrl}/api/chips/pair`, pairBody)
      expect(paired.status).toBe(200)
      const { chipToken } = yield* Schema.decodeUnknownEffect(PairResponse)(yield* paired.json)
      expect((yield* postJson(`${appUrl}/api/chips/pair`, pairBody)).status).toBe(409)
      const unknown = {
        pairingCode: 'ZZZZZZZZ',
        address: chip.address,
        sig: yield* Effect.promise(() => chip.signMessage({ message: pairMessage('ZZZZZZZZ', chip.address) })),
      }
      expect((yield* postJson(`${appUrl}/api/chips/pair`, unknown)).status).toBe(404)
      expect((yield* poll(appUrl, robotId, 'A'.repeat(43))).status).toBe(401)

      // Held polls go to the API Worker's own URL: in the full local suite alchemy's edge → API service-binding proxy
      // has reset a response that arrived after a hold (ECONNRESET); the deployed edge is checked on the deploy.
      const started = yield* Clock.currentTimeMillis
      const held = yield* Effect.forkChild(
        poll(apiUrl, robotId, chipToken).pipe(Effect.flatMap((response) => response.json)),
      )
      yield* Effect.sleep('2 seconds')
      const request = sampleSignRequest({
        chip: chip.address,
        origin: appUrl,
        payTo: TEST_MERCHANT_PAY_TO,
        amount: '100000',
      })
      const queued = yield* postJson(`${url}/test/vq/chip-requests`, {
        id: request.id,
        robotId,
        episodeId: randomId(),
        payloadJson: JSON.stringify(request),
        expiresAt: request.expiresAt,
      })
      expect(queued.status).toBe(204)
      const delivered = yield* Schema.decodeUnknownEffect(PollResponse)(yield* Fiber.join(held))
      expect((yield* Clock.currentTimeMillis) - started).toBeLessThan(10_000)
      expect(delivered.requests.map((item) => item.id)).toEqual([request.id])
      expect(delivered.lease.until - delivered.serverTime).toBe(35_000)

      const refusal = { requestId: request.id, ok: false, refused: { code: 'no_grant', detail: 'acceptance' } }
      const answered = yield* postJson(`${appUrl}/api/chips/${robotId}/responses`, refusal, chipToken)
      expect(answered.status).toBe(200)
      expect(yield* answered.json).toEqual({ accepted: true, payment: { status: 'failed', reason: 'no_grant' } })
      expect((yield* postJson(`${appUrl}/api/chips/${robotId}/responses`, refusal, chipToken)).status).toBe(409)

      const emptyStarted = yield* Clock.currentTimeMillis
      const empty = yield* Schema.decodeUnknownEffect(PollResponse)(
        yield* (yield* poll(apiUrl, robotId, chipToken)).json,
      )
      const observed = (yield* Clock.currentTimeMillis) - emptyStarted
      expect(empty.requests).toEqual([])
      expect(observed).toBeGreaterThan(20_000)
      // The Worker answers after its 25 s hold (its serverTime, same host clock); a loaded local proxy may add delivery
      // latency on top, which is not the Worker's hold.
      expect(empty.serverTime - emptyStarted).toBeLessThanOrEqual(27_000)
    }).pipe(Effect.provide(freshConnections)),
    { timeout: 90000 },
  )

const ChipAnswer = Schema.Struct({
  requestId: Schema.String,
  ok: Schema.Literal(true),
  signature: Schema.String,
  leafHash: Schema.String,
})

/** A stand-in Worker for the mock chip: pairs, hands out one sign request with a 4 s lease, then goes silent. */
const fakeWorker = (chipAddress: `0x${string}`) => {
  const answers: unknown[] = []
  let polls = 0
  let request: ReturnType<typeof sampleSignRequest> | undefined
  const robotId = randomId()
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (incoming) => {
      const path = new URL(incoming.url).pathname
      if (path === '/api/chips/pair')
        return Response.json({ robotId, chipToken: 'A'.repeat(43), serverTime: Date.now() })
      if (path === `/api/chips/${robotId}/poll`) {
        polls += 1
        if (polls > 1) return new Promise<Response>(() => {})
        request = sampleSignRequest({
          chip: chipAddress,
          origin: `http://127.0.0.1:${server.port}`,
          payTo: TEST_MERCHANT_PAY_TO,
          amount: '100000',
        })
        return Response.json({ serverTime: Date.now(), lease: { until: Date.now() + 4000 }, requests: [request] })
      }
      if (path === `/api/chips/${robotId}/responses`) {
        answers.push(await incoming.json())
        return Response.json({ accepted: true, payment: { status: 'settled', txHash: `0x${'5e'.repeat(32)}` } })
      }
      return new Response('not found', { status: 404 })
    },
  })
  return { server, answers, robotId, request: () => request }
}

/** Read the chip's stdout until `done` matches a line or the deadline passes. */
const readLines = async (stream: ReadableStream<Uint8Array>, done: RegExp, deadline: number) => {
  const lines: string[] = []
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (Date.now() < deadline && !lines.some((line) => done.test(line))) {
    const chunk = await Promise.race([reader.read(), Bun.sleep(deadline - Date.now()).then(() => undefined)])
    if (chunk === undefined || chunk.done) break
    buffer += decoder.decode(chunk.value)
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    lines.push(...parts)
  }
  reader.releaseLock()
  return lines
}

/** Spawn the real CLI against the fake Worker and collect its log until it stops its motors. */
const runMockChip = async () => {
  const key = `0x${'c3'.repeat(32)}` as const
  const account = privateKeyToAccount(key)
  const state = `/tmp/vq-chip-${randomId()}`
  await Bun.write(`${state}/key.json`, JSON.stringify({ privateKey: key }))
  const fake = fakeWorker(account.address)
  const origin = `http://127.0.0.1:${fake.server.port}`
  const chipProcess = Bun.spawn(
    ['bun', 'apps/chip/src/main.ts', '--server', origin, '--pair', 'K7Q2M9XZ', '--state', state],
    { cwd: `${import.meta.dir}/../../..`, stdout: 'pipe', stderr: 'pipe' },
  )
  const lines = await readLines(chipProcess.stdout, /STOP motors \(lease expired\)/, Date.now() + 20_000)
  chipProcess.kill()
  await fake.server.stop(true)
  const invoiceId = fake.request()?.invoice.id
  expect(lines).toContain(`chip ${account.address}`)
  expect(lines).toContain(`paired ${fake.robotId}`)
  expect(lines).toContain('lease ok')
  expect(lines).toContain(`signed ${invoiceId}`)
  expect(lines).toContain(`payment settled 0x${'5e'.repeat(32)}`)
  expect(lines).toContain('STOP motors (lease expired)')
  expect(lines.join('\n')).not.toContain(key.slice(2))
  const answer = Schema.decodeUnknownSync(ChipAnswer)(fake.answers[0])
  expect(lines.join('\n')).not.toContain(answer.signature.slice(2))
  expect(((await Bun.file(`${state}/key.json`).stat()).mode & 0o777).toString(8)).toBe('600')
  expect(JSON.parse(await Bun.file(`${state}/pairing.json`).text())).toMatchObject({
    server: origin,
    robotId: fake.robotId,
  })
}

/** M4 acceptance (mock chip CLI): `paired`, `lease ok`, `signed <invoiceId>`, then `STOP motors (lease expired)` once the Worker goes silent; key.json stays mode 600. */
export const registerMockChipAcceptance = (test: TestApi['test']) =>
  test(
    'mock chip: pairs, signs a valid invoice, reports the payment and stops when the lease runs out',
    Effect.promise(runMockChip),
    { timeout: 40000 },
  )
