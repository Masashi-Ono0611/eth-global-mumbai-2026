import * as Cloudflare from '@alchemy.run/cloudflare'
import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ReadWriteBucketClient } from '@alchemy.run/cloudflare/R2/ReadWriteBucket'
import { CurrentActor } from '@styld/domain/CurrentActor.context'
import { UserId, OperationId } from '@styld/domain/Identity'
import { GrantMonthlyCredits } from '@styld/domain/Wallet/GrantMonthlyCredits.command'
import { ReserveCredits } from '@styld/domain/Wallet/ReserveCredits.command'
import { SettleCredits } from '@styld/domain/Wallet/SettleCredits.command'
import { Wallet } from '@styld/domain/Wallet/Wallet.aggregate'
import { Effect, Layer } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { seedIdentity } from './IdentityFixture.ts'

// Module memory is deliberately observed to prove the test actually restarts workerd.
let reads = 0
const owner = UserId.make('native-recovery')
const operation = OperationId.make('recovery-operation')
const key = 'acceptance/recovery.txt'

const trusted = <A, E, R>(effect: Effect.Effect<A, E, R | CurrentActor>) =>
  effect.pipe(Effect.provideService(CurrentActor, { userId: owner, service: true }), Effect.orDie)

export const recoveryRoutes = (database: QueryDatabaseClient, media: ReadWriteBucketClient) =>
  Effect.gen(function* () {
    const wallets = yield* Wallet
    const reserve = Effect.gen(function* () {
      yield* wallets.send(owner, new GrantMonthlyCredits({ period: '2026-10', monthly: 10 }), {
        commandId: 'recovery-grant',
      })
      yield* wallets.send(
        owner,
        new ReserveCredits({ operationId: operation, fingerprint: 'b'.repeat(64), amount: 8 }),
        {
          commandId: 'recovery-reserve',
        },
      )
    })
    const seed = Effect.gen(function* () {
      yield* seedIdentity(database, owner)
      yield* media.put(key, 'survives-native-restart')
      yield* reserve
      return HttpServerResponse.empty({ status: 204 })
    })
    const read = Effect.gen(function* () {
      const wallet = yield* wallets.state(owner)
      const objects = yield* media.get(key)
      const env = yield* Cloudflare.Workers.WorkerEnvironment
      const generation: unknown = env.TEST_GENERATION
      if (typeof generation !== 'string') return yield* Effect.die(new Error('Test generation binding missing'))
      reads += 1
      return yield* HttpServerResponse.json({
        generation,
        reads,
        wallet,
        media: objects === null ? null : yield* objects.text(),
      })
    })
    const settle = Effect.gen(function* () {
      const command = new SettleCredits({ operationId: operation, outcome: 'refunded' })
      yield* wallets.send(owner, command, { commandId: 'recovery-settle' })
      yield* wallets.send(owner, command, { commandId: 'recovery-settle' })
      // This transport receipt must still reject a fresh reservation after settlement.
      yield* reserve
      return HttpServerResponse.empty({ status: 204 })
    })
    return Layer.mergeAll(
      HttpRouter.add('POST', '/test/recovery/seed', trusted(seed)),
      HttpRouter.add(
        'POST',
        '/test/recovery/replay',
        trusted(reserve).pipe(Effect.as(HttpServerResponse.empty({ status: 204 }))),
      ),
      HttpRouter.add('POST', '/test/recovery/settle', trusted(settle)),
      HttpRouter.add('GET', '/test/recovery/read', trusted(read)),
    )
  })
