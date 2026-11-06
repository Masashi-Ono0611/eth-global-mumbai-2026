import * as Cloudflare from '@alchemy.run/cloudflare'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { Effect, Layer } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'

// Module memory is deliberately observed to prove the test actually restarts workerd.
let reads = 0
const key = 'acceptance/recovery.txt'

export const recoveryRoutes = (media: ReadWriteBucketClient) =>
  Effect.sync(() => {
    const seed = Effect.gen(function* () {
      yield* media.put(key, 'survives-native-restart')
      return HttpServerResponse.empty({ status: 204 })
    })
    const read = Effect.gen(function* () {
      const objects = yield* media.get(key)
      const env = yield* Cloudflare.Workers.WorkerEnvironment
      const generation: unknown = env.TEST_GENERATION
      if (typeof generation !== 'string') return yield* Effect.die(new Error('Test generation binding missing'))
      reads += 1
      return yield* HttpServerResponse.json({
        generation,
        reads,
        media: objects === null ? null : yield* objects.text(),
      })
    })
    return Layer.mergeAll(
      HttpRouter.add('POST', '/test/recovery/seed', seed.pipe(Effect.orDie)),
      HttpRouter.add('GET', '/test/recovery/read', read.pipe(Effect.orDie)),
    )
  })
