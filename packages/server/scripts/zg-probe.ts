import { readFileSync } from 'node:fs'
import type { DecideInput } from '@ethmumbai/protocol/Errand'
import { Console, Effect, Option, Redacted, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { decide, ZeroGBindings, ZeroGExtraBody } from '../src/robot/ZeroGClient.ts'

// One real 0G `decide` call, exactly as an errand makes it (spec §6), for a sample invoice under a sample policy.
// Usage: bun packages/server/scripts/zg-probe.ts [--env-file .env.main.local] [--scenario chai|thali|thali-over-today]
// Prints the router host, model, HTTP status, latency, request id / chat id and the parsed decision, or the exact
// failure. Never the key, never the prompt. Exit 0 only on the expected decision (chai → pay, thali over the per-payment
// cap → ask_human, thali over today's remaining allowance → walk_away), 3 on another decision, 1 on a failed call, 2
// when APP_ZG_* are not configured. The budget is the demo grant's: 3.00 a day, 1.00 per payment.

const argument = (name: string) => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const envFile = argument('env-file') ?? '.env.main.local'
const scenario = argument('scenario') ?? 'chai'
const fileEnv: Record<string, string> = Object.fromEntries(
  (() => {
    try {
      return readFileSync(envFile, 'utf8').split('\n')
    } catch {
      return []
    }
  })().flatMap((line): Array<[string, string]> => {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    return match?.[1] === undefined ? [] : [[match[1], (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2')]]
  }),
)
const setting = (...names: ReadonlyArray<string>) =>
  names
    .map((name) => process.env[name] ?? fileEnv[name])
    .find((value) => value !== undefined && value !== '' && value !== 'pending')

const decodeSetting = <A>(schema: Schema.ConstraintDecoder<A>, names: ReadonlyArray<string>) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(schema)(setting(...names)))

const baseUrl = decodeSetting(ZeroGBindings.baseUrl, ['APP_ZG_BASE_URL', 'ZG_BASE_URL'])
const apiKey = decodeSetting(ZeroGBindings.apiKey, ['APP_ZG_API_KEY', 'ZG_API_KEY'])
const model = decodeSetting(ZeroGBindings.model, ['APP_ZG_MODEL', 'ZG_MODEL'])
const extraBody = decodeSetting(ZeroGExtraBody, ['APP_ZG_EXTRA_JSON', 'ZG_EXTRA_JSON'])
const merchant = setting('APP_MERCHANT_PAY_TO') ?? '0x000000000000000000000000000000000000c0de'

/** Each case on the demo grant (3.00/day, 1.00/payment): spent so far today, and the decision it should get. */
const scenarios = {
  // Nothing spent yet: allowlisted, within both limits.
  chai: { item: 'chai', name: 'Chai', amount: '100000', spentToday: '0', expect: 'pay' },
  // After a chai: over the 1.00 per-payment limit, within today's 2.90 left → the owner approves it.
  thali: { item: 'thali', name: 'Thali', amount: '2000000', spentToday: '100000', expect: 'ask_human' },
  // After a chai and an approved thali: 0.90 left today, which no approval can lift.
  'thali-over-today': { item: 'thali', name: 'Thali', amount: '2000000', spentToday: '2100000', expect: 'walk_away' },
} as const
type Scenario = keyof typeof scenarios
const isScenario = (name: string): name is Scenario => name in scenarios
const chosen = scenarios[isScenario(scenario) ? scenario : 'chai']

const DAILY_CAP = 3_000_000n
const PER_PAYMENT_CAP = 1_000_000n

const sampleInput = (): DecideInput => ({
  requested: chosen.item,
  catalogue: { itemId: chosen.item, name: chosen.name, amount: chosen.amount, restricted: false },
  invoice: {
    id: 'probeprobeprobeprobeprobea',
    payTo: Schema.decodeUnknownSync(Schema.TemplateLiteral(['0x', Schema.String]))(merchant),
    amount: chosen.amount,
    expiresAt: Math.floor(Date.now() / 1000) + 600,
  },
  budget: {
    dailyCap: DAILY_CAP.toString(),
    spentToday: chosen.spentToday,
    remainingToday: (DAILY_CAP - BigInt(chosen.spentToday)).toString(),
    perPaymentCap: PER_PAYMENT_CAP.toString(),
  },
  policy: { payeeAllowlisted: true, restricted: false, approvalRequired: BigInt(chosen.amount) > PER_PAYMENT_CAP },
  merchant: { id: 'duck-cafe', trust: 'known' },
})

const missing = Object.entries({ APP_ZG_BASE_URL: baseUrl, APP_ZG_API_KEY: apiKey, APP_ZG_MODEL: model })
  .filter(([, value]) => value === undefined)
  .map(([name]) => name)
const expected = chosen.expect
const extraKeys = extraBody === undefined ? '' : `  extra ${Object.keys(extraBody).join(', ')}`

const report = (outcome: Effect.Success<ReturnType<typeof decide>>) =>
  Effect.gen(function* () {
    const { call } = outcome
    yield* Console.log(`status  ${call.httpStatus ?? 'no answer'}`)
    yield* Console.log(`latency ${call.latencyMs} ms`)
    yield* Console.log(`request ${call.requestId ?? '-'}   chat ${call.chatId ?? '-'}   brain ${call.provider}`)
    if (!outcome.ok) {
      yield* Console.error(`failed  ${outcome.error}`)
      if (outcome.detail !== null) yield* Console.error(`reply   ${outcome.detail}`)
      return 1
    }
    yield* Console.log(`decision ${outcome.result.action}: ${outcome.result.reason}`)
    if (outcome.result.action === expected) return 0
    yield* Console.error(`unexpected: the ${scenario} case should be ${expected}`)
    return 3
  })

const probe = Effect.gen(function* () {
  if (baseUrl === undefined || apiKey === undefined || model === undefined) {
    yield* Console.error(`not configured: ${missing.join(', ')}`)
    return 2
  }
  yield* Console.log(`router  ${new URL(baseUrl).host}`)
  yield* Console.log(`model   ${model}${extraKeys}`)
  yield* Console.log(`case    ${isScenario(scenario) ? scenario : 'chai'} (expect ${expected})`)
  const config = { baseUrl, apiKey: Redacted.make(apiKey), model, ...(extraBody === undefined ? {} : { extraBody }) }
  return yield* report(yield* decide(config, sampleInput()))
})

const code = await Effect.runPromise(probe.pipe(Effect.provide(FetchHttpClient.layer)))
process.exit(code)
