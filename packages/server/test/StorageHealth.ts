import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { Effect } from 'effect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'

export const storageHealth = (database: QueryDatabaseClient, media: ReadWriteBucketClient) =>
  Effect.gen(function* () {
    const tables = yield* database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all<{ name: string }>()
    const mediaHealth = yield* media.head('health/sentinel').pipe(Effect.orDie)
    return yield* HttpServerResponse.json({
      database: {
        tables: tables.results
          .map((row) => row.name)
          .filter((name) => !name.startsWith('__') && !name.startsWith('_cf_')),
      },
      media: { sentinel: mediaHealth !== null },
    })
  })
