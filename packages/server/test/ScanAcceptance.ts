import { expect } from 'bun:test'
import { scanMessage } from '@ethmumbai/protocol/Scan'
import type { TestApi } from 'alchemy/Test/Bun'
import { Clock, Effect, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import { type Hex, sha256 } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { freshConnections, grantRow, randomId, randomPairingCode, sampleGrant } from './AgentSamples.ts'
import { readLines } from './ChipAcceptance.ts'
import { TEST_MERCHANT_PAY_TO } from './MerchantAcceptance.ts'
import { makeSoftwareAuthenticator, registerPasskey, sessionCookie } from './PasskeyFixture.ts'
import { errandView, mintInvoice, postTo, seedRobot, type ZeroGStub } from './RobotAcceptance.ts'

// Scan-initiated errands (`POST /api/chips/:robotId/scans`, spec rule 4). The native stack turns SCANS_ENABLED on only
// for its second generation (after the restart test), so the flag-off 404 runs first and everything else after it.
// Run one alone with `-t "restart|scans"`.

type Urls = { readonly appUrl: string; readonly url: string; readonly apiUrl: string }

/** The bearer token the robot seed stores (hashed) for every test robot. */
const TEST_CHIP_TOKEN = 'R'.repeat(43)

/** A JPEG-shaped crop (SOI marker first, EOI last, random in between), different on every call. */
const sampleCrop = (size = 96) => {
  const bytes = crypto.getRandomValues(new Uint8Array(size))
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0)
  bytes.set([0xff, 0xd9], size - 2)
  return bytes
}

/** A paired robot of `accountId` with a signed grant, and the throwaway key its chip signs with. */
export const seedScanningRobot = (url: string, accountId: string) =>
  Effect.gen(function* () {
    const chipKey = generatePrivateKey()
    const robotId = yield* seedRobot(url, accountId, privateKeyToAccount(chipKey).address)
    return { robotId, chipKey }
  })

interface ScanInput {
  readonly apiUrl: string
  readonly robotId: string
  readonly chipKey: Hex
  readonly invoiceId: string
  /** Each override breaks one property of an otherwise valid scan. */
  readonly frame?: Uint8Array
  readonly sha256?: Hex
  readonly capturedAt?: number
  readonly signWith?: Hex
}

/** POST a chip-signed scan as the Radxa does: EIP-191 over `scanMessage`, the crop as base64. */
const postSignedScan = (input: ScanInput) =>
  Effect.gen(function* () {
    const frame = input.frame ?? sampleCrop()
    const digest = input.sha256 ?? sha256(frame)
    const capturedAt = input.capturedAt ?? (yield* Clock.currentTimeMillis)
    const message = scanMessage(input.invoiceId, digest, capturedAt, input.robotId)
    const sig = yield* Effect.promise(() =>
      privateKeyToAccount(input.signWith ?? input.chipKey).signMessage({ message }),
    )
    const body = {
      invoiceId: input.invoiceId,
      capturedAt,
      frame: { mime: 'image/jpeg', sha256: digest, bytes: frame.length, b64: Base64.encode(frame) },
      sig,
    }
    // The scan waits on the 0G decision: straight to the API Worker, like the other long errand calls.
    const response = yield* HttpClient.post(`${input.apiUrl}/api/chips/${input.robotId}/scans`, {
      headers: { authorization: `Bearer ${TEST_CHIP_TOKEN}` },
      body: HttpBody.text(JSON.stringify(body), 'application/json'),
    })
    return { status: response.status, body: yield* response.json, sha256: digest }
  })

const Started = Schema.Struct({ episodeId: Schema.String, state: Schema.String, observationId: Schema.String })

/** A scan that must start its errand (201): the episode it started and the crop's digest. */
export const scanErrand = (input: ScanInput) =>
  postSignedScan(input).pipe(
    Effect.tap(({ status }) => Effect.sync(() => expect(status).toBe(201))),
    Effect.flatMap(({ body, sha256: digest }) =>
      Schema.decodeUnknownEffect(Started)(body).pipe(Effect.map((started) => ({ ...started, sha256: digest }))),
    ),
  )

const Observations = Schema.Struct({
  observations: Schema.Array(
    Schema.Struct({ sha256: Schema.String, hashMatches: Schema.Boolean, signerMatches: Schema.Boolean }),
  ),
})

const EvidenceObservations = Schema.Struct({
  payload: Schema.Struct({ observations: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) }),
})

/** The owner's verify of an errand: each scan's crop re-hashed from R2 and its chip signature recovered. */
const verifiedObservations = (urls: Urls, cookie: string, episodeId: string) =>
  HttpClient.post(`${urls.appUrl}/api/wallet/episodes/${episodeId}/verify`, {
    headers: { origin: new URL(urls.appUrl).origin, cookie },
  }).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(Observations)),
    Effect.map(({ observations }) => observations),
  )

