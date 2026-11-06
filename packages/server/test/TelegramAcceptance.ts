import { expect } from 'bun:test'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { seedRobot } from './ConsoleBrowserAcceptance.ts'
import { makeSoftwareAuthenticator, registerPasskey, sessionCookie } from './PasskeyFixture.ts'
import type { ZeroGStub } from './RobotAcceptance.ts'

/** Test-only bot credentials: the stub accepts any token, the Worker only checks their shape. */
export const TEST_TELEGRAM_TOKEN = `12345678:${'n'.repeat(35)}`
export const TEST_TELEGRAM_SECRET = 'native-telegram-secret-0123456789'

/** The native stack's URLs: the edge (`appUrl`), the test Worker (`url`) and the API Worker itself (`apiUrl`). */
type Urls = { readonly appUrl: string; readonly url: string; readonly apiUrl: string }

type BotCall = { readonly method: string; readonly body: Readonly<Record<string, unknown>> }

/** A stand-in for api.telegram.org on 127.0.0.1: records every Bot API call; `down` answers 500 to all of them. */
export const startTelegramStub = () => {
  let down = false
  const calls: Array<BotCall> = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const method = /^\/bot[^/]+\/(\w+)$/.exec(new URL(request.url).pathname)?.[1] ?? 'unknown'
      const body: unknown = await request.json()
      calls.push({
        method,
        body: typeof body === 'object' && body !== null ? Object.fromEntries(Object.entries(body)) : {},
      })
      return down
        ? Response.json({ ok: false, description: 'Internal Server Error' }, { status: 500 })
        : Response.json({ ok: true, result: { message_id: calls.length } })
    },
  })
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    calls,
    setDown: (next: boolean) => {
      down = next
    },
  }
}
export type TelegramStub = ReturnType<typeof startTelegramStub>

const OWNER_CHAT = 4242
const STRANGER_CHAT = 9999
const Created = Schema.Struct({
  episodeId: Schema.String,
  state: Schema.String,
  approvalUrl: Schema.optionalKey(Schema.String),
})
const State = Schema.Struct({ episode: Schema.Struct({ state: Schema.String }) })
/** What the webhook answers Telegram: a Bot API method to execute (a chat reply or a callback answer). */
const Reply = Schema.Struct({
  method: Schema.String,
  chat_id: Schema.optionalKey(Schema.Finite),
  text: Schema.optionalKey(Schema.String),
})
const ApprovalStatus = Schema.Struct({ status: Schema.String })

/**
 * Local workerd opens the one SQLite file from two Workers without a busy timeout, so a test-Worker write that lands
 * while the API Worker's after-response flush reads fails with SQLITE_BUSY (a 500). Production D1 has no such race;
 * the test retries its own test-Worker calls a few times.
 */
const retryBusy = async <A>(attempt: () => Promise<A>): Promise<A> => {
  for (let round = 0; ; round++) {
    try {
      return await attempt()
    } catch (error) {
      if (round >= 4) throw error
      await Bun.sleep(200)
    }
  }
}

const textOf = (call: BotCall) => (typeof call.body.text === 'string' ? call.body.text : '')

/**
 * Wait for a sendMessage to the owner's chat matching `pattern`. Each round makes a request to the app, so the API
 * Worker flushes its outbox after it (the 5 s sweep picks up rows written by other isolates).
 */
const awaitMessage = async (
  urls: Urls,
  stub: TelegramStub,
  pattern: RegExp,
  also: (call: BotCall) => boolean = () => true,
) => {
  for (let round = 0; round < 40; round++) {
    const found = stub.calls.find(
      (call) =>
        call.method === 'sendMessage' &&
        call.body.chat_id === String(OWNER_CHAT) &&
        pattern.test(textOf(call)) &&
        also(call),
    )
    if (found !== undefined) return found
    await fetch(`${urls.apiUrl}/api/health`)
    await Bun.sleep(500)
  }
  throw new Error(`no Telegram message matching ${pattern}`)
}

