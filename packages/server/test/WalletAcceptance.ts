import { expect } from 'bun:test'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import { makeSoftwareAuthenticator, passkeyCall, registerPasskey, sessionCookie } from './PasskeyFixture.ts'

type Urls = { readonly appUrl: string }

const AddedRobot = Schema.Struct({
  robotId: Schema.String.check(Schema.isPattern(/^[a-z2-7]{26}$/)),
  pairingCode: Schema.String.check(Schema.isPattern(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)),
  pairingExpiresAt: Schema.Finite,
})
/** The wallet API on the native Worker: session + Origin guards, "Add robot" pairing codes, and the grant routes
 * answering 503 `not configured` while the native stack has no enforcer/approver/relayer bindings. */
export const registerWalletAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>) =>
  test(
    'wallet: owner-scoped robots with pairing codes, session and Origin guards, grants 503 until configured',
    Effect.gen(function* () {
      const { appUrl } = yield* stack
      const call = passkeyCall(appUrl)
      const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator())
      const { response } = yield* registerPasskey(appUrl, authenticator, 'Wallet Owner')
      const cookie = sessionCookie(response)

      expect((yield* call('/api/robots', { name: 'Duck' })).status).toBe(401)
      expect((yield* HttpClient.post(`${appUrl}/api/robots`, { headers: { cookie } })).status).toBe(403)
      const added = yield* call('/api/robots', { name: '  Duck  ' }, cookie)
      expect(added.status).toBe(201)
      const robot = yield* Schema.decodeUnknownEffect(AddedRobot)(yield* added.json)
      expect((yield* call('/api/robots', { name: '' }, cookie)).status).toBe(400)

      const listed = yield* HttpClient.get(`${appUrl}/api/robots`, { headers: { cookie } })
      expect(listed.status).toBe(200)
      const robots: unknown = yield* listed.json
      expect(robots).toEqual({
        robots: [
          {
            id: robot.robotId,
            name: 'Duck',
            status: 'unpaired',
            chipAddress: null,
            pairingCode: robot.pairingCode,
            pairingExpiresAt: robot.pairingExpiresAt,
            lease: { until: null, online: false },
            grant: null,
          },
        ],
      })

      const stranger = yield* registerPasskey(appUrl, yield* Effect.promise(() => makeSoftwareAuthenticator()), 'Other')
      const strangers = yield* HttpClient.get(`${appUrl}/api/robots`, {
        headers: { cookie: sessionCookie(stranger.response) },
      })
      expect(yield* strangers.json).toEqual({ robots: [] })

      const options = yield* call(
        '/api/wallet/grants/options',
        { robotId: robot.robotId, dailyCap: '1.00', perPaymentCap: '0.30', allowlist: [], expiresAt: 0 },
        cookie,
      )
      expect(options.status).toBe(400)
      const unconfigured = yield* call(
        '/api/wallet/grants/options',
        {
          robotId: robot.robotId,
          dailyCap: '1.00',
          perPaymentCap: '0.30',
          allowlist: ['0x000000000000000000000000000000000000c0de'],
          expiresAt: 4_000_000_000,
        },
        cookie,
      )
      expect(unconfigured.status).toBe(503)
      const refusal = yield* Schema.decodeUnknownEffect(Schema.Struct({ error: Schema.String }))(
        yield* unconfigured.json,
      )
      expect(refusal.error).toMatch(/^not configured: /)
      expect((yield* call('/api/wallet/grants/nope/revoke/options', {}, cookie)).status).toBe(404)
      const wallet = yield* HttpClient.get(`${appUrl}/api/wallet`, { headers: { cookie } })
      expect(wallet.status).toBe(200)
      expect(yield* wallet.json).toMatchObject({
        account: { displayName: 'Wallet Owner', deployStatus: 'counterfactual' },
      })
      expect((yield* HttpClient.get(`${appUrl}/api/approvals/nope`, { headers: { cookie } })).status).toBe(404)
      // The native stack binds no WORLD_* client: approval sign-in answers 503 instead of redirecting to World.
      const authorize = yield* HttpClient.get(`${appUrl}/api/world/authorize?approval=nope`, { headers: { cookie } })
      expect(authorize.status).toBe(503)
      expect((yield* HttpClient.get(`${appUrl}/api/world/callback?state=nope&code=x`)).status).toBe(404)
      expect((yield* call('/api/approvals/nope/deny', {}, cookie)).status).toBe(404)
      const activity = yield* HttpClient.get(`${appUrl}/api/wallet/activity`, { headers: { cookie } })
      expect(yield* activity.json).toEqual({ episodes: [], grants: [] })
    }).pipe(Effect.provide(FetchHttpClient.layer)),
    { timeout: 90000 },
  )
