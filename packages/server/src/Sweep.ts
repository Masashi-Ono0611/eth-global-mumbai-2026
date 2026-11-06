import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Effect, Option, Schema } from 'effect'
import { LIVE_STATES, tickRobot } from './robot/Errands.ts'
import { allRows } from './Sql.ts'
import type { TelegramConfig } from './telegram/Config.ts'
import { flushOutbox } from './telegram/Deliver.ts'

// The once-a-minute sweep (Cron Trigger on the API Worker). Timeouts and notifications are otherwise lazy: they run on
// the next read or after the next response, so an errand nobody looks at would never expire and its Telegram message
// would wait for unrelated traffic. The sweep applies the same lazy rules on a clock; it never decides anything new.

const LiveRobot = Schema.Struct({ robot_id: Schema.String })

/** Apply every due errand timeout (an unanswered approval expires and queues `approval_expired`) for robots with a
 * live errand. */
export const sweepLiveErrands = Effect.fn('EthMumbai.Sweep.errands')(function* (database: QueryDatabaseClient) {
  const robots = yield* allRows(
    database
      .prepare(`SELECT DISTINCT robot_id FROM episodes WHERE state IN (${LIVE_STATES.map(() => '?').join(', ')})`)
      .bind(...LIVE_STATES),
    LiveRobot,
  )
  yield* Effect.forEach(robots, (robot) => tickRobot(database, robot.robot_id), { discard: true })
})

/** One sweep: errand timeouts first (they may queue notifications), then the Telegram outbox. Never fails. */
export const sweep = (deps: {
  readonly database: QueryDatabaseClient
  readonly origin: string
  readonly telegram: Option.Option<TelegramConfig>
}) =>
  sweepLiveErrands(deps.database).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning('sweep: errand timeouts failed').pipe(Effect.annotateLogs({ cause })),
    ),
    Effect.andThen(
      Option.match(deps.telegram, {
        onNone: () => Effect.void,
        onSome: (config) => flushOutbox({ database: deps.database, origin: deps.origin, config }),
      }),
    ),
    Effect.withSpan('EthMumbai.Sweep'),
  )
