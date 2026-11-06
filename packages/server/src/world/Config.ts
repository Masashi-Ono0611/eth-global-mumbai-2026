import { Clock, Effect, Option, Redacted, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { type Bindings, optionalBinding } from '../Respond.ts'
import { Jwk, Jwks } from './Verify.ts'

/** World IdP did not answer, or answered something unusable (discovery, JWKS, token endpoint). */
export class WorldUnavailable extends Schema.TaggedError<WorldUnavailable>()('WorldUnavailable', {
  stage: Schema.Literals(['discovery', 'jwks', 'token']),
}) {}

const Configured = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((value) => value !== 'pending'),
)
const Issuer = Configured.check(Schema.isPattern(/^https:\/\/[^/\s]+$/))
const Discovery = Schema.Struct({
  issuer: Schema.String,
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  jwks_uri: Schema.String,
})
type Discovery = typeof Discovery.Type
const TokenResponse = Schema.Struct({ id_token: Schema.String })

/** Discovery and keys are cached per isolate for an hour (spec §9); an unknown `kid` refreshes the keys once. */
const CACHE_MILLIS = 60 * 60 * 1000

const getJson = <S extends Schema.Constraint>(url: string, schema: S, stage: WorldUnavailable['stage']) =>
  Effect.gen(function* () {
    const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const response = yield* client.execute(HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson))
    return yield* HttpClientResponse.schemaBodyJson(schema)(response)
  }).pipe(
    Effect.timeout('10 seconds'),
    Effect.mapError(() => WorldUnavailable.make({ stage })),
    Effect.provide(FetchHttpClient.layer),
  )

const cached = <A, E>(load: Effect.Effect<A, E>) => {
  let entry: Option.Option<{ readonly at: number; readonly value: A }> = Option.none()
  return (refresh: boolean) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      if (!refresh && Option.isSome(entry) && now - entry.value.at < CACHE_MILLIS) return entry.value.value
      const value = yield* load
      entry = Option.some({ at: now, value })
      return value
    })
}

/**
 * The World IdP confidential client (`WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET`, `WORLD_ISSUER`), or none while any of
 * them is missing or still the 'pending' placeholder: the approval routes then answer 503 `not configured`.
 */
export const makeWorldClient = Effect.fn('EthMumbai.World.client')(function* (env: Bindings) {
  const clientId = yield* optionalBinding(env, 'WORLD_CLIENT_ID', Configured)
  const clientSecret = yield* optionalBinding(env, 'WORLD_CLIENT_SECRET', Configured)
  const issuer = yield* optionalBinding(env, 'WORLD_ISSUER', Issuer)
  return Option.map(Option.all({ clientId, clientSecret, issuer }), (config) => {
    const discovery = cached(
      getJson(`${config.issuer}/.well-known/openid-configuration`, Discovery, 'discovery').pipe(
        Effect.filterOrFail(
          (document: Discovery) => document.issuer === config.issuer,
          () => WorldUnavailable.make({ stage: 'discovery' }),
        ),
      ),
    )
    const keys = cached(
      Effect.flatMap(discovery(false), (document) => getJson(document.jwks_uri, Jwks, 'jwks')).pipe(
        Effect.map(({ keys: entries }) =>
          entries.flatMap((entry) => Option.toArray(Schema.decodeUnknownOption(Jwk)(entry))),
        ),
      ),
    )
    const basic = `Basic ${Base64.encode(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`)}`
    /** `authorization_code` + the PKCE verifier at the token endpoint with `client_secret_basic`; the ID token only. */
    const exchange = (code: string, redirectUri: string, codeVerifier: Redacted.Redacted) =>
      Effect.gen(function* () {
        const { token_endpoint } = yield* discovery(false)
        const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
        const response = yield* client.execute(
          HttpClientRequest.post(token_endpoint).pipe(
            HttpClientRequest.setHeader('authorization', basic),
            HttpClientRequest.acceptJson,
            HttpClientRequest.bodyUrlParams({
              grant_type: 'authorization_code',
              code,
              redirect_uri: redirectUri,
              code_verifier: Redacted.value(codeVerifier),
            }),
          ),
        )
        const body = yield* HttpClientResponse.schemaBodyJson(TokenResponse)(response)
        return Redacted.make(body.id_token)
      }).pipe(
        Effect.timeout('10 seconds'),
        Effect.mapError(() => WorldUnavailable.make({ stage: 'token' })),
        Effect.provide(FetchHttpClient.layer),
      )
    const client: WorldClient = {
      issuer: config.issuer,
      clientId: config.clientId,
      bindsSubject: true,
      authorizationEndpoint: Effect.map(discovery(false), (document) => document.authorization_endpoint),
      keys,
      exchange,
    }
    return client
  })
})

/** An OIDC issuer the approval flow talks to: World IdP over HTTPS, or the in-Worker rehearsal stub (`Stub.ts`). */
export interface WorldClient {
  readonly issuer: string
  readonly clientId: string
  /** Real World binds the wallet to the first World account it sees; the rehearsal stub must never claim that slot. */
  readonly bindsSubject: boolean
  readonly authorizationEndpoint: Effect.Effect<string, WorldUnavailable>
  readonly keys: (refresh: boolean) => Effect.Effect<ReadonlyArray<Jwk>, WorldUnavailable>
  /** The token endpoint, with the attempt's PKCE `code_verifier` (redacted until it is put in the request body). */
  readonly exchange: (
    code: string,
    redirectUri: string,
    codeVerifier: Redacted.Redacted,
  ) => Effect.Effect<Redacted.Redacted, WorldUnavailable>
}
