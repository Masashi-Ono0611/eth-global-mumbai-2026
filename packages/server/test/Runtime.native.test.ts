import { expect } from 'bun:test'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import * as Output from 'alchemy/Output'
import * as Test from 'alchemy/Test/Bun'
import { Effect, Redacted, Schedule, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import { type Browser, chromium } from 'playwright'
import { keccak256, stringToHex } from 'viem'
import { registerAuditAcceptance, startChainStub, TEST_EPISODE_LOG, TEST_INFERENCE } from './AuditAcceptance.ts'
import { verifyBrowser } from './BrowserAcceptance.ts'
import { registerChainAcceptance } from './ChainAcceptance.ts'
import { registerChipAcceptance, registerMockChipAcceptance } from './ChipAcceptance.ts'
import { registerChipIntentAcceptance, registerCounterAcceptance } from './CounterAcceptance.ts'
import {
  registerMerchantAcceptance,
  TEST_GATE_SEED,
  TEST_MERCHANT_PAY_TO,
  TEST_RESTRICTED_PAY_TO,
} from './MerchantAcceptance.ts'
import { registerLimitsAcceptance } from './LimitsAcceptance.ts'
import { verifyPasskeyBrowser } from './PasskeyBrowserAcceptance.ts'
import { makeSoftwareAuthenticator, passkeyCall, registerPasskey, sessionCookie } from './PasskeyFixture.ts'
import {
  registerRobotAcceptance,
  startZeroGStub,
  TEST_EVIDENCE_TOKEN,
  TEST_TEE_SIGNER,
  TEST_ZG_API_KEY,
  TEST_ZG_MODEL,
} from './RobotAcceptance.ts'
import { registerLiveAcceptance, registerLiveOffAcceptance } from './LiveAcceptance.ts'
import RuntimeWorker from './RuntimeWorker.ts'
import {
  registerChipScanListenerAcceptance,
  registerScanAcceptance,
  startStorageStub,
  registerScansOffAcceptance,
} from './ScanAcceptance.ts'
import {
  registerTelegramAcceptance,
  startTelegramStub,
  TEST_TELEGRAM_SECRET,
  TEST_TELEGRAM_TOKEN,
} from './TelegramAcceptance.ts'
import { registerWalletAcceptance } from './WalletAcceptance.ts'
import { registerConsoleAcceptance } from './ConsoleBrowserAcceptance.ts'
import { registerWorldStubAcceptance, TEST_ENFORCER_ADDRESS, TEST_WORLD_STUB_JWK } from './WorldStubAcceptance.ts'
import ApiWorkerLive, { ApiWorker } from '../src/ApiWorker.ts'

// The 0G router stand-in runs in this process; the Worker reaches it on 127.0.0.1.
const zeroG = startZeroGStub()
// The 0G Chain stand-in answers EpisodeLog.records (audit) and the provider registry (decisions' TEE proofs).
// The Telegram Bot API stand-in: records every call; the acceptance can take it down (spec §14).
const telegram = startTelegramStub()
const chainStub = startChainStub({ url: zeroG.serviceUrl, model: TEST_ZG_MODEL, signer: TEST_TEE_SIGNER })
const storageStub = startStorageStub()

const makeStack = (generation: string) =>
  Alchemy.Stack(
    'LocalAcceptance',
    {
      providers: Cloudflare.providers(),
      state: Alchemy.localState(),
    },
    Effect.gen(function* () {
      const worker = yield* RuntimeWorker
      yield* worker.bind('AcceptanceGeneration', { env: { TEST_GENERATION: generation } })
      const api = yield* ApiWorker
      // Execute the production SSR artifact in workerd. Website.Foldkit's dev
      // mode runs Vite in Node, which cannot prove the deployed Worker behavior.
      const website = yield* Cloudflare.Worker('NativeWebsite', {
        main: 'apps/web/dist/server/fetch.js',
        assets: { directory: 'apps/web/dist/client' },
        compatibility: { date: '2026-10-19' },
      })
      const edge = yield* Cloudflare.Worker('NativeEdge', {
        main: 'packages/server/src/EdgeWorker.ts',
        env: { API: api, WEBSITE: website },
        assets: { directory: 'apps/web/dist/client' },
        compatibility: { date: '2026-10-19' },
      })
      // Native acceptance binds the same secret-text contract used by Alchemy's
      // preview stack. Values are test-only and never leave this process.
      yield* api.bind('RuntimeConfiguration', {
        env: {
          AUTH_ORIGIN: edge.url,
          // The rehearsal issuer (world/Stub.ts) stands in for World IdP on this stack, with a per-run RSA key.
          WORLD_ISSUER: Output.interpolate`${edge.url}/api/dev/world`,
          WORLD_CLIENT_ID: 'stub',
          WORLD_CLIENT_SECRET: Redacted.make('stub'),
          WORLD_STUB_JWK: Redacted.make(TEST_WORLD_STUB_JWK),
          ENFORCER_ADDRESS: TEST_ENFORCER_ADDRESS,
          APP_ENV: 'local',
          APP_RELEASE: `native-${generation}`,
          MERCHANT_PAY_TO: TEST_MERCHANT_PAY_TO,
          RESTRICTED_PAY_TO: TEST_RESTRICTED_PAY_TO,
          GATE_ED25519_SEED: Redacted.make(TEST_GATE_SEED),
          EVIDENCE_TOKEN: Redacted.make(TEST_EVIDENCE_TOKEN),
          ZG_BASE_URL: zeroG.baseUrl,
          ZG_API_KEY: Redacted.make(TEST_ZG_API_KEY),
          ZG_MODEL: TEST_ZG_MODEL,
          EPISODE_LOG_ADDRESS: TEST_EPISODE_LOG,
          ZG_CHAIN_RPC: chainStub.url,
          ZG_STORAGE_INDEXER: storageStub.url,
          // The stub chain also plays 0G Compute's provider registry, for decisions' TEE proofs.
          ZG_COMPUTE_RPC: chainStub.url,
          ZG_INFERENCE_CONTRACT: TEST_INFERENCE,
          // Off in the first generation (the flag-off 404 runs there), on after the restart test (ScanAcceptance.ts).
          SCANS_ENABLED: generation === 'after' ? 'true' : 'pending',
          // The live camera view follows the same two generations (LiveAcceptance.ts).
          LIVE_ENABLED: generation === 'after' ? 'true' : 'pending',
          TELEGRAM_BOT_TOKEN: Redacted.make(TEST_TELEGRAM_TOKEN),
          TELEGRAM_WEBHOOK_SECRET: Redacted.make(TEST_TELEGRAM_SECRET),
          TELEGRAM_API_BASE_URL: telegram.baseUrl,
          // Derived throwaway keys (no literal, never funded): with a relayer the x402 402 and the errand paths run;
          // no ARC_RPC_URL, so only POST /pay reaches the public Arc RPC, and only to simulate.
          RELAYER_PRIVATE_KEY: Redacted.make(keccak256(stringToHex('vitaquack native test relayer'))),
          APPROVER_PRIVATE_KEY: Redacted.make(keccak256(stringToHex('vitaquack native test approver'))),
          AUTH_SESSION_KEYS: Redacted.make(
            JSON.stringify({
              activeKeyId: 'native-test',
              keys: [{ id: 'native-test', material: 'a'.repeat(43) }],
            }),
          ),
        },
      })
      return {
        url: worker.url.as<string>(),
        appUrl: edge.url.as<string>(),
        apiUrl: api.url.as<string>(),
        websiteUrl: website.url.as<string>(),
      }
    }).pipe(Effect.provide(ApiWorkerLive)),
  )

const Stack = makeStack('before')

class RestartPending extends Schema.TaggedError<RestartPending>()('RestartPending', {}) {}

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Alchemy.localState(),
  stage: 'local-native',
  dev: true,
  sidecar: { omitEnv: ['CLOUDFLARE_'] },
})
// The local service-binding proxy may return 503 while a dependency is still
// compiling. Its direct development URL waits for startup before dispatching.
const stack = beforeAll(
  deploy(Stack).pipe(
    Effect.tap(({ apiUrl }) => HttpClient.get(`${apiUrl}/api/health`).pipe(Effect.provide(FetchHttpClient.layer))),
    Effect.tap(({ websiteUrl }) => HttpClient.get(websiteUrl).pipe(Effect.provide(FetchHttpClient.layer))),
  ),
  { timeout: 120000 },
)
afterAll(destroy(Stack), { timeout: 60000 })

