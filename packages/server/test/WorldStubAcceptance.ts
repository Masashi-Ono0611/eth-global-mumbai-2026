import { expect } from 'bun:test'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { seedRobot } from './ConsoleBrowserAcceptance.ts'
import { makeSoftwareAuthenticator, registerPasskey, sessionCookie } from './PasskeyFixture.ts'
import type { ZeroGStub } from './RobotAcceptance.ts'

type Urls = { readonly appUrl: string; readonly url: string; readonly apiUrl: string }

/** A throwaway RSA key for the native stack's rehearsal issuer (generated per run, never written anywhere). */
export const TEST_WORLD_STUB_JWK = JSON.stringify(
  await crypto.subtle
    .generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )
    .then((pair) => crypto.subtle.exportKey('jwk', pair.privateKey)),
)
/** Any address works for the native stack: it only names the approval's EIP-712 domain. */
export const TEST_ENFORCER_ADDRESS = '0x00000000000000000000000000000000000e0f0e'

const Created = Schema.Struct({ episodeId: Schema.String, state: Schema.String, approvalUrl: Schema.String })
const State = Schema.Struct({ episode: Schema.Struct({ state: Schema.String }) })
const ApprovalView = Schema.Struct({ status: Schema.String, error: Schema.NullOr(Schema.String) })

const unescape = (html: string) => html.replaceAll('&amp;', '&').replaceAll('&quot;', '"')

/** One restricted errand answered through the stub's page: `approve` or `deny`. Returns the callback URL it used. */
const answer = async (
  urls: Urls,
  owner: { readonly accountId: string; readonly cookie: string },
  choice: 'approve' | 'deny',
) => {
  const origin = new URL(urls.appUrl).origin
  const robotId = await seedRobot(urls.url, owner.accountId)
  const started = await fetch(`${urls.apiUrl}/api/robots/${robotId}/errands`, {
    method: 'POST',
    headers: { origin, cookie: owner.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ item: 'cigarettes' }),
  })
  expect(started.status).toBe(201)
  const errand = Schema.decodeUnknownSync(Created)(await started.json())
  expect(errand.state).toBe('awaiting_approval')
  const approvalId = errand.approvalUrl.split('/').at(-1) ?? ''
  const authorize = await fetch(`${urls.appUrl}/api/world/authorize?approval=${approvalId}`, {
    headers: { cookie: owner.cookie },
    redirect: 'manual',
  })
  expect(authorize.status).toBe(302)
  const location = authorize.headers.get('location') ?? ''
  expect(location.startsWith(`${origin}/api/dev/world/authorize?`)).toBe(true)
  expect(new URL(location).searchParams.get('max_age')).toBe('0')
  const page = await (await fetch(location)).text()
  expect(page).toContain('STUB IdP — not World — rehearsal only')
  const href = unescape(new RegExp(`id="${choice}" href="([^"]+)"`).exec(page)?.[1] ?? '')
  expect(href.startsWith(`${origin}/api/world/callback?`)).toBe(true)
  const callback = await fetch(href, { redirect: 'manual' })
  expect(callback.status).toBe(302)
  expect(callback.headers.get('location')).toBe(`${origin}/wallet/approvals/${approvalId}`)
  const view = await fetch(`${urls.appUrl}/api/robots/${robotId}/errands/${errand.episodeId}`, {
    headers: { cookie: owner.cookie },
  })
  const approval = await fetch(`${urls.appUrl}/api/approvals/${approvalId}`, { headers: { cookie: owner.cookie } })
  return {
    href,
    state: Schema.decodeUnknownSync(State)(await view.json()).episode.state,
    approval: Schema.decodeUnknownSync(ApprovalView)(await approval.json()),
  }
}

const tokenGuards = async (appUrl: string, usedCallback: string) => {
  const code = new URL(usedCallback).searchParams.get('code') ?? ''
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${new URL(appUrl).origin}/api/world/callback`,
  })
  const post = (authorization: string) =>
    fetch(`${appUrl}/api/dev/world/token`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
  expect((await post(`Basic ${btoa('stub:wrong')}`)).status).toBe(401)
  expect(await (await post(`Basic ${btoa('stub:stub')}`)).json()).toEqual({ error: 'invalid_grant' })
  const discovery = await (await fetch(`${appUrl}/api/dev/world/.well-known/openid-configuration`)).json()
  expect(discovery).toMatchObject({
    issuer: `${new URL(appUrl).origin}/api/dev/world`,
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
  })
}

const rehearse = async (urls: Urls, owner: { readonly accountId: string; readonly cookie: string }) => {
  const approved = await answer(urls, owner, 'approve')
  expect(approved.state).toBe('signing')
  expect(approved.approval).toEqual({ status: 'approved', error: null })
  expect((await fetch(approved.href, { redirect: 'manual' })).status).toBe(409)
  const denied = await answer(urls, owner, 'deny')
  expect(denied.state).toBe('denied')
  expect(denied.approval).toEqual({ status: 'denied', error: 'World answered access_denied' })
  await tokenGuards(urls.appUrl, approved.href)
}

/**
 * The rehearsal issuer (world/Stub.ts) mounted on the native stack: a restricted errand → World authorize → the stub's
 * Approve → our callback verifies its RS256 token → the errand continues to `signing`; Deny → `denied`, nothing signed.
 * A replayed callback is 409; the stub's token endpoint refuses a wrong client secret and a spent code.
 */
export const registerWorldStubAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>, zeroG: ZeroGStub) =>
  test(
    'world stub (rehearsal only): Approve → co-signed approval → signing; Deny → denied; replay 409; token guards',
    Effect.gen(function* () {
      const urls = yield* stack
      zeroG.setMode('pay')
      const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator())
      const { response } = yield* registerPasskey(urls.appUrl, authenticator, 'Stub Owner')
      const { accountId } = yield* Schema.decodeUnknownEffect(Schema.Struct({ accountId: Schema.String }))(
        yield* response.json,
      )
      const owner = { accountId, cookie: sessionCookie(response) }
      yield* Effect.promise(() => rehearse(urls, owner))
    }).pipe(Effect.provide(FetchHttpClient.layer)),
    { timeout: 90000 },
  )
