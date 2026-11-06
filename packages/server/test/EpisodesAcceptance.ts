import { expect } from 'bun:test'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import { privateKeyToAccount } from 'viem/accounts'
import { seedRobot } from './ConsoleBrowserAcceptance.ts'
import { makeSoftwareAuthenticator, registerPasskey, sessionCookie } from './PasskeyFixture.ts'
import { mintInvoice } from './RobotAcceptance.ts'
import { scanErrand, seedScanningRobot } from './ScanAcceptance.ts'

type Urls = { readonly appUrl: string; readonly url: string; readonly apiUrl: string }
type Owner = { readonly accountId: string; readonly cookie: string }

const Created = Schema.Struct({
  episodeId: Schema.String,
  state: Schema.String,
  decision: Schema.Struct({ action: Schema.String, requestId: Schema.NullOr(Schema.String) }),
})
const Listed = Schema.Struct({
  episodes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      robotId: Schema.String,
      item: Schema.String,
      decision: Schema.NullOr(Schema.Struct({ action: Schema.String, requestId: Schema.NullOr(Schema.String) })),
      payment: Schema.NullOr(Schema.Struct({ status: Schema.String, txHash: Schema.NullOr(Schema.String) })),
    }),
  ),
})
const Audit = Schema.Struct({
  episode: Schema.Struct({ id: Schema.String, item: Schema.String, state: Schema.String }),
  decisions: Schema.Array(
    Schema.Struct({
      action: Schema.String,
      request_id: Schema.NullOr(Schema.String),
      provider: Schema.NullOr(Schema.String),
      prompt_sha256: Schema.NullOr(Schema.String),
      input_json: Schema.NullOr(Schema.String),
    }),
  ),
  chipRequests: Schema.Array(Schema.Struct({ status: Schema.String })),
  payments: Schema.Array(Schema.Struct({ status: Schema.String, tx_hash: Schema.NullOr(Schema.String) })),
  timeline: Schema.Array(
    Schema.Struct({ at: Schema.Finite, kind: Schema.String, detail: Schema.NullOr(Schema.String) }),
  ),
})
const DecideInputShape = Schema.fromJsonString(Schema.Struct({ requested: Schema.String }))
const SETTLED_TX = `0x${'5e'.repeat(32)}`

const owner = async (appUrl: string, name: string): Promise<Owner> => {
  const authenticator = await makeSoftwareAuthenticator()
  const { response } = await Effect.runPromise(
    registerPasskey(appUrl, authenticator, name).pipe(Effect.provide(FetchHttpClient.layer)),
  )
  const { accountId } = Schema.decodeUnknownSync(Schema.Struct({ accountId: Schema.String }))(
    await Effect.runPromise(response.json),
  )
  return { accountId, cookie: sessionCookie(response) }
}

const get = async (urls: Urls, path: string, cookie: string) => {
  const response = await fetch(`${urls.appUrl}${path}`, { headers: { cookie } })
  const body: unknown = await response.json()
  return { status: response.status, body }
}

/** One chai errand of the owner's robot; a `pay` decision (the stub's default) gets a settled payment seeded. */
const errand = async (urls: Urls, who: Owner) => {
  const robotId = await seedRobot(urls.url, who.accountId)
  const started = await fetch(`${urls.apiUrl}/api/robots/${robotId}/errands`, {
    method: 'POST',
    headers: { origin: new URL(urls.appUrl).origin, cookie: who.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ item: 'chai' }),
  })
  expect(started.status).toBe(201)
  const created = Schema.decodeUnknownSync(Created)(await started.json())
  if (created.state === 'signing') {
    const settled = await fetch(`${urls.url}/test/vq/episodes/${created.episodeId}/settled`, {
      method: 'POST',
      body: JSON.stringify({ txHash: SETTLED_TX }),
    })
    expect(settled.status).toBe(204)
    // Reading the errand reconciles it against the settled payment (settling → paid).
    await fetch(`${urls.appUrl}/api/robots/${robotId}/errands/${created.episodeId}`, {
      headers: { cookie: who.cookie },
    })
  }
  return { robotId, created }
}

