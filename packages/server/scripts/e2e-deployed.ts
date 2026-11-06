import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeArcClient } from '@ethmumbai/chain/Arc'
import { sendUsdc } from '@ethmumbai/chain/Fund'
import { Address } from '@ethmumbai/protocol/Hex'
import { usdcToUnits } from '@ethmumbai/protocol/Invoice'
import { Clock, Console, Effect, Schedule, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import type * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { makeSoftwareAuthenticator, passkeyCall, registerPasskey, sessionCookie } from '../test/PasskeyFixture.ts'

// Owner-side end-to-end run against a deployed app (spec §11 steps 5–7), reusable for checkpoints and rehearsals:
// passkey signup (Wallet's software authenticator, the same ceremony the native tests use), the relayer funds the
// new smart account, "Add robot", the mock chip pairs, the passkey signs a grant (with the enforcer), one errand,
// polled to its end. Prints addresses, ids and explorer links only; never a key, a token, a cookie or a signature.
// Usage: bun --env-file=.env.main.local packages/server/scripts/e2e-deployed.ts [--base-url URL] [--fund 0.15]
//        [--item chai] [--no-chip]   (by default the mock chip runs as a child process with a fresh key)
// Exit 0: paid, or the expected end while 0G is not configured (503 / safe_stop "not configured"). Otherwise 1.
const DEPLOYED = 'https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev'
const flag = (name: string) => {
  const index = Bun.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : Bun.argv[index + 1]
}
const base = new URL(flag('base-url') ?? DEPLOYED).origin
const fundUnits = usdcToUnits(flag('fund') ?? '0.15')
const item = flag('item') ?? 'chai'
const spawnChip = !Bun.argv.includes('--no-chip')
const relayerKey = process.env.APP_RELAYER_PRIVATE_KEY ?? ''
if (!/^0x[0-9a-f]{64}$/.test(relayerKey)) throw new Error('APP_RELAYER_PRIVATE_KEY missing: run with --env-file')
if (fundUnits > 500_000n) throw new Error('--fund is capped at 0.50 USDC')
const rpcSetting = process.env.APP_ARC_RPC_URL ?? ''
const arc = makeArcClient(rpcSetting.startsWith('https://') ? rpcSetting : 'https://rpc.mainnet.arc.io')
const explorer = (hash: string) => `https://explorer.arc.io/tx/${hash}`
const say = (line: string) => Console.log(`e2e  ${line}`)

class E2EFailure extends Schema.TaggedError<E2EFailure>()('E2EFailure', { message: Schema.String }) {}
const fail = (message: string) => Effect.fail(new E2EFailure({ message }))

const jsonOf = <A>(
  response: HttpClientResponse.HttpClientResponse,
  schema: Schema.ConstraintDecoder<A>,
  what: string,
) =>
  response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(() => new E2EFailure({ message: `${what}: unexpected body (status ${response.status})` })),
  )
const expectStatus = (response: HttpClientResponse.HttpClientResponse, status: number, what: string) =>
  response.status === status
    ? Effect.void
    : response.text.pipe(
        Effect.orElseSucceed(() => ''),
        Effect.flatMap((body) => fail(`${what}: ${response.status} ${body.slice(0, 200)}`)),
      )

