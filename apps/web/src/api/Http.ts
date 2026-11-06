import { Effect, Option, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import type * as HttpClientResponse from 'effect/http/HttpClientResponse'

/** A Worker answer the page can explain: its status and the `error` text of the JSON body (if any). */
export class ApiFailure extends Schema.TaggedError<ApiFailure>()('ApiFailure', {
  status: Schema.Number,
  error: Schema.String,
}) {}

const ErrorBody = Schema.Struct({ error: Schema.String })

const decodeOk = <S extends Schema.Constraint>(response: HttpClientResponse.HttpClientResponse, schema: S) =>
  Effect.gen(function* () {
    const body: unknown = yield* response.json.pipe(Effect.orElseSucceed(() => null))
    if (response.status < 200 || response.status >= 300) {
      const reason = Option.match(Schema.decodeUnknownOption(ErrorBody)(body), {
        onNone: () => `HTTP ${response.status}`,
        onSome: (decoded) => decoded.error,
      })
      return yield* ApiFailure.make({ status: response.status, error: reason })
    }
    return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(() => ApiFailure.make({ status: response.status, error: 'unexpected response' })),
    )
  })

const send = <S extends Schema.Constraint>(request: HttpClientRequest.HttpClientRequest, schema: S) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const response = yield* client
      .execute(request)
      .pipe(Effect.mapError(() => ApiFailure.make({ status: 0, error: 'the Worker did not answer' })))
    return yield* decodeOk(response, schema)
  })

/** Same-origin GET of a JSON resource, decoded with `schema`. */
export const getJson = <S extends Schema.Constraint>(path: string, schema: S) =>
  send(HttpClientRequest.get(path), schema)

/** Same-origin JSON POST (the browser adds the `Origin` header every mutating route requires). */
export const postJson = <S extends Schema.Constraint>(path: string, body: unknown, schema: S) =>
  send(HttpClientRequest.post(path).pipe(HttpClientRequest.bodyJsonUnsafe(body)), schema)

/** 401 means the session is gone: the page offers sign-in instead of an error. */
export const isSignedOut = (failure: ApiFailure) => failure.status === 401
