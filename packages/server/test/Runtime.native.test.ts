import { expect } from 'bun:test'
import * as Cloudflare from '@alchemy.run/cloudflare'
import * as Alchemy from 'alchemy'
import * as Test from 'alchemy/Test/Bun'
import { Effect, Redacted, Schedule, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import { chromium } from 'playwright'
import { verifyBrowser } from './BrowserAcceptance.ts'
import { verifyBrowserIdentity } from './IdentityBrowserAcceptance.ts'
import RuntimeWorker from './RuntimeWorker.ts'
import StyldWorkerLive, { StyldWorker } from '../src/StyldWorker.ts'

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
      const styld = yield* StyldWorker
      // Execute the production SSR artifact in workerd. Website.Foldkit's dev
      // mode runs Vite in Node, which cannot prove the deployed Worker behavior.
      const website = yield* Cloudflare.Worker('NativeWebsite', {
        main: 'apps/web/dist/server/fetch.js',
        assets: { directory: 'apps/web/dist/client' },
        compatibility: { date: '2026-10-19' },
      })
      const edge = yield* Cloudflare.Worker('NativeEdge', {
        main: 'packages/server/src/EdgeWorker.ts',
        env: { API: styld, WEBSITE: website },
        assets: { directory: 'apps/web/dist/client' },
        compatibility: { date: '2026-10-19' },
      })
      // Native acceptance binds the same secret-text contract used by Alchemy's
      // preview stack. Values are test-only and never leave this process.
      yield* styld.bind('RuntimeConfiguration', {
        env: {
          AUTH_ORIGIN: edge.url,
          APP_ENV: 'local',
          APP_RELEASE: `native-${generation}`,
          AUTH_SECRET: Redacted.make('native-test-auth-secret-012345678901234567890123'),
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
        styldUrl: edge.url.as<string>(),
        apiUrl: styld.url.as<string>(),
        websiteUrl: website.url.as<string>(),
      }
    }).pipe(Effect.provide(StyldWorkerLive)),
  )

const Stack = makeStack('before')

class RestartPending extends Schema.TaggedError<RestartPending>()('RestartPending', {}) {}

const authCall =
  (origin: string) =>
  (action: string, payload: object, cookie = '') =>
    HttpClient.post(`${origin}/api/auth/${action}`, {
      headers: {
        origin: new URL(origin).origin,
        'content-type': 'application/json',
        'x-effect-auth-csrf': '1',
        cookie,
      },
      body: HttpBody.text(JSON.stringify({ payload }), 'application/json'),
    })

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

test(
  'hydrates the built website and persists locale changes in a browser',
  Effect.scoped(
    Effect.gen(function* () {
      const { styldUrl } = yield* stack
      const browserInstance = yield* Effect.acquireRelease(
        Effect.promise(() => chromium.launch({ headless: true })),
        (browser) => Effect.promise(() => browser.close()),
      )
      yield* Effect.promise(() => verifyBrowser(browserInstance, styldUrl))
    }),
  ),
  { timeout: 60000 },
)