const refused = (input: ScanInput) => postSignedScan(input).pipe(Effect.map(({ status, body }) => ({ status, body })))

/** Refusals that never reach the errand: wrong chip, wrong digest, too big, too old, unknown and stale invoices. */
const refusals = (urls: Urls, robot: { robotId: string; chipKey: Hex }) =>
  Effect.gen(function* () {
    const invoiceId = yield* mintInvoice(urls.appUrl)
    const base = { apiUrl: urls.apiUrl, ...robot, invoiceId }
    expect(yield* refused({ ...base, signWith: generatePrivateKey() })).toEqual({
      status: 401,
      body: { error: 'scan is not signed by this robot’s chip' },
    })
    expect(yield* refused({ ...base, sha256: sha256(sampleCrop()) })).toEqual({
      status: 400,
      body: { error: 'frame.sha256 does not match the frame' },
    })
    expect(yield* refused({ ...base, frame: sampleCrop(64 * 1024 + 1) })).toEqual({
      status: 400,
      body: { error: 'frame is larger than 64 KB' },
    })
    expect(yield* refused({ ...base, capturedAt: (yield* Clock.currentTimeMillis) - 5 * 60_000 })).toEqual({
      status: 400,
      body: { error: 'capturedAt is more than 120 s from the server clock' },
    })
    expect(yield* refused({ ...base, invoiceId: randomId() })).toEqual({
      status: 404,
      body: { error: 'unknown invoice' },
    })
    expect((yield* postTo(urls.url)(`/test/vq/invoices/${invoiceId}/expire`, {})).status).toBe(204)
    expect(yield* refused(base)).toEqual({ status: 409, body: { error: 'invoice is not open for this item' } })
  })

export const registerScansOffAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>) =>
  test(
    'scans: while SCANS_ENABLED is pending the scan route does not exist (404) and health reports scans off',
    Effect.gen(function* () {
      const { apiUrl } = yield* stack
      const response = yield* HttpClient.post(`${apiUrl}/api/chips/${randomId()}/scans`, {
        headers: { authorization: `Bearer ${TEST_CHIP_TOKEN}` },
        body: HttpBody.text('{}', 'application/json'),
      })
      expect(response.status).toBe(404)
      const health = yield* (yield* HttpClient.get(`${apiUrl}/api/health`)).json
      expect(health).toMatchObject({ features: { scans: false } })
    }).pipe(Effect.provide(freshConnections)),
    { timeout: 60000 },
  )

export const registerScanAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>, stub: ZeroGStub) =>
  test(
    'scans: a chip-signed QR crop starts the errand for that invoice, repeats are idempotent, refusals, evidence, verify',
    Effect.gen(function* () {
      const urls = yield* stack
      const { appUrl, url, apiUrl } = urls
      const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator())
      const { response } = yield* registerPasskey(appUrl, authenticator, 'Scanner')
      const { accountId } = yield* Schema.decodeUnknownEffect(Schema.Struct({ accountId: Schema.String }))(
        yield* response.json,
      )
      const cookie = sessionCookie(response)
      stub.setMode('pay')
      const robot = yield* seedScanningRobot(url, accountId)
      yield* refusals(urls, robot)

      const invoiceId = yield* mintInvoice(appUrl)
      const decisionsBefore = stub.seen.length
      const started = yield* scanErrand({ apiUrl, ...robot, invoiceId })
      expect(started.state).toBe('signing')
      // One 0G decision, over structured input only: nothing of the scan reaches 0G.
      expect(stub.seen.length).toBe(decisionsBefore + 1)
      expect(JSON.stringify(stub.seen.at(-1)?.body)).not.toContain(started.sha256)
      const again = yield* postSignedScan({ apiUrl, ...robot, invoiceId })
      expect(again).toMatchObject({
        status: 200,
        body: { episodeId: started.episodeId, observationId: started.observationId },
      })
      const signing = yield* errandView(appUrl, cookie, robot.robotId, started.episodeId)
      expect(signing.episode.invoice_id).toBe(invoiceId)

      // Paid → terminal → evidence: it carries the crop's digest and signature, never the image.
      const settledTx = `0x${'5c'.repeat(32)}`
      expect((yield* postTo(url)(`/test/vq/episodes/${started.episodeId}/settled`, { txHash: settledTx })).status).toBe(
        204,
      )
      expect((yield* errandView(appUrl, cookie, robot.robotId, started.episodeId)).episode.state).toBe('paid')
      const { payload } = yield* Schema.decodeUnknownEffect(EvidenceObservations)(
        yield* (yield* HttpClient.get(`${appUrl}/api/evidence/${started.episodeId}`)).json,
      )
      expect(payload.observations).toHaveLength(1)
      expect(Object.keys(payload.observations[0] ?? {}).toSorted()).toEqual([
        'bytes',
        'capturedAt',
        'chipSig',
        'sha256',
      ])
      expect(payload.observations[0]).toMatchObject({ sha256: started.sha256, bytes: 96 })

      expect(yield* verifiedObservations(urls, cookie, started.episodeId)).toEqual([
        { sha256: started.sha256, hashMatches: true, signerMatches: true },
      ])
      const key = `observations/${robot.robotId}/${started.episodeId}/${started.sha256}.jpg`
      expect((yield* postTo(url)('/test/vq/media', { key, text: 'not the crop the chip signed' })).status).toBe(204)
      expect(yield* verifiedObservations(urls, cookie, started.episodeId)).toEqual([
        { sha256: started.sha256, hashMatches: false, signerMatches: true },
      ])
    }).pipe(Effect.provide(freshConnections)),
    { timeout: 120000 },
  )

