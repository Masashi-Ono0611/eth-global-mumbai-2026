import { Clock, Effect, Option, Schema } from 'effect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'

/** Bindings as the Worker receives them: untrusted until decoded. */
export type Bindings = Readonly<Record<string, unknown>>

/** A JSON response; serialisation of plain data cannot fail, so a failure is a defect. */
export const json = (body: unknown, status = 200, headers?: Readonly<Record<string, string>>) =>
  HttpServerResponse.json(body, headers === undefined ? { status } : { status, headers }).pipe(Effect.orDie)

export const jsonError = (status: number, error: string, extra?: Readonly<Record<string, unknown>>) =>
  json({ error, ...extra }, status)

/** A feature whose binding is missing answers this until the real value exists (spec §10). */
export const notConfigured = (name: string) => jsonError(503, `not configured: ${name}`)

/**
 * Decode a feature binding without making the Worker unusable: a missing or invalid value becomes `None` and one
 * warning (the name only, never the value), and the routes that need it answer 503.
 */
export const optionalBinding = <A>(env: Bindings, name: string, schema: Schema.ConstraintDecoder<A>) =>
  Schema.decodeUnknownEffect(schema)(env[name]).pipe(
    Effect.asSome,
    Effect.catch(() =>
      Effect.as(Effect.logWarning(`binding ${name} is missing or invalid; its routes answer 503`), Option.none<A>()),
    ),
  )

/** Unix seconds from the Effect clock (never `Date`). */
export const nowSeconds = Effect.map(Clock.currentTimeMillis, (millis) => Math.floor(millis / 1000))

/** Cryptographically random bytes from the platform (Workers, Bun and browsers all provide Web Crypto). */
export const randomBytes = (size: number) => Effect.sync(() => crypto.getRandomValues(new Uint8Array(size)))

export const sha256Hex = (text: string) =>
  Effect.promise(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).pipe(
    Effect.map((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')),
  )