const audit = async (urls: Urls) => {
  const alice = await owner(urls.appUrl, 'Audit Owner')
  const { robotId, created } = await errand(urls, alice)
  const paid = created.decision.action === 'pay'

  const listed = Schema.decodeUnknownSync(Listed)((await get(urls, '/api/wallet/episodes', alice.cookie)).body)
  const row = listed.episodes.find((episode) => episode.id === created.episodeId)
  expect(row).toMatchObject({ robotId, item: 'chai', decision: created.decision })
  expect(row?.payment).toEqual(paid ? { status: 'settled', txHash: SETTLED_TX } : null)
  const filtered = Schema.decodeUnknownSync(Listed)(
    (await get(urls, `/api/wallet/episodes?robotId=${robotId}&limit=1`, alice.cookie)).body,
  )
  expect(filtered.episodes.map((episode) => episode.id)).toEqual([created.episodeId])
  expect((await get(urls, '/api/wallet/episodes?limit=lots', alice.cookie)).status).toBe(400)

  const detail = Schema.decodeUnknownSync(Audit)(
    (await get(urls, `/api/wallet/episodes/${created.episodeId}`, alice.cookie)).body,
  )
  expect(detail.episode).toMatchObject({ id: created.episodeId, item: 'chai' })
  const [decision] = detail.decisions
  expect(decision).toMatchObject({ action: created.decision.action, request_id: created.decision.requestId })
  expect(decision?.prompt_sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(Schema.decodeUnknownSync(DecideInputShape)(decision?.input_json)).toMatchObject({ requested: 'chai' })
  const kinds = detail.timeline.map((entry) => entry.kind)
  expect(kinds.indexOf('errand_started')).toBeGreaterThanOrEqual(0)
  expect(kinds.indexOf('errand_started')).toBeLessThan(kinds.indexOf('decision'))
  for (const kind of paid ? ['chip_requested', 'payment_submitted', 'payment_settled'] : [])
    expect(kinds).toContain(kind)
  if (paid) expect(detail.payments).toEqual([{ status: 'settled', tx_hash: SETTLED_TX }])
  const seconds = detail.timeline.map((entry) => Math.floor(entry.at / 1000))
  expect(seconds).toEqual(seconds.toSorted((left, right) => left - right))

  const mallory = await owner(urls.appUrl, 'Other Owner')
  expect(await get(urls, `/api/wallet/episodes/${created.episodeId}`, mallory.cookie)).toEqual({
    status: 404,
    body: { error: 'unknown episode' },
  })
  expect((await get(urls, `/api/wallet/episodes?robotId=${robotId}`, mallory.cookie)).body).toEqual({ episodes: [] })
  expect((await get(urls, '/api/wallet/episodes', '')).status).toBe(401)
}

const Seen = Schema.Struct({
  episode: Schema.Struct({ chipAddress: Schema.NullOr(Schema.String) }),
  observations: Schema.Array(
    Schema.Struct({ kind: Schema.String, sha256: Schema.String, bytes: Schema.Finite, capturedAt: Schema.Finite }),
  ),
  timeline: Schema.Array(Schema.Struct({ kind: Schema.String, detail: Schema.NullOr(Schema.String) })),
})

const as = (cookie: string) => ({ headers: { cookie } })

const sha256Hex = (bytes: ArrayBuffer) =>
  Effect.promise(() => crypto.subtle.digest('SHA-256', bytes)).pipe(
    Effect.map(
      (digest) => `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
    ),
  )

/**
 * What the robot saw: a chip-signed scan starts an errand; its audit lists the crop's metadata and an `observation`
 * entry, and the crop itself is served to the owner only (JPEG, never cached), 404 for anyone else or any other hash.
 */
const observationImage = (urls: Urls) =>
  Effect.gen(function* () {
    const alice = yield* Effect.promise(() => owner(urls.appUrl, 'Scan Owner'))
    const robot = yield* seedScanningRobot(urls.url, alice.accountId)
    const invoiceId = yield* mintInvoice(urls.appUrl)
    const scan = yield* scanErrand({ apiUrl: urls.apiUrl, robotId: robot.robotId, chipKey: robot.chipKey, invoiceId })
    const detail = yield* HttpClient.get(`${urls.appUrl}/api/wallet/episodes/${scan.episodeId}`, as(alice.cookie))
    const seen = yield* Schema.decodeUnknownEffect(Seen)(yield* detail.json)
    expect(seen.observations).toEqual([expect.objectContaining({ kind: 'qr_crop', sha256: scan.sha256 })])
    expect(seen.episode.chipAddress?.toLowerCase()).toBe(privateKeyToAccount(robot.chipKey).address.toLowerCase())
    expect(seen.timeline).toContainEqual({ kind: 'observation', detail: scan.sha256 })

    const path = `${urls.appUrl}/api/wallet/episodes/${scan.episodeId}/observations/${scan.sha256}`
    const image = yield* HttpClient.get(path, as(alice.cookie))
    expect(image.status).toBe(200)
    expect(image.headers['content-type']).toBe('image/jpeg')
    expect(image.headers['cache-control']).toBe('private, no-store')
    expect(yield* sha256Hex(yield* image.arrayBuffer)).toBe(scan.sha256)

    const mallory = yield* Effect.promise(() => owner(urls.appUrl, 'Not The Owner'))
    const stranger = yield* HttpClient.get(path, as(mallory.cookie))
    expect(stranger.status).toBe(404)
    expect(yield* stranger.json).toEqual({ error: 'unknown observation' })
    const otherHash = path.replace(scan.sha256, `0x${'0'.repeat(64)}`)
    expect((yield* HttpClient.get(otherHash, as(alice.cookie))).status).toBe(404)
    expect((yield* HttpClient.get(path)).status).toBe(401)
  })

/**
 * The audit view (wallet/Episodes.ts) on the native Worker: an errand run through the real errand route shows up in
 * the owner's list with its latest decision and payment, filtered by robot; the detail carries the exact 0G input,
 * the prompt hash and a timeline in time order; another owner gets 404 and an empty list; no session is 401.
 */
export const registerEpisodesAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>) =>
  test(
    'audit view: owner-scoped errand list and detail with the 0G input, payment and timeline; scan crops owner-only',
    Effect.gen(function* () {
      const urls = yield* stack
      yield* Effect.promise(() => audit(urls))
      yield* observationImage(urls)
    }).pipe(Effect.provide(FetchHttpClient.layer)),
    { timeout: 90000 },
  )
