import { Effect, Option, Scope } from 'effect'

/**
 * Builds a value on the first request and keeps it for the Worker isolate.
 *
 * Alchemy also evaluates a Worker constructor while planning a deploy, when
 * request-only bindings such as secrets do not exist yet, so the build waits
 * for a request and receives that request's `input` as a plain value. It runs
 * with the constructor's services, never the first request's: a cached
 * service that captured that request's execution context or tracer hangs
 * every later request in workerd.
 *
 * Concurrent first requests each build their own value rather than waiting
 * on another request's build: workerd cancels a request that awaits I/O
 * started by a different request. The first successful build is kept; a
 * failed or interrupted build is retried by the next request. The isolate
 * scope is never closed (workerd has no teardown hook), so the value must not
 * own anything that needs cleanup.
 */
export const onFirstUse = <I, A, E, R>(build: (input: I) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const constructor = yield* Effect.context<Exclude<R, Scope.Scope>>()
    const isolate = yield* Scope.make()
    let built: Option.Option<A> = Option.none()
    const keep = (value: A) =>
      Effect.sync(() => {
        if (Option.isNone(built)) built = Option.some(value)
      })
    return (input: I): Effect.Effect<A, E> =>
      Effect.suspend(() =>
        Option.isSome(built)
          ? Effect.succeed(built.value)
          : build(input).pipe(Scope.provide(isolate), Effect.tap(keep)),
      ).pipe(Effect.updateContext((): typeof constructor => constructor))
  })
