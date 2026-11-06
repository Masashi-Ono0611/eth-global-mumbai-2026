import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Layer } from 'effect'
import type { ChipHooks } from './Hooks.ts'
import { pairingRoutes } from './Pairing.ts'
import { pollRoute } from './Poll.ts'
import { responsesRoute } from './Responses.ts'
import * as HttpRouter from 'effect/http/HttpRouter'

/** The chip protocol (spec §8): pair, long-poll with a lease, respond. */
export const chipRoutes = (database: QueryDatabaseClient, hooks: ChipHooks) =>
  Layer.mergeAll(
    pairingRoutes(database),
    HttpRouter.addAll([pollRoute(database, hooks), responsesRoute(database, hooks)]),
  )