const Signup = Schema.Struct({ accountId: Schema.String, smartAccount: Address })
const Catalogue = Schema.Struct({ payTo: Schema.String })
const AddedRobot = Schema.Struct({ robotId: Schema.String, pairingCode: Schema.String })
const Robots = Schema.Struct({ robots: Schema.Array(Schema.Struct({ id: Schema.String, status: Schema.String })) })
const GrantOptions = Schema.Struct({ grantId: Schema.String, challenge: Schema.String, rpId: Schema.String })
const GrantSigned = Schema.Struct({ status: Schema.String, deployTx: Schema.NullOr(Schema.String) })
const ErrorBody = Schema.Struct({ error: Schema.String })
const Errand = Schema.Struct({ episodeId: Schema.String, state: Schema.String })
const ErrandView = Schema.Struct({
  episode: Schema.Struct({ state: Schema.String, result: Schema.NullOr(Schema.String) }),
  decisions: Schema.Array(
    Schema.Struct({
      action: Schema.String,
      request_id: Schema.NullOr(Schema.String),
      error: Schema.NullOr(Schema.String),
    }),
  ),
  payment: Schema.NullOr(Schema.Struct({ txHash: Schema.NullOr(Schema.String) })),
})
const TERMINAL = ['paid', 'walked_away', 'safe_stop', 'denied', 'refused', 'failed', 'expired']

const get = (path: string, cookie: string) => HttpClient.get(`${base}${path}`, { headers: { cookie } })

const signup = Effect.gen(function* () {
  const authenticator = yield* Effect.promise(() => makeSoftwareAuthenticator({ countSignatures: true }))
  const { response } = yield* registerPasskey(base, authenticator, 'E2E Owner')
  yield* expectStatus(response, 200, 'passkey signup')
  const account = yield* jsonOf(response, Signup, 'passkey signup')
  return { authenticator, account, cookie: sessionCookie(response) }
})

const waitForPairing = Effect.fn('e2e.waitForPairing')(function* (robotId: string, cookie: string) {
  const check = Effect.gen(function* () {
    const list = yield* jsonOf(yield* get('/api/robots', cookie), Robots, 'list robots')
    const robot = list.robots.find((row) => row.id === robotId)
    return robot?.status === 'paired' ? yield* Effect.succeed(true) : yield* fail('not paired yet')
  })
  yield* check.pipe(
    Effect.retry({ schedule: Schedule.spaced('2 seconds'), times: 300 }),
    Effect.mapError(() => new E2EFailure({ message: 'the chip did not pair within 10 minutes' })),
  )
})

const prefixLines = async (stream: ReadableStream<Uint8Array>) => {
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of stream) {
    const lines = (pending + decoder.decode(chunk, { stream: true })).split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) process.stdout.write(`chip ${line}\n`)
  }
}

