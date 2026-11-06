import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { type ChipRefused, ChipResponse, type ChipSigned } from '@ethmumbai/protocol/Chip'
import { delegationHash } from '@ethmumbai/protocol/Delegation'
import { Effect, Option } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import type { ChipHooks, PaymentReport } from './Hooks.ts'
import { authenticateChip } from './Pairing.ts'
import { type ChipRequestRow, decodePayload, markResponded, readRequest } from './Requests.ts'
import { json, jsonError, nowSeconds } from '../Respond.ts'

const ack = (payment: PaymentReport) => json({ accepted: true, payment })
const notDelivered = () => jsonError(409, 'request is not delivered')

const acceptRefusal = Effect.fnUntraced(function* (
  database: QueryDatabaseClient,
  hooks: ChipHooks,
  request: ChipRequestRow,
  response: typeof ChipRefused.Type,
) {
  const now = yield* nowSeconds
  if (!(yield* markResponded(database, request.id, now, { refusalCode: response.refused.code })))
    return yield* notDelivered()
  yield* hooks.refused(request, response.refused.code, response.refused.detail)
  return yield* ack({ status: 'failed', reason: response.refused.code })
})

/** The signature must be over the leaf we queued; settlement then runs inside this request (spec §6 `settling`). */
const acceptSignature = Effect.fnUntraced(function* (
  database: QueryDatabaseClient,
  hooks: ChipHooks,
  request: ChipRequestRow,
  response: typeof ChipSigned.Type,
) {
  const payload = yield* decodePayload(request)
  if (response.leafHash.toLowerCase() !== delegationHash(payload.leaf).toLowerCase())
    return yield* jsonError(400, 'leafHash is not the hash of the requested leaf')
  const now = yield* nowSeconds
  const marked = yield* markResponded(database, request.id, now, {
    signature: response.signature,
    leafHash: response.leafHash,
  })
  if (!marked) return yield* notDelivered()
  return yield* ack(yield* hooks.signed(request, response.signature))
})

/**
 * `POST /api/chips/:robotId/responses`: a signature runs the facilitator's settle inline and answers with the payment
 * result; a refusal ends the errand. 409 unless the request is `delivered` (each request is answered once).
 */
export const responsesRoute = (database: QueryDatabaseClient, hooks: ChipHooks) =>
  HttpRouter.route(
    'POST',
    '/api/chips/:robotId/responses',
    Effect.gen(function* () {
      const { robotId } = yield* HttpRouter.params
      const robot = yield* authenticateChip(database, robotId ?? '')
      if (Option.isNone(robot)) return yield* jsonError(401, 'bad chip token')
      const body = yield* HttpServerRequest.schemaBodyJson(ChipResponse).pipe(Effect.option)
      if (Option.isNone(body)) return yield* jsonError(400, 'expected a chip response')
      const response = body.value
      const found = yield* readRequest(database, robot.value.id, response.requestId)
      if (Option.isNone(found) || found.value.status !== 'delivered') return yield* notDelivered()
      const request = found.value
      return yield* response.ok
        ? acceptSignature(database, hooks, request, response)
        : acceptRefusal(database, hooks, request, response)
    }),
  )