/** One headless Chromium per browser test, closed with the test's scope, pointed at the public edge. */
const inBrowser = (verify: (browser: Browser, appUrl: string) => Promise<void>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { appUrl } = yield* stack
      const browserInstance = yield* Effect.acquireRelease(
        Effect.promise(() => chromium.launch({ headless: true })),
        (browser) => Effect.promise(() => browser.close()),
      )
      yield* Effect.promise(() => verify(browserInstance, appUrl))
    }),
  )

test('hydrates the built website in a browser', inBrowser(verifyBrowser), {
  timeout: 60000,
})

test(
  'creates a passkey wallet in a real browser, keeps the session across reloads and revokes it on logout',
  inBrowser(verifyPasskeyBrowser),
  { timeout: 60000 },
)

test(
  'formats with the real Worker Intl implementation',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.get(`${url}/intl`)
    expect(response.status).toBe(200)
    expect(yield* response.json).toMatchObject({ en: '2 pieces', plural: 'one', date: '1970' })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serves the built Foldkit document and assets through the public edge',
  Effect.gen(function* () {
    const { appUrl } = yield* stack
    const document = yield* HttpClient.get(`${appUrl}/app/`, { headers: { accept: 'text/html' } })
    const html = yield* document.text
    expect(document.status).toBe(200)
    expect(document.headers['content-type']).toContain('text/html')
    expect(html).toContain('A duck with a budget.')
    const scriptPath = html.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1]
    const stylesheetPath = html.match(/<link rel="stylesheet" crossorigin href="([^"]+)"/)?.[1]
    expect(scriptPath).toBeDefined()
    expect(stylesheetPath).toBeDefined()
    const script = yield* HttpClient.get(`${appUrl}${scriptPath}`)
    const stylesheet = yield* HttpClient.get(`${appUrl}${stylesheetPath}`)
    expect(script.status, `edge asset ${scriptPath}`).toBe(200)
    expect(yield* script.text).toContain('hydrate')
    expect(stylesheet.status, `edge asset ${stylesheetPath}`).toBe(200)
    expect(yield* stylesheet.text).toContain('--color-paper')
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serves health but no storage internals through the actual application Worker',
  Effect.gen(function* () {
    const { appUrl } = yield* stack
    const health = yield* HttpClient.get(`${appUrl}/api/health`)
    expect(health.status).toBe(200)
    expect(yield* health.json).toMatchObject({ service: 'ethmumbai', status: 'ok' })

    const storage = yield* HttpClient.get(`${appUrl}/api/storage`)
    expect(storage.status).toBe(404)
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'enforces Origin on every mutating auth route of the actual application Worker',
  Effect.gen(function* () {
    const { appUrl } = yield* stack
    const missingOrigin = yield* HttpClient.post(`${appUrl}/api/auth/logout`)
    expect(missingOrigin.status).toBe(403)
    const wrongOrigin = yield* HttpClient.post(`${appUrl}/api/passkeys/login/options`, {
      headers: { origin: 'https://evil.invalid', 'content-type': 'application/json' },
      body: HttpBody.text('{}', 'application/json'),
    })
    expect(wrongOrigin.status).toBe(403)
    const valid = yield* passkeyCall(appUrl)('/api/passkeys/login/options', {})
    expect(valid.status).toBe(200)
    expect(yield* valid.json).toMatchObject({ rpId: new URL(appUrl).hostname, userVerification: 'required' })
    const anonymous = yield* HttpClient.get(`${appUrl}/api/auth/session`)
    expect(anonymous.status).toBe(401)
    const unknownRoute = yield* HttpClient.get(`${appUrl}/api/health-other`)
    expect(unknownRoute.status).toBe(404)
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serves the isolated D1 schema and R2 binding',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.get(`${url}/storage`)
    expect(response.status).toBe(200)
    expect(yield* response.json).toMatchObject({
      database: {
        tables: [
          'accounts',
          'approvals',
          'auth_challenges',
          'chip_requests',
          'counter_display',
          'decisions',
          'episodes',
          'evidence_uploads',
          'grants',
          'intents',
          'invoices',
          'live_frames',
          'nav_turns',
          'notifications',
          'observations',
          'passkeys',
          'payments',
          'relayer_txs',
          'robots',
          'telegram_links',
          'used_nonces',
        ],
      },
      media: { sentinel: false },
    })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'registers a passkey, signs in with it, refuses replays and invalidates every cookie on logout',
  Effect.gen(function* () {
    const { appUrl } = yield* stack
    const call = passkeyCall(appUrl)
    const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator({ countSignatures: true }))
    const { response: registered, request } = yield* registerPasskey(appUrl, authenticator, 'Native Owner')
    expect(registered.status).toBe(200)
    const account = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        accountId: Schema.String.check(Schema.isPattern(/^[a-z2-7]{26}$/)),
        smartAccount: Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]{40}$/)),
      }),
    )(yield* registered.json)
    expect(registered.headers['set-cookie']).toMatch(/vq_session=.*HttpOnly.*Secure.*SameSite=Lax/i)
    const replayedRegistration = yield* call('/api/passkeys/register/verify', request)
    expect(replayedRegistration.status).toBe(400)
    const cookie = sessionCookie(registered)
    const session = yield* HttpClient.get(`${appUrl}/api/auth/session`, { headers: { cookie } })
    expect(session.status).toBe(200)
    expect(yield* session.json).toEqual({ ...account, displayName: 'Native Owner' })

    const options = yield* call('/api/passkeys/login/options', {})
    const { challenge } = yield* Schema.decodeUnknownEffect(Schema.Struct({ challenge: Schema.String }))(
      yield* options.json,
    )
    const assertion = yield* Effect.promise(() => authenticator.assert(challenge, { origin: new URL(appUrl).origin }))
    const login = yield* call('/api/passkeys/login/verify', assertion)
    expect(login.status).toBe(200)
    const replayedLogin = yield* call('/api/passkeys/login/verify', assertion)
    expect(replayedLogin.status).toBe(400)
    const secondCookie = sessionCookie(login)

    const logout = yield* call('/api/auth/logout', {}, secondCookie)
    expect(logout.status).toBe(204)
    for (const stale of [cookie, secondCookie]) {
      const replay = yield* HttpClient.get(`${appUrl}/api/auth/session`, { headers: { cookie: stale } })
      expect(replay.status).toBe(401)
    }
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