/** M+R's mock chip (apps/chip) as a child process with a fresh key and state dir; its log lines are prefixed `chip`. */
const startChip = (pairingCode: string) =>
  Effect.gen(function* () {
    const state = mkdtempSync(join(tmpdir(), 'vq-e2e-chip-'))
    const child = Bun.spawn(
      ['bun', 'apps/chip/src/main.ts', '--server', base, '--pair', pairingCode, '--state', state],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    yield* Effect.addFinalizer(() => Effect.sync(() => child.kill()))
    yield* Effect.forkScoped(Effect.promise(() => Promise.all([prefixLines(child.stdout), prefixLines(child.stderr)])))
  })

const signGrant = Effect.fn('e2e.signGrant')(function* (
  session: Effect.Success<typeof signup>,
  robotId: string,
  merchantPayTo: string,
) {
  const call = passkeyCall(base)
  const expiresAt = Math.floor((yield* Clock.currentTimeMillis) / 1000) + 86_400
  const options = yield* call(
    '/api/wallet/grants/options',
    { robotId, dailyCap: '0.50', perPaymentCap: '0.25', allowlist: [merchantPayTo], expiresAt },
    session.cookie,
  )
  yield* expectStatus(options, 201, 'grant options')
  const prompt = yield* jsonOf(options, GrantOptions, 'grant options')
  const assertion = yield* Effect.promise(() =>
    session.authenticator.assert(prompt.challenge, { origin: base, rpId: prompt.rpId }),
  )
  const signed = yield* call(`/api/wallet/grants/${prompt.grantId}/sign`, assertion, session.cookie)
  yield* expectStatus(signed, 200, 'grant sign')
  const grant = yield* jsonOf(signed, GrantSigned, 'grant sign')
  yield* say(
    `grant ${prompt.grantId} ${grant.status}${grant.deployTx === null ? '' : `; account deploy ${explorer(grant.deployTx)}`}`,
  )
})

/** `true` when the run ended as expected (paid, or 0G not configured yet). */
const errand = Effect.fn('e2e.errand')(function* (robotId: string, cookie: string) {
  const started = yield* passkeyCall(base)(`/api/robots/${robotId}/errands`, { item }, cookie)
  if (started.status === 503) {
    const { error } = yield* jsonOf(started, ErrorBody, 'errand')
    yield* say(`errand refused 503 "${error}"`)
    return error.startsWith('not configured: ZG')
  }
  yield* expectStatus(started, 201, 'errand')
  const { episodeId, state } = yield* jsonOf(started, Errand, 'errand')
  yield* say(`errand ${episodeId} started in ${state}`)
  const view = yield* jsonOf(
    yield* get(`/api/robots/${robotId}/errands/${episodeId}`, cookie),
    ErrandView,
    'errand',
  ).pipe(
    Effect.flatMap((current) => (TERMINAL.includes(current.episode.state) ? Effect.succeed(current) : fail('live'))),
    Effect.retry({ schedule: Schedule.spaced('2 seconds'), times: 90 }),
    Effect.mapError(() => new E2EFailure({ message: `errand ${episodeId} did not end within 3 minutes` })),
  )
  const decision = view.decisions[0]
  yield* say(
    `errand ended ${view.episode.state}; decision ${decision?.action ?? 'none'} request_id ${decision?.request_id ?? '-'}`,
  )
  const txHash = view.payment?.txHash ?? null
  if (view.episode.state === 'paid' && txHash !== null)
    return yield* say(`paid ${explorer(txHash)}`).pipe(Effect.as(true))
  const pending = view.episode.state === 'safe_stop' && (decision?.error ?? '').includes('not configured')
  yield* say(
    pending ? 'safe_stop because 0G is not configured yet (expected)' : `unexpected end: ${view.episode.result ?? ''}`,
  )
  return pending
})

const program = Effect.gen(function* () {
  yield* say(`base ${base}`)
  const health = yield* get('/api/health', '')
  yield* expectStatus(health, 200, 'health')
  const session = yield* signup
  yield* say(`owner ${session.account.smartAccount} (account ${session.account.accountId})`)
  const { payTo } = yield* jsonOf(yield* get('/api/merchants/duck-cafe/items', ''), Catalogue, 'catalogue')
  const funded = yield* sendUsdc({
    client: arc,
    privateKey: `0x${relayerKey.slice(2)}`,
    to: session.account.smartAccount,
    units: fundUnits,
  })
  if (!funded.success) return yield* fail(`funding reverted ${explorer(funded.hash)}`)
  yield* say(`funded ${explorer(funded.hash)}`)
  const added = yield* passkeyCall(base)('/api/robots', { name: 'E2E duck' }, session.cookie)
  yield* expectStatus(added, 201, 'add robot')
  const robot = yield* jsonOf(added, AddedRobot, 'add robot')
  yield* say(`robot ${robot.robotId} pairing code ${robot.pairingCode}`)
  if (spawnChip) yield* startChip(robot.pairingCode)
  else yield* say(`pair the mock chip: bun apps/chip/src/main.ts --server ${base} --pair ${robot.pairingCode}`)
  yield* waitForPairing(robot.robotId, session.cookie)
  yield* say('chip paired')
  yield* signGrant(session, robot.robotId, payTo)
  return yield* errand(robot.robotId, session.cookie)
})

const passed = await Effect.runPromise(
  program.pipe(
    Effect.scoped,
    Effect.provide(FetchHttpClient.layer),
    Effect.catch((error) =>
      Console.error(`e2e FAILED: ${'message' in error ? error.message : String(error)}`).pipe(Effect.as(false)),
    ),
  ),
)
process.exit(passed ? 0 : 1)
