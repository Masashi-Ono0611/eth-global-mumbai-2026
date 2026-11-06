import { Effect, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import {
  AssertionOptions,
  type AssertionRequest,
  authPaths,
  RegistrationOptions,
  type RegistrationRequest,
  SessionView,
  SignedIn,
} from './config.ts'

/** Same-origin JSON POST to the Worker; the browser adds the `Origin` header the routes require. */
const postJson = <S extends Schema.Constraint>(path: string, body: unknown, schema: S) =>
  Effect.gen(function* () {
    const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const response = yield* client.execute(HttpClientRequest.post(path).pipe(HttpClientRequest.bodyJsonUnsafe(body)))
    return yield* HttpClientResponse.schemaBodyJson(schema)(response)
  })

export const registrationOptions = (displayName: string) =>
  postJson(authPaths.registerOptions, { displayName }, RegistrationOptions)

export const register = (request: RegistrationRequest) => postJson(authPaths.registerVerify, request, SignedIn)

export const loginOptions = postJson(authPaths.loginOptions, {}, AssertionOptions)

export const login = (request: AssertionRequest) => postJson(authPaths.loginVerify, request, SignedIn)

/** The signed-in account, or `null` when the Worker answers 401. */
export const readSession = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.execute(HttpClientRequest.get(authPaths.session))
  if (response.status === 401) return null
  const ok = yield* HttpClientResponse.filterStatusOk(response)
  return yield* HttpClientResponse.schemaBodyJson(SessionView)(ok)
})

export const logout = Effect.gen(function* () {
  const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
  yield* client.execute(HttpClientRequest.post(authPaths.logout))
})
