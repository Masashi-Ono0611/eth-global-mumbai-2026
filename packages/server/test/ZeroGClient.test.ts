import type { DecideInput } from '@ethmumbai/protocol/Errand'
import { Effect, Layer, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { describe, expect, test } from 'vitest'
import { decide } from '../src/robot/ZeroGClient.ts'

const input: DecideInput = {
  requested: 'chai',
  catalogue: { itemId: 'chai', name: 'Chai', amount: '100000', restricted: false },
  invoice: {
    id: 'abcdefghijklmnopqrstuvwxya',
    payTo: '0x000000000000000000000000000000000000c0de',
    amount: '100000',
    expiresAt: 4_000_000_000,
  },
  budget: { dailyCap: '1000000', spentToday: '0', remainingToday: '1000000', perPaymentCap: '300000' },
  policy: { payeeAllowlisted: true, restricted: false, approvalRequired: false },
  merchant: { id: 'duck-cafe', trust: 'known' },
}
const config = { baseUrl: 'https://brain.example/v1', apiKey: Redacted.make('test-only-key-0123'), model: 'm' }
const toolCall = { tool_calls: [{ function: { name: 'decide', arguments: '{"action":"pay","reason":"ok"}' } }] }

/** A router stand-in answering one fixed body (and headers); it records what it was sent. */
const answering = (body: unknown, headers: Record<string, string> = {}) => {
  const sent: Array<{ readonly url: string; readonly body: unknown }> = []
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      sent.push({ url: request.url, body: request.body.toJSON() })
      return HttpClientResponse.fromWeb(request, Response.json(body, { headers }))
    }),
  )
  return { sent, layer: Layer.succeed(HttpClient.HttpClient, client) }
}

const run = (stub: ReturnType<typeof answering>) =>
  Effect.runPromise(decide(config, input).pipe(Effect.provide(stub.layer)))

describe('0G decide call', () => {
  test('a router reply keeps its x_0g_trace request id beside the chat id', async () => {
    const stub = answering(
      { id: 'body-id', choices: [{ message: toolCall }], x_0g_trace: { request_id: 'trace-1', provider: '0xabc' } },
      { 'zg-res-key': 'chat-1' },
    )
    const outcome = await run(stub)
    expect(outcome).toMatchObject({
      ok: true,
      result: { action: 'pay' },
      call: { requestId: 'trace-1', chatId: 'chat-1' },
    })
    expect(stub.sent[0]?.url).toBe('https://brain.example/v1/chat/completions')
  })

  test('a direct provider reply (no trace) uses its chat id as the request id', async () => {
    const outcome = await run(
      answering({ id: 'body-id', choices: [{ message: toolCall }] }, { 'zg-res-key': 'chat-2' }),
    )
    expect(outcome.call).toMatchObject({ requestId: 'chat-2', chatId: 'chat-2' })
  })

  test('without the ZG-Res-Key header the body id is the chat id and the request id', async () => {
    const outcome = await run(answering({ id: 'body-id', choices: [{ message: toolCall }] }))
    expect(outcome.call).toMatchObject({ requestId: 'body-id', chatId: 'body-id' })
  })

  test('a reply without the decide tool call is a failure, never a decision', async () => {
    const outcome = await run(answering({ id: 'x', choices: [{ message: { content: 'buy it' } }] }))
    expect(outcome).toMatchObject({ ok: false, error: 'no decide tool call in the reply', call: { httpStatus: 200 } })
  })
})