/** A free port on 127.0.0.1 for the chip's listener. */
const freePort = Effect.promise(async () => {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(null, { status: 404 }) })
  const port = probe.port ?? 0
  await probe.stop(true)
  return port
})

/** An unpaired robot with a pairing code, granted to the chip key the CLI will load from its state directory. */
const seedPairableRobot = Effect.fnUntraced(function* (url: string, accountId: string, chip: Hex) {
  const robotId = randomId()
  const pairingCode = randomPairingCode()
  const post = postTo(url)
  const robot = { id: robotId, accountId, pairingCode, chipAddress: null, chipToken: null }
  expect((yield* post('/test/vq/robots', robot)).status).toBe(204)
  const delegation = sampleGrant(chip, TEST_MERCHANT_PAY_TO)
  const grant = grantRow({ robotId, accountId, delegation, payee: TEST_MERCHANT_PAY_TO })
  expect((yield* post('/test/vq/grants', grant)).status).toBe(204)
  return { robotId, pairingCode }
})

const postLocal = (port: number, body: unknown) =>
  HttpClient.post(`http://127.0.0.1:${port}/scan`, {
    body: HttpBody.text(JSON.stringify(body), 'application/json'),
  }).pipe(Effect.flatMap((response) => Effect.map(response.json, (json) => ({ status: response.status, json }))))

export const registerChipScanListenerAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>) =>
  test(
    'scans: the chip CLI pairs, and its 127.0.0.1 --local-port listener hashes, signs and forwards a camera crop',
    Effect.gen(function* () {
      const { appUrl, url, apiUrl } = yield* stack
      const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator())
      const { response } = yield* registerPasskey(appUrl, authenticator, 'Listener')
      const { accountId } = yield* Schema.decodeUnknownEffect(Schema.Struct({ accountId: Schema.String }))(
        yield* response.json,
      )
      const key = generatePrivateKey()
      const state = `/tmp/vq-chip-${randomId()}`
      yield* Effect.promise(() => Bun.write(`${state}/key.json`, JSON.stringify({ privateKey: key })))
      const { robotId, pairingCode } = yield* seedPairableRobot(url, accountId, privateKeyToAccount(key).address)
      const port = yield* freePort
      const cli = ['bun', 'apps/chip/src/main.ts', '--server', apiUrl, '--pair', pairingCode, '--state', state]
      const chip = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.spawn([...cli, '--local-port', String(port)], {
            cwd: `${import.meta.dir}/../../..`,
            stdout: 'pipe',
            stderr: 'pipe',
          }),
        ),
        (process) => Effect.sync(() => process.kill()),
      )
      const started = yield* Clock.currentTimeMillis
      const lines = yield* Effect.promise(() => readLines(chip.stdout, /scan listener on/, started + 15_000))
      expect(lines).toContain(`paired ${robotId}`)
      expect(lines).toContain(`scan listener on http://127.0.0.1:${port}/scan`)

      const invoiceId = yield* mintInvoice(appUrl)
      expect(yield* postLocal(port, { invoiceId, jpegBase64: Base64.encode(Uint8Array.from([1, 2, 3])) })).toEqual({
        status: 400,
        json: { error: 'crop is not a JPEG' },
      })
      const forwarded = yield* postLocal(port, { invoiceId, jpegBase64: Base64.encode(sampleCrop()) })
      expect(forwarded).toMatchObject({ status: 201, json: { state: 'signing' } })
      expect((yield* Schema.decodeUnknownEffect(Started)(forwarded.json)).observationId).toMatch(/^[a-z2-7]{26}$/)
      const logged = (yield* Effect.promise(() =>
        readLines(chip.stdout, /scan \S+ 0x[0-9a-f]{8}… → 201/, started + 25_000),
      )).join('\n')
      expect(logged).toMatch(new RegExp(`scan ${invoiceId} 0x[0-9a-f]{8}… → 201`))
      expect([...lines, logged].join('\n')).not.toContain(key.slice(2))
    }).pipe(Effect.scoped, Effect.provide(freshConnections)),
    { timeout: 60000 },
  )
