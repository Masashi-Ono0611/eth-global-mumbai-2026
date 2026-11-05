import * as Domain from '@alchemy.run/domain'
import { Effect, Schema } from 'effect'
import { UserId } from './Identity.ts'

// Only verified host middleware and durable handlers construct this context.
export const Actor = Schema.Struct({ userId: UserId, service: Schema.Boolean })
export class CurrentActor extends Domain.RequestContext<CurrentActor>()('EthMumbai/CurrentActor', Actor) {}
export class NotAuthorized extends Domain.Rejection('NotAuthorized') {}
export const requireOwner = Effect.fn('EthMumbai.requireOwner')(function* (userId: UserId) {
  if ((yield* CurrentActor).userId !== userId) return yield* new NotAuthorized()
})
export const requireService = Effect.fn('EthMumbai.requireService')(function* (userId: UserId) {
  const actor = yield* CurrentActor
  if (!actor.service || actor.userId !== userId) return yield* new NotAuthorized()
})
