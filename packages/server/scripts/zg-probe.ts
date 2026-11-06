import { readFileSync } from 'node:fs'
import type { DecideInput } from '@ethmumbai/protocol/Errand'
import { Console, Effect, Option, Redacted, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { decide, ZeroGBindings } from '../src/robot/ZeroGClient.ts'

// One real 0G `decide` call, exactly as an errand makes it (spec §6), for a sample invoice under a sample policy.
// Usage: bun packages/server/scripts/zg-probe.ts [--env-file .env.main.local] [--scenario chai|cigarettes]
// Prints the router host, model, HTTP status, latency, request id / chat id and the parsed decision, or the exact
// failure. Never the key, never the prompt. Exit 0 only on a parsed decision; 2 when APP_ZG_* are not configured.

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
const merchant = setting('APP_MERCHANT_PAY_TO') ?? '0x000000000000000000000000000000000000c0de'
const restricted = setting('APP_RESTRICTED_PAY_TO') ?? '0x000000000000000000000000000000000000dead'

/** chai: allowlisted, within budget (expect `pay`); cigarettes: restricted, unallowlisted payee (expect `ask_human`). */
const sampleInput = (kind: string): DecideInput => {
  const chai = kind !== 'cigarettes'
  const amount = chai ? '100000' : '500000'
  return {
    requested: chai ? 'chai' : 'cigarettes',
    catalogue: { itemId: chai ? 'chai' : 'cigarettes', name: chai ? 'Chai' : 'Cigarettes', amount, restricted: !chai },
    invoice: {
      id: 'probeprobeprobeprobeprobea',
      payTo: Schema.decodeUnknownSync(Schema.TemplateLiteral(['0x', Schema.String]))(chai ? merchant : restricted),
      amount,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    },
    budget: { dailyCap: '1000000', spentToday: '0', remainingToday: '1000000', perPaymentCap: '300000' },
    policy: { payeeAllowlisted: chai, restricted: !chai, approvalRequired: !chai },
    merchant: { id: 'duck-cafe', trust: 'known' },
  }
}

const probe = Effect.gen(function* () {
  if (baseUrl === undefined || apiKey === undefined || model === undefined) {
    const missing = [
      baseUrl === undefined ? 'APP_ZG_BASE_URL' : undefined,
      apiKey === undefined ? 'APP_ZG_API_KEY' : undefined,
      model === undefined ? 'APP_ZG_MODEL' : undefined,
    ].filter((name) => name !== undefined)
    yield* Console.error(`not configured: ${missing.join(', ')}`)
    return 2
  }
  yield* Console.log(`router  ${new URL(baseUrl).host}`)
  yield* Console.log(`model   ${model}`)
  yield* Console.log(`case    ${scenario} (expect ${scenario === 'cigarettes' ? 'ask_human' : 'pay'})`)
  const outcome = yield* decide({ baseUrl, apiKey: Redacted.make(apiKey), model }, sampleInput(scenario))
  const { call } = outcome
  yield* Console.log(`status  ${call.httpStatus ?? 'no answer'}`)
  yield* Console.log(`latency ${call.latencyMs} ms`)
  yield* Console.log(`request ${call.requestId ?? '-'}   chat ${call.chatId ?? '-'}   brain ${call.provider}`)
  if (outcome.ok) {
    yield* Console.log(`decision ${outcome.result.action}: ${outcome.result.reason}`)
    return 0
  }
  yield* Console.error(`failed  ${outcome.error}`)
  if (outcome.detail !== null) yield* Console.error(`reply   ${outcome.detail}`)
  return 1
})

const code = await Effect.runPromise(probe.pipe(Effect.provide(FetchHttpClient.layer)))
process.exit(code)
