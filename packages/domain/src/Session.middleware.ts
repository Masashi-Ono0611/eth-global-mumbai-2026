import { Schema } from 'effect'
import * as RpcMiddleware from 'effect/rpc/RpcMiddleware'
import { CurrentActor } from './CurrentActor.context.ts'
export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}
export class Session extends RpcMiddleware.Service<Session, { provides: CurrentActor }>()('EthMumbai/Session', {
  error: Unauthorized,
}) {}
