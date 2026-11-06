import { Effect, Layer, Option, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { describe, expect, test } from 'vitest'
import { callBot, escapeHtml, messageBody } from '../src/telegram/Bot.ts'
import { makeTelegramConfig, type TelegramConfig } from '../src/telegram/Config.ts'

const token = `12345678:${'k'.repeat(35)}`
const config: TelegramConfig = {
  token: Redacted.make(token),
  webhookSecret: Redacted.make('webhook-secret-0123456789'),
  apiBase: 'https://bot.test',
}

/** A Bot API that answers every call with `status` and `body`, and records the URLs it was asked. */
const answering = (status: number, body: unknown) => {
  const urls: Array<string> = []
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      urls.push(request.url)
      return HttpClientResponse.fromWeb(request, Response.json(body, { status }))
    }),
  )
  return { urls, layer: Layer.succeed(HttpClient.HttpClient, client) }
}

const send = (status: number, body: unknown) => {
  const bot = answering(status, body)
  const outcome = Effect.runPromise(
    callBot(config, 'sendMessage', { chat_id: '1', text: 'hi' }).pipe(Effect.provide(bot.layer)),
  )
  return outcome.then((result) => ({ result, urls: bot.urls }))
}

const run = (env: Record<string, unknown>) => Effect.runPromise(makeTelegramConfig(env))

describe('telegram config', () => {
  test('both secrets well-formed turn it on; a `pending` or missing one keeps it off', async () => {
    const on = await run({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-0123456789' })
    expect(Option.map(on, (found) => found.apiBase)).toEqual(Option.some('https://api.telegram.org'))
    expect(
      Option.isNone(await run({ TELEGRAM_BOT_TOKEN: 'pending', TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-0123456789' })),
    ).toBe(true)
    expect(Option.isNone(await run({ TELEGRAM_BOT_TOKEN: token }))).toBe(true)
    const stubbed = await run({
      TELEGRAM_BOT_TOKEN: token,
      TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-0123456789',
      TELEGRAM_API_BASE_URL: 'http://127.0.0.1:9/',
    })
    expect(Option.map(stubbed, (found) => found.apiBase)).toEqual(Option.some('http://127.0.0.1:9'))
  })
})

describe('telegram bot calls', () => {
  test('2xx is sent; the token is only in the URL, never in a reason', async () => {
    const { result, urls } = await send(200, { ok: true })
    expect(result).toEqual({ kind: 'sent', reason: null })
    expect(urls).toEqual([`https://bot.test/bot${token}/sendMessage`])
  })

  test('a blocked bot or a gone chat is unreachable; rate limits and 5xx are retried', async () => {
    expect((await send(403, { ok: false, description: 'Forbidden: bot was blocked by the user' })).result).toEqual({
      kind: 'unreachable',
      reason: 'Forbidden: bot was blocked by the user',
    })
    expect((await send(400, { ok: false, description: 'Bad Request: chat not found' })).result.kind).toBe('unreachable')
    expect((await send(429, { ok: false, description: 'Too Many Requests: retry after 3' })).result.kind).toBe('retry')
    const down = await send(500, 'not json')
    expect(down.result).toEqual({ kind: 'retry', reason: 'HTTP 500' })
    expect(JSON.stringify(down.result)).not.toContain(token)
  })

  test('a transport failure is a retry, never an error', async () => {
    const failing = HttpClient.make((request) => Effect.die(new Error(`boom ${request.url}`)))
    const result = await Effect.runPromise(
      callBot(config, 'sendMessage', {}).pipe(
        Effect.catchDefect(() => Effect.succeed({ kind: 'retry' as const, reason: 'defect' })),
        Effect.provide(Layer.succeed(HttpClient.HttpClient, failing)),
      ),
    )
    expect(result.kind).toBe('retry')
  })
})

describe('telegram messages', () => {
  test('HTML is escaped and buttons become an inline keyboard', () => {
    expect(escapeHtml('<b>"Duck" & co</b>')).toBe('&lt;b&gt;&quot;Duck&quot; &amp; co&lt;/b&gt;')
    expect(messageBody('42', { text: 'hi', buttons: [[{ text: 'Open', url: 'https://x.test' }]] })).toEqual({
      chat_id: '42',
      text: 'hi',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: 'Open', url: 'https://x.test' }]] },
    })
    expect(messageBody('42', { text: 'hi', buttons: [] })).not.toHaveProperty('reply_markup')
  })
})