test(
  'signs in through the browser, retains the session across reloads and revokes it on logout',
  Effect.scoped(
    Effect.gen(function* () {
      const { url, styldUrl } = yield* stack
      const seeded = yield* HttpClient.post(`${url}/test/identity/seed-browser`)
      expect(seeded.status).toBe(204)
      const browserInstance = yield* Effect.acquireRelease(
        Effect.promise(() => chromium.launch({ headless: true })),
        (browser) => Effect.promise(() => browser.close()),
      )
      yield* Effect.promise(() => verifyBrowserIdentity(browserInstance, styldUrl))
    }),
  ).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'formats Slovenian with the real Worker Intl implementation',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.get(`${url}/intl`)
    expect(response.status).toBe(200)
    expect(yield* response.json).toMatchObject({ en: '2 pieces', sl: '102 kosa', plural: 'two', date: '1970' })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serves the built Foldkit document and assets through the public edge',
  Effect.gen(function* () {
    const { styldUrl } = yield* stack
    const document = yield* HttpClient.get(styldUrl, { headers: { accept: 'text/html' } })
    const html = yield* document.text
    expect(document.status).toBe(200)
    expect(document.headers['content-type']).toContain('text/html')
    expect(html).toContain('A wardrobe shaped by you.')
    const scriptPath = html.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1]
    const stylesheetPath = html.match(/<link rel="stylesheet" crossorigin href="([^"]+)"/)?.[1]
    expect(scriptPath).toBeDefined()
    expect(stylesheetPath).toBeDefined()
    const script = yield* HttpClient.get(`${styldUrl}${scriptPath}`)
    const stylesheet = yield* HttpClient.get(`${styldUrl}${stylesheetPath}`)
    expect(script.status, `edge asset ${scriptPath}`).toBe(200)
    expect(yield* script.text).toContain('hydrate')
    expect(stylesheet.status, `edge asset ${stylesheetPath}`).toBe(200)
    expect(yield* stylesheet.text).toContain('--paper')
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serves health but no storage internals through the actual application Worker',
  Effect.gen(function* () {
    const { styldUrl } = yield* stack
    const health = yield* HttpClient.get(`${styldUrl}/api/health`)
    expect(health.status).toBe(200)
    expect(yield* health.json).toMatchObject({ service: 'styldappv2', status: 'ok' })

    const storage = yield* HttpClient.get(`${styldUrl}/api/storage`)
    expect(storage.status).toBe(404)
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'enforces Origin and CSRF on the actual application Worker',
  Effect.gen(function* () {
    const { styldUrl } = yield* stack
    const missingHeaders = yield* HttpClient.post(`${styldUrl}/api/auth/getSession`, {
      headers: new Headers({ 'content-type': 'application/json' }),
      body: HttpBody.text('{}', 'application/json'),
    })
    expect(missingHeaders.status).toBe(403)

    const valid = yield* HttpClient.post(`${styldUrl}/api/auth/getSession`, {
      headers: new Headers({
        origin: new URL(styldUrl).origin,
        'content-type': 'application/json',
        'x-effect-auth-csrf': '1',
      }),
      body: HttpBody.text('{}', 'application/json'),
    })
    expect(valid.status).toBe(200)
    expect(yield* valid.json).toMatchObject({ _tag: 'Success' })

    const wrongOrigin = yield* HttpClient.post(`${styldUrl}/api/auth/getSession`, {
      headers: new Headers({
        origin: 'https://evil.invalid',
        'content-type': 'application/json',
        'x-effect-auth-csrf': '1',
      }),
      body: HttpBody.text('{}', 'application/json'),
    })
    expect(wrongOrigin.status).toBe(403)

    const unknownRoute = yield* HttpClient.get(`${styldUrl}/api/health-other`)
    expect(unknownRoute.status).toBe(404)
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serializes competing reservations in native SQLite Durable Objects',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.get(`${url}/wallet`)
    expect(response.status).toBe(200)
    expect(yield* response.json).toMatchObject({
      successful: 1,
      reserved: { subscription: 2 },
      settled: { subscription: 10, purchased: 0, reservations: {} },
      other: { subscription: 0, purchased: 0, reservations: {} },
    })
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
          'auth_attempt_buckets',
          'styld_auth_credentials',
          'styld_auth_identifiers',
          'styld_auth_passwords',
          'styld_auth_pending',
          'styld_auth_sessions',
        ],
      },
      media: { sentinel: false },
    })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serves Yielded Auth session reads through the native Worker router',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.post(`${url}/api/auth/getSession`, {
      headers: new Headers({
        origin: 'http://localhost',
        'content-type': 'application/json',
        'x-effect-auth-csrf': '1',
      }),
      body: HttpBody.text('{}', 'application/json'),
    })
    const body = yield* response.text
    expect(response.status, body).toBe(200)
    const payload: unknown = JSON.parse(body)
    expect(payload).toMatchObject({ _tag: 'Success' })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'authenticates, rejects password signup, logs out and immediately invalidates disabled accounts',
  Effect.gen(function* () {
    const { url, styldUrl } = yield* stack
    const seeded = yield* HttpClient.post(`${url}/test/identity/seed`)
    expect(seeded.status).toBe(204)
    const call = authCall(styldUrl)
    const credentials = { email: 'native-identity@example.invalid', password: 'native-identity-password-52' }
    const denied = yield* call('signIn', { ...credentials, password: 'incorrect-password' })
    expect(yield* denied.json).toMatchObject({ _tag: 'Failure' })
    const signup = yield* call('register', credentials)
    expect(signup.status).toBe(404)
    const login = yield* call('signIn', credentials)
    const loginBody = yield* login.text
    expect(login.status, loginBody).toBe(200)
    expect(JSON.parse(loginBody)).toMatchObject({
      _tag: 'Success',
      value: { _tag: 'Authenticated', session: { subjectId: 'native-identity' } },
    })
    const cookie = Object.entries(login.cookies.cookies)
      .map(([name, value]) => `${name}=${value.value}`)
      .join('; ')
    expect(cookie.length).toBeGreaterThan(0)
    const session = yield* call('getSession', {}, cookie)
    expect(yield* session.json).toMatchObject({
      _tag: 'Success',
      value: { subjectId: 'native-identity', claims: { displayName: 'Native Identity', emailVerified: true } },
    })
    const cachedCookie = Object.entries({ ...login.cookies.cookies, ...session.cookies.cookies })
      .map(([name, value]) => `${name}=${value.value}`)
      .join('; ')
    const logout = yield* call('signOut', {}, cachedCookie)
    expect(yield* logout.json).toMatchObject({ _tag: 'Success' })
    const stale = yield* call('getSession', {}, cachedCookie)
    expect(yield* stale.json).toMatchObject({ _tag: 'Success', value: null })
    const again = yield* call('signIn', credentials)
    const againCookie = Object.entries(again.cookies.cookies)
      .map(([name, value]) => `${name}=${value.value}`)
      .join('; ')
    const cachedSession = yield* call('getSession', {}, againCookie)
    const disabledCookie = Object.entries({ ...again.cookies.cookies, ...cachedSession.cookies.cookies })
      .map(([name, value]) => `${name}=${value.value}`)
      .join('; ')
    const disable = yield* HttpClient.post(`${url}/test/identity/disable`)
    expect(disable.status).toBe(204)
    const disabled = yield* call('getSession', {}, disabledCookie)
    expect(yield* disabled.json).toMatchObject({ _tag: 'Success', value: null })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'retains password attempt budgets across separate application requests',
  Effect.gen(function* () {
    const { url, styldUrl } = yield* stack
    const seeded = yield* HttpClient.post(`${url}/test/identity/seed-limited`)
    expect(seeded.status).toBe(204)
    const attempt = () =>
      HttpClient.post(`${styldUrl}/api/auth/signIn`, {
        headers: { origin: new URL(styldUrl).origin, 'content-type': 'application/json', 'x-effect-auth-csrf': '1' },
        body: HttpBody.text(
          JSON.stringify({
            payload: { email: 'native-limited@example.invalid', password: 'native-identity-password-52' },
          }),
          'application/json',
        ),
      })
    for (let count = 0; count < 10; count += 1) {
      const accepted = yield* attempt()
      expect(yield* accepted.json).toMatchObject({ _tag: 'Success', value: { _tag: 'Authenticated' } })
    }
    const refused = yield* attempt()
    expect(yield* refused.json).toMatchObject({ _tag: 'Failure', error: { _tag: 'PasswordRejected' } })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'serializes attempt admission, retains fractional refill and expires private buckets',
  Effect.gen(function* () {
    const { url } = yield* stack
    const response = yield* HttpClient.post(`${url}/test/identity/limits`)
    expect(response.status).toBe(200)
    const body: unknown = yield* response.json
    expect(body).toMatchObject({ accepted: 3, rejected: 9, keysAreDigests: true, refilled: true, expired: true })
    if (typeof body !== 'object' || body === null || !('fraction' in body)) throw new Error('Missing refill fraction')
    expect(typeof body.fraction).toBe('number')
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 60000 },
)

test(
  'recovers native wallet receipts, auth sessions and R2 bytes after a Worker restart',
  Effect.gen(function* () {
    const { url, styldUrl } = yield* stack
    expect((yield* HttpClient.post(`${url}/test/recovery/seed`)).status).toBe(204)
    const callAuth = authCall(styldUrl)
    const login = yield* callAuth('signIn', {
      email: 'native-recovery@example.invalid',
      password: 'native-identity-password-52',
    })
    expect(yield* login.json).toMatchObject({ _tag: 'Success', value: { _tag: 'Authenticated' } })
    const cookie = Object.entries(login.cookies.cookies)
      .map(([name, value]) => `${name}=${value.value}`)
      .join('; ')
    const read = () => HttpClient.get(`${url}/test/recovery/read`).pipe(Effect.flatMap((response) => response.json))
    expect(yield* read()).toMatchObject({ generation: 'before', reads: 1, wallet: { subscription: 2 } })
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
      wallet: { subscription: 2, reservations: { 'recovery-operation': { fromSubscription: 8 } } },
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
    expect(yield* (yield* callAuth('getSession', {}, cookie)).json).toMatchObject({
      _tag: 'Success',
      value: { subjectId: 'native-recovery' },
    })
    expect((yield* HttpClient.post(`${url}/test/recovery/replay`)).status).toBe(204)
    expect(yield* read()).toMatchObject({ wallet: { subscription: 2 } })
    expect((yield* HttpClient.post(`${url}/test/recovery/settle`)).status).toBe(204)
    expect(yield* read()).toMatchObject({ wallet: { subscription: 10, reservations: {} } })
  }).pipe(Effect.provide(FetchHttpClient.layer)),
  { timeout: 120000 },
)