const webhook = (urls: Urls, update: unknown, secret = TEST_TELEGRAM_SECRET) =>
  fetch(`${urls.appUrl}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify(update),
  })

const denyTap = (urls: Urls, chatId: number, approvalId: string) =>
  webhook(urls, {
    update_id: 1,
    callback_query: {
      id: `tap-${chatId}-${Date.now()}`,
      data: `deny:${approvalId}`,
      message: { chat: { id: chatId }, message_id: 7 },
    },
  }).then(async (response) => Schema.decodeUnknownSync(Reply)(await response.json()).text ?? '')

type Owner = { readonly accountId: string; readonly cookie: string }

/** The wallet's Connect Telegram, then the bot's `/start <code>`: linked once; the same code a second time is refused. */
const link = async (urls: Urls, owner: Owner) => {
  const origin = new URL(urls.appUrl).origin
  expect(
    (
      await webhook(
        urls,
        { update_id: 0, message: { chat: { id: OWNER_CHAT }, text: '/start x' } },
        'wrong-secret-0123456789',
      )
    ).status,
  ).toBe(403)
  const created = await fetch(`${urls.appUrl}/api/telegram/link`, {
    method: 'POST',
    headers: { origin, cookie: owner.cookie },
  })
  expect(created.status).toBe(200)
  const { url } = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }))(await created.json())
  expect(url).toMatch(/^https:\/\/t\.me\/vitaquack_bot\?start=[\w-]{32}$/)
  const code = new URL(url).searchParams.get('start') ?? ''
  const start = {
    update_id: 2,
    message: { chat: { id: OWNER_CHAT }, from: { username: 'owner_test' }, text: `/start ${code}` },
  }
  const linked = Schema.decodeUnknownSync(Reply)(await (await webhook(urls, start)).json())
  expect(linked).toMatchObject({ method: 'sendMessage', chat_id: OWNER_CHAT })
  expect(linked.text).toContain('Connected')
  const again = Schema.decodeUnknownSync(Reply)(await (await webhook(urls, start)).json())
  expect(again.text).toContain('expired or was already used')
  const status: unknown = await (
    await fetch(`${urls.appUrl}/api/telegram`, { headers: { cookie: owner.cookie } })
  ).json()
  expect(status).toEqual({ configured: true, linked: true, username: 'owner_test' })
}

const startErrand = async (urls: Urls, owner: Owner, robotId: string, item: string) => {
  const origin = new URL(urls.appUrl).origin
  await fetch(`${urls.appUrl}/api/merchants/duck-cafe/invoices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId: item }),
  })
  const started = await fetch(`${urls.apiUrl}/api/robots/${robotId}/errands`, {
    method: 'POST',
    headers: { origin, cookie: owner.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ item }),
  })
  expect(started.status).toBe(201)
  return Schema.decodeUnknownSync(Created)(await started.json())
}

const settle = async (urls: Urls, owner: Owner, robotId: string, episodeId: string, txHash: string) => {
  await retryBusy(async () => {
    const settled = await fetch(`${urls.url}/test/vq/episodes/${episodeId}/settled`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txHash }),
    })
    if (settled.status !== 204) throw new Error(`settled: HTTP ${settled.status}`)
  })
  const view = await fetch(`${urls.appUrl}/api/robots/${robotId}/errands/${episodeId}`, {
    headers: { cookie: owner.cookie },
  })
  return Schema.decodeUnknownSync(State)(await view.json()).episode.state
}