registerScansOffAcceptance(test, stack)
registerLiveOffAcceptance(test, stack)

test(
  'recovers auth sessions and R2 bytes after a Worker restart',
  Effect.gen(function* () {
    const { url, appUrl } = yield* stack
    expect((yield* HttpClient.post(`${url}/test/recovery/seed`)).status).toBe(204)
    const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator())
    const { response: registered } = yield* registerPasskey(appUrl, authenticator, 'Native Recovery')
    expect(registered.status).toBe(200)
    const cookie = sessionCookie(registered)
    const read = () => HttpClient.get(`${url}/test/recovery/read`).pipe(Effect.flatMap((response) => response.json))
    expect(yield* read()).toMatchObject({ generation: 'before', reads: 1 })
    expect(yield* read()).toMatchObject({ generation: 'before', reads: 2 })
    const next = yield* deploy(makeStack('after'))
    expect(next.url).toBe(url)
    const recovered = yield* read().pipe(
      Effect.filterOrFail(
        Schema.is(Schema.Struct({ generation: Schema.Literal('after') })),
        () => new RestartPending(),
      ),
      Effect.retry({ times: 100, schedule: Schedule.spaced('100 millis') }),
    )
    expect(recovered).toMatchObject({
      generation: 'after',
      reads: 1,
      media: 'survives-native-restart',
    })
    yield* HttpClient.get(`${next.apiUrl}/api/health`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.filterOrFail(
        Schema.is(Schema.Struct({ release: Schema.Literal('native-after') })),
        () => new RestartPending(),
      ),
      Effect.retry({ times: 100, schedule: Schedule.spaced('100 millis') }),
    )
    const session = yield* HttpClient.get(`${appUrl}/api/auth/session`, { headers: { cookie } })
    expect(session.status).toBe(200)
    expect(yield* session.json).toMatchObject({ displayName: 'Native Recovery' })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 120000 },
)

registerMerchantAcceptance(test, stack)
registerChipAcceptance(test, stack)
registerMockChipAcceptance(test)
registerRobotAcceptance(test, stack, zeroG)
registerLimitsAcceptance(test, stack, zeroG)
registerAuditAcceptance(test, stack, zeroG, chainStub)
registerScanAcceptance(test, stack, zeroG, storageStub)
registerCounterAcceptance(test, stack)
registerChipIntentAcceptance(test, stack, zeroG)
registerChipScanListenerAcceptance(test, stack)
registerLiveAcceptance(test, stack)
registerWalletAcceptance(test, stack)
registerConsoleAcceptance(test, stack, zeroG)
registerWorldStubAcceptance(test, stack, zeroG)
registerTelegramAcceptance(test, stack, zeroG, telegram)
registerChainAcceptance(test, stack)
