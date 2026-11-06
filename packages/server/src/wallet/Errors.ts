import type { ChallengeRejected, PasskeyRejected } from '@ethmumbai/auth'
import { Effect, Option, Schema } from 'effect'
import type * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { answerRejections, type BadRequest } from '../auth/Routes.ts'
import { jsonError, notConfigured } from '../Respond.ts'

/** A feature binding is missing or invalid: its routes answer 503 `not configured: <name>` (spec §10). */
export class NotConfigured extends Schema.TaggedError<NotConfigured>()('NotConfigured', { name: Schema.String }) {}
export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { what: Schema.String }) {}
export class Conflict extends Schema.TaggedError<Conflict>()('Conflict', { detail: Schema.String }) {}
/** Arc refused or did not answer (a revert reason, an RPC failure, a failed receipt). */
export class ChainFailed extends Schema.TaggedError<ChainFailed>()('ChainFailed', {
  stage: Schema.String,
  reason: Schema.String,
}) {}

export const required = <A>(value: Option.Option<A>, name: string) =>
  Option.match(value, {
    onNone: () => Effect.fail(NotConfigured.make({ name })),
    onSome: (present) => Effect.succeed(present),
  })

export type WalletError =
  | BadRequest
  | ChallengeRejected
  | PasskeyRejected
  | NotConfigured
  | NotFound
  | Conflict
  | ChainFailed

/** One mapping from typed failures to HTTP answers for every wallet route. */
export const answerWalletErrors = <R>(handler: Effect.Effect<HttpServerResponse.HttpServerResponse, WalletError, R>) =>
  answerRejections(
    handler.pipe(
      Effect.catchTags({
        NotConfigured: ({ name }) => notConfigured(name),
        NotFound: ({ what }) => jsonError(404, `${what} not found`),
        Conflict: ({ detail }) => jsonError(409, detail),
        ChainFailed: ({ stage, reason }) =>
          Effect.logWarning('arc refused', { stage, reason }).pipe(
            Effect.andThen(jsonError(502, 'arc refused', { stage, reason })),
          ),
      }),
    ),
  )