const scenario = async (urls: Urls, owner: Owner, stub: TelegramStub) => {
  await link(urls, owner)
  // Chai: paid → "Paid" with the Arc link and today's budget.
  const robotId = await retryBusy(() => seedRobot(urls.url, owner.accountId))
  const chai = await startErrand(urls, owner, robotId, 'chai')
  const chaiTx = `0x${'c1'.repeat(32)}`
  expect(await settle(urls, owner, robotId, chai.episodeId, chaiTx)).toBe('paid')
  const paid = await awaitMessage(urls, stub, /Paid .*Chai/)
  expect(textOf(paid)).toContain('Today:')
  expect(JSON.stringify(paid.body.reply_markup)).toContain(`https://explorer.arc.io/tx/${chaiTx}`)
  // Thali: over the per-payment cap → the approval message with Review and Deny.
  const thaliRobot = await retryBusy(() => seedRobot(urls.url, owner.accountId))
  const thali = await startErrand(urls, owner, thaliRobot, 'thali')
  expect(thali.state).toBe('awaiting_approval')
  const approvalId = thali.approvalUrl?.split('/').at(-1) ?? ''
  const asked = await awaitMessage(urls, stub, /Thali.*per-payment limit/s)
  const buttons = JSON.stringify(asked.body.reply_markup)
  expect(buttons).toContain(`/wallet/approvals/${approvalId}`)
  expect(buttons).toContain(`deny:${approvalId}`)
  // A chat that is not the owner's changes nothing; the owner's tap denies; a second tap is "already decided".
  expect(await denyTap(urls, STRANGER_CHAT, approvalId)).toBe('This approval is not yours.')
  const approval = async () =>
    Schema.decodeUnknownSync(ApprovalStatus)(
      await (await fetch(`${urls.appUrl}/api/approvals/${approvalId}`, { headers: { cookie: owner.cookie } })).json(),
    )
  expect((await approval()).status).toBe('requested')
  expect(await denyTap(urls, OWNER_CHAT, approvalId)).toBe('Denied. I will not buy it.')
  expect((await approval()).status).toBe('denied')
  expect(stub.calls.some((call) => call.method === 'editMessageReplyMarkup')).toBe(true)
  expect(await denyTap(urls, OWNER_CHAT, approvalId)).toContain('Already decided')
  await awaitMessage(urls, stub, /didn't buy the Thali/)
  // Telegram down: the payment still settles; the message is retried once Telegram answers again.
  stub.setDown(true)
  const sent = stub.calls.length
  const again = await startErrand(urls, owner, robotId, 'chai')
  expect(await settle(urls, owner, robotId, again.episodeId, `0x${'c2'.repeat(32)}`)).toBe('paid')
  for (let round = 0; round < 30 && stub.calls.length === sent; round++) {
    await fetch(`${urls.apiUrl}/api/health`)
    await Bun.sleep(500)
  }
  expect(stub.calls.length).toBeGreaterThan(sent)
  stub.setDown(false)
  const upAt = stub.calls.length
  // The row that failed while Telegram was down goes out at a later flush: retried, not lost.
  await awaitMessage(
    urls,
    stub,
    /Paid .*Chai/,
    (call) => stub.calls.indexOf(call) >= upAt && JSON.stringify(call.body.reply_markup).includes('c2c2'),
  )
}

/** Spec §14 acceptance against a stub Bot API: link, paid, approval with Deny, forged and repeated taps, Telegram down. */
export const registerTelegramAcceptance = (
  test: TestApi['test'],
  stack: Effect.Effect<Urls>,
  zeroG: ZeroGStub,
  stub: TelegramStub,
) =>
  test(
    'telegram: link by one-time code; paid and approval messages; Deny from the owner only, once; Telegram down never blocks a payment',
    Effect.gen(function* () {
      const urls = yield* stack
      zeroG.setMode('pay')
      const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator())
      const { response } = yield* registerPasskey(urls.appUrl, authenticator, 'Telegram Owner')
      const { accountId } = yield* Schema.decodeUnknownEffect(Schema.Struct({ accountId: Schema.String }))(
        yield* response.json,
      )
      yield* Effect.promise(() => scenario(urls, { accountId, cookie: sessionCookie(response) }, stub))
    }).pipe(Effect.provide(FetchHttpClient.layer)),
    { timeout: 120000 },
  )
