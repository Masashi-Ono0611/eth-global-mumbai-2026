import { expect } from 'bun:test'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Schema } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'
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

const AuditApprovals = Schema.Struct({
  approvals: Schema.Array(
    Schema.Struct({
      status: Schema.String,
      world: Schema.NullOr(Schema.Struct({ acr: Schema.NullOr(Schema.String), amr: Schema.Array(Schema.String) })),
    }),
  ),
})

const unescape = (html: string) => html.replaceAll('&amp;', '&').replaceAll('&quot;', '"')

/** One over-the-cap thali answered through the stub's page: `approve` or `deny`. Returns the callback URL it used. */
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
    body: JSON.stringify({ item: 'thali' }),
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
  const sent = new URL(location).searchParams
  expect(sent.get('max_age')).toBe('0')
  expect(sent.get('code_challenge_method')).toBe('S256')
  expect(sent.get('code_challenge')).toMatch(/^[\w-]{43}$/)
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
    episodeId: errand.episodeId,
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

const s256 = async (verifier: string) =>
  Base64Url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))

/** A code from the stub's own authorize page for this challenge (or its 400 when the request carries none). */
const stubCode = async (appUrl: string, challenge: string | null) => {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'stub',
    redirect_uri: `${new URL(appUrl).origin}/api/world/callback`,
    state: 'pkce-guard',
    nonce: 'pkce-guard',
    ...(challenge === null ? {} : { code_challenge: challenge, code_challenge_method: 'S256' }),
  })
  const page = await fetch(`${appUrl}/api/dev/world/authorize?${query}`)
  const href = unescape(/id="approve" href="([^"]+)"/.exec(await page.text())?.[1] ?? '')
  return { status: page.status, code: href === '' ? '' : (new URL(href).searchParams.get('code') ?? '') }
}

/** PKCE at the stub: no challenge → 400; a wrong or missing verifier → invalid_grant; the right one → an ID token. */
const pkceGuards = async (appUrl: string) => {
  expect((await stubCode(appUrl, null)).status).toBe(400)
  const verifier = Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)))
  const redeem = async (verifierSent: string | null) => {
    const { code } = await stubCode(appUrl, await s256(verifier))
    const response = await fetch(`${appUrl}/api/dev/world/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${btoa('stub:stub')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${new URL(appUrl).origin}/api/world/callback`,
        ...(verifierSent === null ? {} : { code_verifier: verifierSent }),
      }),
    })
    return {
      status: response.status,
      body: Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(await response.json()),
    }
  }
  const wrong = Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)))
  expect(await redeem(wrong)).toEqual({ status: 400, body: { error: 'invalid_grant' } })
  expect(await redeem(null)).toEqual({ status: 400, body: { error: 'invalid_grant' } })
  const granted = await redeem(verifier)
  expect(granted.status).toBe(200)
  expect(typeof granted.body['id_token']).toBe('string')
}

const rehearse = async (urls: Urls, owner: { readonly accountId: string; readonly cookie: string }) => {
  const approved = await answer(urls, owner, 'approve')
  expect(approved.state).toBe('signing')
  expect(approved.approval).toEqual({ status: 'approved', error: null })
  expect((await fetch(approved.href, { redirect: 'manual' })).status).toBe(409)
  // The audit view records what the issuer asserted (acr, amr), never the token, jti or sub.
  const audit = await fetch(`${urls.appUrl}/api/wallet/episodes/${approved.episodeId}`, {
    headers: { cookie: owner.cookie },
  })
  expect(Schema.decodeUnknownSync(AuditApprovals)(await audit.json()).approvals).toEqual([
    { status: 'approved', world: { acr: 'https://world.org/oidc/acr/orb', amr: ['pop', 'user', 'mfa'] } },
  ])
  const denied = await answer(urls, owner, 'deny')
  expect(denied.state).toBe('denied')
  expect(denied.approval).toEqual({ status: 'denied', error: 'World answered access_denied' })
  await tokenGuards(urls.appUrl, approved.href)
  await pkceGuards(urls.appUrl)
}

/**
 * The rehearsal issuer (world/Stub.ts) mounted on the native stack: a restricted errand → World authorize → the stub's
 * Approve → our callback verifies its RS256 token → the errand continues to `signing`; Deny → `denied`, nothing signed.
 * A replayed callback is 409; the stub's token endpoint refuses a wrong client secret, a spent code and a wrong or
 * missing PKCE verifier (the authorize redirect carries an `S256` challenge, the callback sends the attempt's verifier).
 */
export const registerWorldStubAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>, zeroG: ZeroGStub) =>
  test(
    'world stub (rehearsal only): Approve → co-signed approval → signing; Deny → denied; replay 409; token and PKCE guards',
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
