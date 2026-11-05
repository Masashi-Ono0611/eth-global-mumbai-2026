import { Context, Deferred, Effect, Fiber, Option, Ref } from 'effect'
import { expect, test } from 'vitest'
import { onFirstUse } from '../src/IsolateCache.ts'

class RequestOnly extends Context.Service<RequestOnly, { readonly id: string }>()('test/RequestOnly') {}

test('builds on the first request and reuses the value afterwards', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const builds = yield* Ref.make(0)
      const finalized = yield* Ref.make(false)
      const application = yield* onFirstUse((value: string) =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() => Ref.set(finalized, true))
          return `${value}:${yield* Ref.updateAndGet(builds, (count) => count + 1)}`
        }),
      )
      // Each request runs in its own scope, as the Alchemy Worker bridge does.
      const first = yield* Effect.scoped(application('first'))
      const later = yield* Effect.all([Effect.scoped(application('second')), Effect.scoped(application('third'))], {
        concurrency: 'unbounded',
      })
      return { first, later, builds: yield* Ref.get(builds), finalized: yield* Ref.get(finalized) }
    }),
  )
  expect(result).toEqual({ first: 'first:1', later: ['first:1', 'first:1'], builds: 1, finalized: false })
})

test('a concurrent first request builds its own value instead of waiting on another request', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const firstStarted = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()
      const application = yield* onFirstUse((value: string) =>
        Effect.gen(function* () {
          if (value === 'slow') {
            yield* Deferred.succeed(firstStarted, undefined)
            yield* Deferred.await(releaseFirst)
          }
          return value
        }),
      )
      const slow = yield* Effect.forkChild(application('slow'))
      yield* Deferred.await(firstStarted)
      // Waiting on the slow build would deadlock: it is released only after this returns.
      const fast = yield* application('fast')
      yield* Deferred.succeed(releaseFirst, undefined)
      return { fast, slow: yield* Fiber.join(slow), later: yield* application('later') }
    }),
  )
  expect(result).toEqual({ fast: 'fast', slow: 'slow', later: 'fast' })
})

test('retries after a failed build instead of keeping the failure', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const application = yield* onFirstUse(() =>
        Effect.flatMap(
          Ref.updateAndGet(attempts, (count) => count + 1),
          (count) => (count === 1 ? Effect.fail('transient' as const) : Effect.succeed(count)),
        ),
      )
      const failed = yield* Effect.flip(application(undefined))
      return { failed, next: yield* application(undefined), again: yield* application(undefined) }
    }),
  )
  expect(result).toEqual({ failed: 'transient', next: 2, again: 2 })
})

test('builds without the first request’s own services', async () => {
  const seen = await Effect.runPromise(
    Effect.gen(function* () {
      const application = yield* onFirstUse(() =>
        Effect.map(
          Effect.serviceOption(RequestOnly),
          Option.map(({ id }) => id),
        ),
      )
      return yield* application(undefined).pipe(Effect.provideService(RequestOnly, { id: 'request-1' }))
    }),
  )
  expect(seen).toEqual(Option.none())
})
