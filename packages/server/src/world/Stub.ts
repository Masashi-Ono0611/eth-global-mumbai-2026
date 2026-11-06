import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { Clock, Effect, Layer, Option, Redacted, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as Base64Url from 'effect/encoding/Base64Url'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { type Bindings, json, jsonError, nowSeconds, optionalBinding, randomBytes } from '../Respond.ts'
import { firstRow } from '../Sql.ts'
import { callbackUrl } from './Authorize.ts'
import { type WorldClient, WorldUnavailable } from './Config.ts'
import type { Jwk } from './Verify.ts'

/**
 * REHEARSAL ONLY: an OpenID provider inside our own Worker that stands in for World IdP while the real client is
 * pending. It asks nobody for anything: its Approve button proves no human, so it is mounted only when
 * `WORLD_ISSUER` names it and `WORLD_STUB_JWK` holds its RSA key. It exists so the over-cap / restricted path (approval
 * → co-signature → the chip signs → our enforcer on Arc) runs end to end. The submission uses auth.world.org.
 */
export const STUB_PATH = '/api/dev/world'
const STUB_CLIENT = 'stub'
const STUB_SUBJECT = 'stub-owner-1'
const ORB = 'https://world.org/oidc/acr/orb'
const CODE_SECONDS = 300

export const stubIssuer = (origin: string) => `${new URL(origin).origin}${STUB_PATH}`

const PrivateJwk = Schema.Struct({
  kty: Schema.Literal('RSA'),
  n: Schema.String,
  e: Schema.String,
  d: Schema.String,
  p: Schema.String,
  q: Schema.String,
  dp: Schema.String,
  dq: Schema.String,
  qi: Schema.String,
})
const encoder = new TextEncoder()

/** RFC 7638 thumbprint of the public half: the same `kid` in every isolate, the way World names its keys. */
const thumbprint = (n: string, e: string) =>
  Effect.promise(() => crypto.subtle.digest('SHA-256', encoder.encode(`{"e":"${e}","kty":"RSA","n":"${n}"}`))).pipe(
    Effect.map((digest) => Base64Url.encode(new Uint8Array(digest))),
  )

const signJwt = (key: CryptoKey, kid: string, claims: object) =>
  Effect.promise(async () => {
    const body = `${Base64Url.encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }))}.${Base64Url.encode(JSON.stringify(claims))}`
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(body))
    return `${body}.${Base64Url.encode(new Uint8Array(signature))}`
  })

const CodeRef = Schema.fromJsonString(Schema.Struct({ nonce: Schema.String, redirectUri: Schema.String }))

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

type Stub = {
  readonly database: QueryDatabaseClient
  readonly origin: string
  readonly issuer: string
  readonly key: CryptoKey
  readonly publicJwk: Jwk
}

/** Spends an authorization code once (it lives in `auth_challenges`, kind `world_stub`) and mints the ID token. */
const redeem = Effect.fn('EthMumbai.World.stubRedeem')(function* (stub: Stub, code: string, redirectUri: string) {
  const now = yield* nowSeconds
  const spent = yield* firstRow(
    stub.database
      .prepare(
        "UPDATE auth_challenges SET used = 1 WHERE id = ? AND kind = 'world_stub' AND used = 0 AND expires_at > ? RETURNING ref",
      )
      .bind(code, now),
    Schema.Struct({ ref: Schema.String }),
  )
  if (Option.isNone(spent)) return Option.none<string>()
  const ref = yield* Schema.decodeUnknownEffect(CodeRef)(spent.value.ref).pipe(Effect.orDie)
  if (ref.redirectUri !== redirectUri) return Option.none<string>()
  const jti = Base64Url.encode(yield* randomBytes(16))
  const token = yield* signJwt(stub.key, stub.publicJwk.kid, {
    iss: stub.issuer,
    sub: STUB_SUBJECT,
    aud: STUB_CLIENT,
    exp: now + 300,
    iat: now,
    jti,
    auth_time: now,
    acr: ORB,
    amr: ['pop'],
    nonce: ref.nonce,
  })
  return Option.some(token)
})

const AuthorizeQuery = Schema.Struct({
  response_type: Schema.Literal('code'),
  client_id: Schema.Literal(STUB_CLIENT),
  redirect_uri: Schema.String,
  state: Schema.String.check(Schema.isMaxLength(128)),
  nonce: Schema.String.check(Schema.isMaxLength(128)),
})

