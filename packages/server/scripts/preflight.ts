import { makeArcClient } from '@ethmumbai/chain/Arc'
import { Address } from '@ethmumbai/protocol/Hex'
import { Console, Effect, Option, Ref, Schema } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import { formatEther, keccak256 } from 'viem'

// Booth preflight (read-only): what the deployed release has bound, the relayer's gas money and nonce, the enforcer's
// on-chain code against the build, and whether 0G, World and the gate answer. Needs no secret and prints none.
// Usage: bun packages/server/scripts/preflight.ts [--base-url URL] [--relayer 0x…] [--enforcer 0x…]
//        (APP_ZG_BASE_URL / APP_WORLD_ISSUER / APP_ARC_RPC_URL are read from the environment when present, e.g. with
//        `bun --env-file=.env.main.local …`; only their reachability is printed, never their value.)
// Exit 0 when everything a demo run needs is there; 1 otherwise (each FAIL line says what).
const DEPLOYED = 'https://vitaquack.com'
const RELAYER = '0x404b09F43db64fB08f70b0b3e2b785bC312D6fDb'
const ENFORCER = '0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3'
/**
 * keccak256 of the live enforcer's runtime code (docs/evidence/contracts.md). Compared to the recorded value, not to a
 * fresh build: builds from the Studio pull differ from the live code by the metadata hash only, and the app's approvals
 * are bound to the live address, so it is not redeployed.
 */
const ENFORCER_CODE_HASH = '0x8ae1c544a79174dbaae0c617c21fa0a3b4e795fc06a6273b917018271081b653'
const flag = (name: string) => {
  const index = Bun.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : Bun.argv[index + 1]
}
const base = new URL(flag('base-url') ?? DEPLOYED).origin
const relayer = Schema.decodeUnknownSync(Address)(flag('relayer') ?? RELAYER)
const enforcer = Schema.decodeUnknownSync(Address)(flag('enforcer') ?? process.env.APP_ENFORCER_ADDRESS ?? ENFORCER)
const rpcSetting = process.env.APP_ARC_RPC_URL ?? ''
const arc = makeArcClient(rpcSetting.startsWith('https://') ? rpcSetting : 'https://arc-rpc.publicnode.com')
const zgBase = (process.env.APP_ZG_BASE_URL ?? '').startsWith('http') ? process.env.APP_ZG_BASE_URL : undefined
const worldIssuer = (process.env.APP_WORLD_ISSUER ?? '').startsWith('https://')
  ? process.env.APP_WORLD_ISSUER
  : 'https://auth.world.org'
const buildCodeHash = ENFORCER_CODE_HASH

const Health = Schema.Struct({
  release: Schema.String,
  features: Schema.optionalKey(Schema.Record(Schema.String, Schema.Boolean)),
})
const GateKey = Schema.Struct({ alg: Schema.Literal('ed25519'), publicKey: Schema.String })
const Discovery = Schema.Struct({ issuer: Schema.String })
const DEMO_FEATURES = ['relayer', 'approver', 'enforcer', 'merchant', 'gate', 'zg', 'world', 'evidence']

type Report = (ok: boolean, line: string) => Effect.Effect<void>
const warn = (line: string) => Console.log(`warn  ${line}`)
const getJson = <A>(url: string, schema: Schema.ConstraintDecoder<A>) =>
  HttpClient.get(url).pipe(
    Effect.flatMap((response) =>
      Effect.map(Effect.flatMap(response.json, Schema.decodeUnknownEffect(schema)), (body) => ({
        status: response.status,
        body,
      })),
    ),
    Effect.option,
  )

const checkHealth = Effect.fn('preflight.health')(function* (report: Report) {
  const health = yield* getJson(`${base}/api/health`, Health)
  if (Option.isNone(health)) return yield* report(false, `${base}/api/health did not answer with a release`)
  const { release, features } = health.value.body
  yield* report(true, `release ${release} at ${base}`)
  if (features === undefined) return yield* report(false, `release ${release} does not report its features yet`)
  for (const name of DEMO_FEATURES) yield* report(features[name] === true, `feature ${name}`)
  if (features.arc !== true) yield* warn('ARC_RPC_URL not bound: the Worker uses the public Arc RPC')
})

const checkChain = Effect.fn('preflight.chain')(function* (report: Report) {
  const balance = yield* Effect.promise(() => arc.getBalance({ address: relayer }))
  const nonce = yield* Effect.promise(() => arc.getTransactionCount({ address: relayer, blockTag: 'pending' }))
  yield* report(balance >= 100_000_000_000_000_000n, `relayer ${relayer}: ${formatEther(balance)} USDC, nonce ${nonce}`)
  if (balance < 2_000_000_000_000_000_000n) yield* warn('relayer holds under 2 USDC: top it up before the demo')
  const code = yield* Effect.promise(() => arc.getCode({ address: enforcer }))
  const codeHash = code === undefined || code === '0x' ? 'no code' : keccak256(code)
  const same = codeHash === buildCodeHash
  yield* report(
    same,
    `enforcer ${enforcer}: on-chain code ${same ? '= the deployed release' : `${codeHash} differs from the recorded deploy`}`,
  )
})

const checkProviders = Effect.fn('preflight.providers')(function* (report: Report) {
  const gate = yield* getJson(`${base}/api/merchants/duck-cafe/gate-key`, GateKey)
  yield* report(Option.isSome(gate), `gate key ${Option.isSome(gate) ? gate.value.body.publicKey : 'missing'}`)
  const world = yield* getJson(`${worldIssuer}/.well-known/openid-configuration`, Discovery)
  const issuerOk = Option.isSome(world) && world.value.body.issuer === worldIssuer
  yield* report(issuerOk, 'World IdP discovery answers for its issuer')
  if (zgBase === undefined)
    return yield* report(false, '0G base URL unknown here (APP_ZG_BASE_URL not in the environment)')
  const reached = yield* HttpClient.get(`${zgBase.replace(/\/+$/, '')}/models`).pipe(Effect.option)
  yield* report(
    Option.isSome(reached),
    `0G router reachable${Option.isSome(reached) ? ` (HTTP ${reached.value.status})` : ''}`,
  )
})

const program = Effect.gen(function* () {
  const failures = yield* Ref.make<ReadonlyArray<string>>([])
  const report: Report = (ok, line) =>
    Effect.andThen(
      Console.log(`${ok ? 'ok  ' : 'FAIL'}  ${line}`),
      ok ? Effect.void : Ref.update(failures, (list) => [...list, line]),
    )
  yield* checkHealth(report)
  yield* checkChain(report)
  yield* checkProviders(report)
  const failed = yield* Ref.get(failures)
  yield* Console.log(failed.length === 0 ? '\npreflight: ready' : `\npreflight: ${failed.length} problem(s)`)
  return failed.length === 0
})

const ready = await Effect.runPromise(program.pipe(Effect.provide(FetchHttpClient.layer)))
process.exit(ready ? 0 : 1)
