import { Effect, Layer } from 'effect'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { describe, expect, test } from 'vitest'
import { CreatePasskeyWallet, SignInWithPasskey } from '../src/command.ts'
import { Message } from '../src/message.ts'
import { fixturePasskeysLayer, PasskeyFailed, Passkeys } from '../src/Passkey.ts'
import { GrantAllowance, Message as AllowanceMessage, StopAllowance } from '../src/pages/Allowance.ts'

type Call = { readonly method: string; readonly path: string; readonly body: unknown }

const registration = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { id: 'app.test', name: 'Vitaquack' },
  user: { id: 'YWNjb3VudA', name: 'Ana' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  attestation: 'none',
  timeout: 300000,
}
const account = { accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa', smartAccount: '0x1234567890abcdef1234567890ABCDEF12345678' }

/** A Worker stand-in that answers each route with fixed JSON and records what the command sent. */
const worker = (answers: Readonly<Record<string, readonly [number, unknown]>>, calls: Array<Call>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) => {
      const [status, body] = answers[url.pathname] ?? [404, {}]
      const { body: sentBody } = request
      const sent: unknown =
        sentBody instanceof HttpBody.Uint8Array ? JSON.parse(new TextDecoder().decode(sentBody.body)) : null
      calls.push({ method: request.method, path: url.pathname, body: sent })
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
        ),
      )
    }).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl('https://app.test'))),
  )

describe('passkey commands', () => {
  test('signup fetches options, creates the passkey and posts its credential for verification', async () => {
    const calls: Array<Call> = []
    const http = worker(
      {
        '/api/passkeys/register/options': [200, registration],
        '/api/passkeys/register/verify': [200, account],
      },
      calls,
    )
    const result = await Effect.runPromise(
      CreatePasskeyWallet({ displayName: 'Ana' }).effect.pipe(Effect.provide(Layer.merge(http, fixturePasskeysLayer))),
    )
    expect(result).toEqual(Message.SucceededCreatePasskeyWallet({ session: { ...account, displayName: 'Ana' } }))
    expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /api/passkeys/register/options',
      'POST /api/passkeys/register/verify',
    ])
    expect(calls[0]?.body).toEqual({ displayName: 'Ana' })
    expect(calls[1]?.body).toMatchObject({ credentialId: 'Zml4dHVyZS1jcmVkZW50aWFs', publicKeyAlgorithm: -7 })
  })

  test('a dismissed prompt is a passkey failure and a Worker refusal is a server failure', async () => {
    const dismissed = Layer.succeed(
      Passkeys,
      Passkeys.of({
        create: () => Effect.fail(PasskeyFailed.make({ reason: 'dismissed' })),
        get: () => Effect.fail(PasskeyFailed.make({ reason: 'dismissed' })),
      }),
    )
    const options = worker(
      {
        '/api/passkeys/login/options': [
          200,
          { challenge: 'Y2g', rpId: 'app.test', userVerification: 'required', timeout: 1 },
        ],
      },
      [],
    )
    expect(
      await Effect.runPromise(SignInWithPasskey().effect.pipe(Effect.provide(Layer.merge(options, dismissed)))),
    ).toEqual(Message.FailedSignInWithPasskey({ failure: 'passkey' }))
    const refusing = worker(
      {
        '/api/passkeys/register/options': [200, registration],
        '/api/passkeys/register/verify': [400, { error: 'passkey rejected' }],
      },
      [],
    )
    expect(
      await Effect.runPromise(
        CreatePasskeyWallet({ displayName: 'Ana' }).effect.pipe(
          Effect.provide(Layer.merge(refusing, fixturePasskeysLayer)),
        ),
      ),
    ).toEqual(Message.FailedCreatePasskeyWallet({ failure: 'server' }))
  })

  const prompt = {
    grantId: 'g1',
    challenge: 'Y2g',
    rpId: 'app.test',
    userVerification: 'required',
    timeout: 1,
    allowCredentials: ['Zml4dHVyZS1jcmVkZW50aWFs'],
  }

  test('a grant runs options, the passkey over the challenge, then sign; the Worker answers are decoded', async () => {
    const calls: Array<Call> = []
    const http = worker(
      {
        '/api/wallet/grants/options': [201, prompt],
        '/api/wallet/grants/g1/sign': [200, { grantId: 'g1', status: 'active', deployTx: null }],
      },
      calls,
    )
    const result = await Effect.runPromise(
      GrantAllowance({
        robotId: 'r1',
        dailyCap: '1.00',
        perPaymentCap: '0.30',
        allowlist: ['0xabc'],
        hours: 24,
      }).effect.pipe(Effect.provide(Layer.merge(http, fixturePasskeysLayer))),
    )
    expect(result).toEqual(AllowanceMessage.SucceededGrant())
    expect(calls[0]?.body).toMatchObject({
      robotId: 'r1',
      dailyCap: '1.00',
      perPaymentCap: '0.30',
      allowlist: ['0xabc'],
    })
    expect(calls[1]?.body).toMatchObject({ credentialId: 'Zml4dHVyZS1jcmVkZW50aWFs' })
  })

  test.each([
    [200, { grantId: 'g1', status: 'revoked', revokeTx: '0xab' }],
    [202, { grantId: 'g1', status: 'revoking', revokeTx: null }],
  ])('a revoke answered %i is a success (revoked now, or settled later from Arc)', async (status, body) => {
    const http = worker(
      { '/api/wallet/grants/g1/revoke/options': [200, prompt], '/api/wallet/grants/g1/revoke/sign': [status, body] },
      [],
    )
    const result = await Effect.runPromise(
      StopAllowance({ grantId: 'g1' }).effect.pipe(Effect.provide(Layer.merge(http, fixturePasskeysLayer))),
    )
    expect(result).toEqual(AllowanceMessage.SucceededStop())
  })
})