const page = (stub: Stub, query: typeof AuthorizeQuery.Type, code: string) => {
  const back = (params: Record<string, string>) =>
    escapeHtml(`${query.redirect_uri}?${new URLSearchParams({ ...params, state: query.state, iss: stub.issuer })}`)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>STUB IdP — not World</title><style>body{font-family:system-ui,sans-serif;margin:2rem;max-width:40rem}h1{font-size:2.5rem;color:#b00020}dd{font-family:monospace;overflow-wrap:anywhere}a{display:inline-block;margin:1rem 1rem 0 0;padding:1rem 2rem;font-size:1.25rem;border:2px solid #000;text-decoration:none;color:#000}</style></head><body>
<h1>STUB IdP — not World — rehearsal only</h1>
<p>This page stands in for World ID while our World client is pending. It asks nobody to prove anything.</p>
<dl><dt>state</dt><dd>${escapeHtml(query.state)}</dd><dt>nonce</dt><dd>${escapeHtml(query.nonce)}</dd></dl>
<a id="approve" href="${back({ code })}">Approve</a><a id="deny" href="${back({ error: 'access_denied' })}">Deny</a>
</body></html>`
}

/** `GET …/authorize`: only our own client and callback; issues a single-use code and shows Approve / Deny. */
const authorize = (stub: Stub) =>
  Effect.gen(function* () {
    const query = yield* HttpServerRequest.schemaSearchParams(AuthorizeQuery).pipe(Effect.option)
    if (Option.isNone(query) || query.value.redirect_uri !== callbackUrl(stub.origin))
      return HttpServerResponse.text('stub IdP: unknown client or redirect_uri', { status: 400 })
    const code = Base64Url.encode(yield* randomBytes(32))
    const now = yield* nowSeconds
    yield* stub.database
      .prepare(
        "INSERT INTO auth_challenges (id, kind, account_id, ref, expires_at, used, created_at) VALUES (?, 'world_stub', NULL, ?, ?, 0, ?)",
      )
      .bind(
        code,
        JSON.stringify({ nonce: query.value.nonce, redirectUri: query.value.redirect_uri }),
        now + CODE_SECONDS,
        yield* Clock.currentTimeMillis,
      )
      .run()
    return HttpServerResponse.text(page(stub, query.value, code), {
      contentType: 'text/html; charset=utf-8',
      headers: {
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        'x-frame-options': 'DENY',
      },
    })
  })

const TokenBody = Schema.Struct({
  grant_type: Schema.Literal('authorization_code'),
  code: Schema.String,
  redirect_uri: Schema.String,
})
const STUB_BASIC = `Basic ${Base64.encode(`${STUB_CLIENT}:${STUB_CLIENT}`)}`

/** `POST …/token`: `client_secret_basic` with `stub:stub`, a single-use code → the RS256 ID token. */
const token = (stub: Stub) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (request.headers.authorization !== STUB_BASIC) return yield* jsonError(401, 'invalid_client')
    const body = yield* HttpServerRequest.schemaBodyUrlParams(TokenBody).pipe(Effect.option)
    if (Option.isNone(body)) return yield* jsonError(400, 'invalid_request')
    const minted = yield* redeem(stub, body.value.code, body.value.redirect_uri)
    if (Option.isNone(minted)) return yield* jsonError(400, 'invalid_grant')
    return yield* json(
      {
        id_token: minted.value,
        token_type: 'Bearer',
        expires_in: 300,
        access_token: Base64Url.encode(yield* randomBytes(16)),
      },
      200,
      { 'cache-control': 'no-store' },
    )
  })

const discovery = (stub: Stub) =>
  json({
    issuer: stub.issuer,
    authorization_endpoint: `${stub.issuer}/authorize`,
    token_endpoint: `${stub.issuer}/token`,
    jwks_uri: `${stub.issuer}/jwks`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    scopes_supported: ['openid'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
    acr_values_supported: [ORB],
    claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'jti', 'nonce', 'auth_time', 'acr', 'amr'],
  })

const stubRoutes = (stub: Stub) =>
  Layer.mergeAll(
    HttpRouter.add('GET', `${STUB_PATH}/.well-known/openid-configuration`, discovery(stub)),
    HttpRouter.add('GET', `${STUB_PATH}/jwks`, json({ keys: [stub.publicJwk] })),
    HttpRouter.add('GET', `${STUB_PATH}/authorize`, authorize(stub)),
    HttpRouter.add('POST', `${STUB_PATH}/token`, token(stub)),
  )

/**
 * The rehearsal issuer, or none: mounted only when `WORLD_ISSUER` is exactly `${AUTH_ORIGIN}/api/dev/world` and
 * `WORLD_STUB_JWK` is its private RSA JWK (the public key and `kid` are derived from it). The Worker's own approval
 * client then talks to it in process (a Worker cannot fetch its own workers.dev host), with the same RS256 checks.
 */
export const makeWorldStub = Effect.fn('EthMumbai.World.makeStub')(function* (
  database: QueryDatabaseClient,
  env: Bindings,
  origin: string,
) {
  const issuer = stubIssuer(origin)
  if (env['WORLD_ISSUER'] !== issuer) return Option.none()
  const jwk = yield* optionalBinding(env, 'WORLD_STUB_JWK', Schema.fromJsonString(PrivateJwk))
  if (Option.isNone(jwk)) return Option.none()
  const key = yield* Effect.tryPromise(() =>
    crypto.subtle.importKey(
      'jwk',
      { ...jwk.value, alg: 'RS256' },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    ),
  ).pipe(Effect.option)
  if (Option.isNone(key)) {
    yield* Effect.logWarning('WORLD_STUB_JWK is not a usable RSA key; the rehearsal issuer stays off')
    return Option.none()
  }
  const { n, e } = jwk.value
  const publicJwk: Jwk = { kid: yield* thumbprint(n, e), kty: 'RSA', n, e, alg: 'RS256', use: 'sig' }
  const stub: Stub = { database, origin, issuer, key: key.value, publicJwk }
  const runtime = yield* Effect.context<RuntimeContext>()
  yield* Effect.logWarning('WORLD IdP is the in-Worker rehearsal stub: approvals prove no human')
  const client: WorldClient = {
    issuer,
    clientId: STUB_CLIENT,
    bindsSubject: false,
    authorizationEndpoint: Effect.succeed(`${issuer}/authorize`),
    keys: () => Effect.succeed([publicJwk]),
    exchange: (code, redirectUri) =>
      redeem(stub, code, redirectUri).pipe(
        Effect.provideContext(runtime),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(WorldUnavailable.make({ stage: 'token' })),
            onSome: (idToken) => Effect.succeed(Redacted.make(idToken)),
          }),
        ),
      ),
  }
  return Option.some({ client, routes: stubRoutes(stub) })
})
