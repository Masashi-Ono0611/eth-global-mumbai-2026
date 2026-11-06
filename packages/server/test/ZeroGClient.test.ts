import { Effect, Layer, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { describe, expect, test } from 'vitest'
import { APPROVAL_RULE, decide, decideRequestBody } from '../src/robot/ZeroGClient.ts'
import { chaiDecideInput } from './DecideSamples.ts'

const input = chaiDecideInput
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
  test('the prompt sends an approval-required item the owner asked for to the owner, at temperature 0', () => {
    const body = decideRequestBody('m', input)
    expect(body.messages[0]?.content).toContain(
      'When approvalRequired is true and the owner asked for this item, answer ask_human so the owner can approve it in World App; answer walk_away only when the item is not what the owner asked for, the price is wrong, or the merchant is unknown.',
    )
    expect(body.messages[0]?.content).toContain(APPROVAL_RULE)
    expect(body).toMatchObject({ temperature: 0, tool_choice: { type: 'function', function: { name: 'decide' } } })
  })

  test('a router reply keeps its x_0g_trace request id beside the chat id', async () => {
    const stub = answering(
      { id: 'body-id', choices: [{ message: toolCall }], x_0g_trace: { request_id: 'trace-1', provider: '0xabc' } },
      { 'zg-res-key': 'chat-1' },
    )
    const outcome = await run(stub)
    expect(outcome).toMatchObject({
      ok: true,
      result: { action: 'pay' },
      call: { requestId: 'trace-1', chatId: 'chat-1', provider: 'brain.example/m@0xabc' },
    })
    expect(stub.sent[0]?.url).toBe('https://brain.example/v1/chat/completions')
  })

  test('a direct provider reply (no trace) uses its chat id as the request id', async () => {
    const outcome = await run(
      answering({ id: 'body-id', choices: [{ message: toolCall }] }, { 'zg-res-key': 'chat-2' }),
    )
    expect(outcome.call).toMatchObject({ requestId: 'chat-2', chatId: 'chat-2', provider: 'brain.example/m' })
  })

  test('without the ZG-Res-Key header the body id is the chat id and the request id', async () => {
    const outcome = await run(answering({ id: 'body-id', choices: [{ message: toolCall }] }))
    expect(outcome.call).toMatchObject({ requestId: 'body-id', chatId: 'body-id' })
  })

  test('a reply without the decide tool call is a failure, never a decision', async () => {
    const outcome = await run(answering({ id: 'x', choices: [{ message: { content: 'buy it' } }] }))
    expect(outcome).toMatchObject({
      ok: false,
      error: 'no decide tool call in the reply (0 tool call(s), no function_call, text 6 chars)',
      call: { httpStatus: 200 },
    })
  })
})

const decision = (message: unknown) =>
  run(answering({ id: 'x', choices: [{ message }] })).then((outcome) =>
    outcome.ok ? { ok: true, ...outcome.result } : { ok: false, error: outcome.error },
  )
const call = (args: unknown, name = 'decide') => ({
  tool_calls: [{ id: 't1', type: 'function', function: { name, arguments: args } }],
})

describe('reading the decide call tolerantly, never inventing one', () => {
  test('arguments as an object, extra fields, an upper-case action and a missing reason', async () => {
    expect(await decision(call({ action: 'ASK_HUMAN', confidence: 0.9 }))).toEqual({
      ok: true,
      action: 'ask_human',
      reason: '',
    })
    expect(await decision(call('{"action":"Ask Human","reason":"owner decides","extra":1}'))).toEqual({
      ok: true,
      action: 'ask_human',
      reason: 'owner decides',
    })
    expect(await decision(call('{"action":"walk-away","reason":"' + 'x'.repeat(300) + '"}'))).toMatchObject({
      ok: true,
      action: 'walk_away',
    })
    expect(await decision({ function_call: { name: 'Decide', arguments: '{"action":"pay","reason":"ok"}' } })).toEqual({
      ok: true,
      action: 'pay',
      reason: 'ok',
    })
  })

  test('what is still refused, with the reply shape in the reason', async () => {
    expect(await decision(call('{"action":"buy"}'))).toEqual({
      ok: false,
      error: 'decide action "buy" is not pay, ask_human or walk_away',
    })
    expect(await decision(call('not json'))).toEqual({
      ok: false,
      error: 'decide arguments are not a JSON object (string 8 chars)',
    })
    expect(await decision(call({ verdict: 'pay' }))).toEqual({
      ok: false,
      error: 'decide arguments have no action (keys: verdict)',
    })
    expect(await decision(call('{"action":"pay"}', 'purchase'))).toEqual({
      ok: false,
      error: 'no decide tool call in the reply (1 tool call(s) [purchase], no function_call, no text)',
    })
  })

  test('per-model extra fields are merged in, never over the spec fields', () => {
    const body = decideRequestBody('m', input, {
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0.7,
      model: 'other',
      tool_choice: 'auto',
    })
    expect(body).toMatchObject({
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0,
      model: 'm',
      tool_choice: { type: 'function', function: { name: 'decide' } },
    })
  })

  test('an approval-required input carries the approval as structure', () => {
    const restricted = { ...input, policy: { payeeAllowlisted: false, restricted: true, approvalRequired: true } }
    expect(JSON.parse(decideRequestBody('m', restricted).messages[1]?.content ?? '{}')).toMatchObject({
      approval: { required: true, canBeGrantedBy: 'the owner in World App', capsDoNotBlock: true },
    })
    expect(JSON.parse(decideRequestBody('m', input).messages[1]?.content ?? '{}')).not.toHaveProperty('approval')
    expect(decideRequestBody('m', input).messages[0]?.content).toContain(
      'Decision table, apply the first row that matches:',
    )
  })
})
