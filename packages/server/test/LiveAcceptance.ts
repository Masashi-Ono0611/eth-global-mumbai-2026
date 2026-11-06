import { expect } from 'bun:test'
import { frameMessage } from '@ethmumbai/protocol/Frame'
import { scanMessage } from '@ethmumbai/protocol/Scan'
import type { TestApi } from 'alchemy/Test/Bun'
import { Clock, Effect, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import { sha256 } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { freshConnections, randomId } from './AgentSamples.ts'
import { makeSoftwareAuthenticator, registerPasskey, sessionCookie } from './PasskeyFixture.ts'
import { sampleCrop, seedScanningRobot, TEST_CHIP_TOKEN } from './ScanAcceptance.ts'

// The robot's live camera view (`POST /api/chips/:robotId/frames`, `GET /api/robots/:id/live[/frame]`, LIVE_ENABLED).
// Like scans, the native stack turns the flag on only for its second generation, so the flag-off 404 runs first.

type Urls = { readonly appUrl: string; readonly url: string; readonly apiUrl: string }

interface FrameInput {
  readonly apiUrl: string
  readonly robotId: string
  readonly chipKey: `0x${string}`
  readonly frame?: Uint8Array
  /** Sign the scan message instead of the frame message (a frame must never pass as a scan, nor the reverse). */
  readonly asScan?: boolean
  readonly signWith?: `0x${string}`
}

/** POST a chip-signed live frame as the chip does: EIP-191 over `frameMessage`, the JPEG as base64. */
const postFrame = (input: FrameInput) =>
  Effect.gen(function* () {
    const frame = input.frame ?? sampleCrop(2048)
    const digest = sha256(frame)
    const capturedAt = yield* Clock.currentTimeMillis
    const message =
      input.asScan === true
        ? scanMessage(randomId(), digest, capturedAt, input.robotId)
        : frameMessage(input.robotId, digest, capturedAt)
    const sig = yield* Effect.promise(() =>
      privateKeyToAccount(input.signWith ?? input.chipKey).signMessage({ message }),
    )
    const body = {
      capturedAt,
      frame: { mime: 'image/jpeg', sha256: digest, bytes: frame.length, b64: Base64.encode(frame) },
      sig,
    }
    const response = yield* HttpClient.post(`${input.apiUrl}/api/chips/${input.robotId}/frames`, {
      headers: { authorization: `Bearer ${TEST_CHIP_TOKEN}` },
      body: HttpBody.text(JSON.stringify(body), 'application/json'),
    })
    return { status: response.status, body: yield* response.json, sha256: digest, frame }
  })

const LiveMeta = Schema.Struct({ sha256: Schema.String, bytes: Schema.Finite, capturedAt: Schema.Finite })

const ownerGet = (appUrl: string, cookie: string, path: string) =>
  HttpClient.get(`${appUrl}${path}`, { headers: { cookie } })

const newOwner = (appUrl: string, name: string) =>
  Effect.gen(function* () {
    const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator())
    const { response } = yield* registerPasskey(appUrl, authenticator, name)
    const { accountId } = yield* Schema.decodeUnknownEffect(Schema.Struct({ accountId: Schema.String }))(
      yield* response.json,
    )
    return { accountId, cookie: sessionCookie(response) }
  })

export const registerLiveOffAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>) =>
  test(
    'live: while LIVE_ENABLED is pending the frame and live routes do not exist (404) and health reports live off',
    Effect.gen(function* () {
      const { apiUrl } = yield* stack
      const response = yield* HttpClient.post(`${apiUrl}/api/chips/${randomId()}/frames`, {
        headers: { authorization: `Bearer ${TEST_CHIP_TOKEN}` },
        body: HttpBody.text('{}', 'application/json'),
      })
      expect(response.status).toBe(404)
      const health = yield* (yield* HttpClient.get(`${apiUrl}/api/health`)).json
      expect(health).toMatchObject({ features: { live: false } })
    }).pipe(Effect.provide(freshConnections)),
    { timeout: 60000 },
  )

export const registerLiveAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>) =>
  test(
    'live: the chip-signed frame becomes the robot’s latest, only its owner sees it, the rate is capped, a scan signature is refused',
    Effect.gen(function* () {
      const { appUrl, url, apiUrl } = yield* stack
      const alice = yield* newOwner(appUrl, 'Live')
      const mallory = yield* newOwner(appUrl, 'Other')
      const robot = yield* seedScanningRobot(url, alice.accountId)
      const base = { apiUrl, ...robot }

      expect((yield* ownerGet(appUrl, alice.cookie, `/api/robots/${robot.robotId}/live`)).status).toBe(404)
      expect((yield* postFrame({ ...base, signWith: generatePrivateKey() })).status).toBe(401)
      expect((yield* postFrame({ ...base, asScan: true })).status).toBe(401)
      expect((yield* postFrame({ ...base, frame: sampleCrop(64 * 1024 + 1) })).body).toEqual({
        error: 'frame is larger than 64 KB',
      })

      const first = yield* postFrame(base)
      expect(first.status).toBe(201)
      // The second frame within 400 ms is refused and does not replace the first.
      expect((yield* postFrame(base)).status).toBe(429)
      const meta = yield* Schema.decodeUnknownEffect(LiveMeta)(
        yield* (yield* ownerGet(appUrl, alice.cookie, `/api/robots/${robot.robotId}/live`)).json,
      )
      expect(meta).toMatchObject({ sha256: first.sha256, bytes: 2048 })
      const image = yield* ownerGet(appUrl, alice.cookie, `/api/robots/${robot.robotId}/live/frame`)
      expect(image.headers['content-type']).toBe('image/jpeg')
      expect(image.headers['cache-control']).toBe('private, no-store')
      expect(sha256(new Uint8Array(yield* image.arrayBuffer))).toBe(first.sha256)

      // Another owner, and no session at all, cannot see it.
      expect((yield* ownerGet(appUrl, mallory.cookie, `/api/robots/${robot.robotId}/live`)).status).toBe(404)
      expect((yield* ownerGet(appUrl, mallory.cookie, `/api/robots/${robot.robotId}/live/frame`)).status).toBe(404)
      expect((yield* HttpClient.get(`${appUrl}/api/robots/${robot.robotId}/live`)).status).toBe(401)

      // The owner's intent poll carries the same frame while the duck is out, with its age.
      const created = yield* HttpClient.post(`${apiUrl}/api/robots/${robot.robotId}/intents`, {
        headers: { origin: new URL(appUrl).origin, cookie: alice.cookie },
        body: HttpBody.text(JSON.stringify({ instruction: 'Get me a chai', item: 'chai' }), 'application/json'),
      })
      expect(created.status).toBe(201)
      const { id: intentId } = yield* Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.String }))(
        yield* created.json,
      )
      const polled = yield* (yield* ownerGet(appUrl, alice.cookie, `/api/robots/${robot.robotId}/intents/${intentId}`))
        .json
      expect(polled).toMatchObject({ id: intentId, live: { sha256: first.sha256, bytes: 2048 } })

      // After the interval the next frame replaces it.
      yield* Effect.sleep('450 millis')
      const second = yield* postFrame(base)
      expect(second.status).toBe(201)
      expect(yield* (yield* ownerGet(appUrl, alice.cookie, `/api/robots/${robot.robotId}/live`)).json).toMatchObject({
        sha256: second.sha256,
      })
    }).pipe(Effect.provide(freshConnections)),
    { timeout: 60000 },
  )
