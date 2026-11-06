import type { PreparedStatement } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Effect, Option, Schema } from 'effect'

/** D1 rows are untrusted shapes until decoded; a row that does not match its table schema is a broken invariant. */
export const firstRow = <A>(statement: PreparedStatement, schema: Schema.ConstraintDecoder<A>) =>
  statement
    .first()
    .pipe(
      Effect.flatMap((row) =>
        row === null
          ? Effect.succeed(Option.none<A>())
          : Schema.decodeUnknownEffect(schema)(row).pipe(Effect.asSome, Effect.orDie),
      ),
    )

export const allRows = <A>(statement: PreparedStatement, schema: Schema.ConstraintDecoder<A>) =>
  statement
    .all()
    .pipe(
      Effect.flatMap((result) =>
        Effect.forEach(result.results, (row) => Schema.decodeUnknownEffect(schema)(row).pipe(Effect.orDie)),
      ),
    )

/** Rows changed by a write: conditional updates (`WHERE status = ?`) use this to decide who won a race. */
export const changes = (statement: PreparedStatement) =>
  statement.run().pipe(Effect.map((result) => result.meta.changes))

/** SQLite booleans are 0 / 1 integers. */
export const SqlBoolean = Schema.Literals([0, 1])
