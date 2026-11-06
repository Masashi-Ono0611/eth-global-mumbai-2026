import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { makeArcClient } from '@ethmumbai/chain/Arc'
import { sendUsdc } from '@ethmumbai/chain/Fund'
import { isHex } from '@ethmumbai/protocol/Hex'
import { IntentView, isOpenIntent, type NavCall, type NavTurnView } from '@ethmumbai/protocol/Intent'
import { usdcToUnits } from '@ethmumbai/protocol/Invoice'
import { Effect, Option, Schema } from 'effect'
import { type BrowserContext, chromium, type Page } from 'playwright'
import { addVirtualAuthenticator } from '../test/PasskeyBrowserAcceptance.ts'

// The simulator robot end to end on a deployed app (spec §15), through the real UI in headless Chromium with a CDP
// virtual authenticator: passkey signup → Add robot → Simulator → "Open simulator" in a second tab of the same context
// (same origin, so the session cookie is shared) → the sim's browser chip pairs from #pair → the allowance (3.00 a
// day, 1.00 per purchase) → "Get me a chai" in the conversation → glm-5.3 on 0G walks the duck, the scan claims the
// intent, decide pays, the browser chip signs, Arc settles, the stall gate opens. Then "Get me a thali" (2.00 over the
// 1.00 cap → ask_human: the run stops at the World approval link and says No), then a mismatch: "Get me a chai" while
// the chai stall's screen shows the samosa invoice (`?debug=1` → window.vqDebug), so decide must walk away.
// Rendering is SwiftShader on a GPU-less box: the duck walks about 0.11 m/s, so every wait is generous.
// Prints ids, timings and explorer links only, never keys, tokens or prompts. Screenshots: docs/evidence/screens/sim-*.
// Usage: bun --env-file=.env.main.local packages/server/scripts/sim-browser.ts [--base-url URL] [--fund 0.12]
//   [--only chai|thali|mismatch (repeatable, default all)]. --fund (at most 0.30; 0 skips funding) is sent from the
//   relayer to the throwaway owner right after signup, while its account is still counterfactual; a paid chai needs
//   0.10. Its passkey dies with the run, so whatever is left stays stranded in that account.
const { values: options } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    'base-url': {
      type: 'string',
      default: 'https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev',
    },
    fund: { type: 'string', default: '0.12' },
    only: { type: 'string', multiple: true, default: [] },
  },
})
const base = new URL(options['base-url']).origin
const fund = options.fund
const runs = (step: string) => options.only.length === 0 || options.only.includes(step)
const screens = join(import.meta.dir, '../../../docs/evidence/screens')
const started = Date.now()
const say = (line: string) =>
  process.stdout.write(`sim  +${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s  ${line}\n`)
const explorer = (hash: string) => `https://explorer.arc.io/tx/${hash}`
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: join(screens, `sim-${name}.png`) }).catch(() => undefined)
  say(`screenshot docs/evidence/screens/sim-${name}.png`)
}

// --- the owner's API, read with the context's cookie (same origin as the pages) -----------------------------------

const TeeVerified = Schema.Struct({ verified: Schema.Boolean })
/** `GET /api/robots/:id/errands/:episodeId`, only the fields printed; decisions are D1 rows (`input_json` unread). */
const ErrandView = Schema.Struct({
  episode: Schema.Struct({ state: Schema.String, result: Schema.NullOr(Schema.String), item: Schema.String }),
  decisions: Schema.Array(
    Schema.Struct({
      action: Schema.String,
      reason: Schema.NullOr(Schema.String),
      request_id: Schema.NullOr(Schema.String),
      chat_id: Schema.NullOr(Schema.String),
      latency_ms: Schema.NullOr(Schema.Finite),
      tee_json: Schema.NullOr(Schema.String),
    }),
  ),
  payment: Schema.NullOr(Schema.Struct({ status: Schema.String, txHash: Schema.NullOr(Schema.String) })),
  approval: Schema.NullOr(Schema.Struct({ id: Schema.String, status: Schema.String })),
})
type ErrandView = typeof ErrandView.Type
type Decision = ErrandView['decisions'][number]
const WalletView = Schema.Struct({ account: Schema.Struct({ smartAccount: Schema.String }) })
const CreatedIntent = Schema.Struct({ id: Schema.String })
const ErrorBody = Schema.Struct({ error: Schema.String })

const getJson = async <S extends Schema.Constraint & Schema.ConstraintDecoder<unknown>>(
  context: BrowserContext,
  path: string,
  schema: S,
): Promise<S['Type'] | null> => {
  const response = await context.request.get(`${base}${path}`).catch(() => null)
  if (response?.ok() !== true) return null
  return Option.getOrNull(Schema.decodeUnknownOption(schema)(await response.json().catch(() => null)))
}
const readIntent = (context: BrowserContext, robotId: string, intentId: string) =>
  getJson(context, `/api/robots/${robotId}/intents/${intentId}`, IntentView)
const readErrand = (context: BrowserContext, robotId: string, episodeId: string) =>
  getJson(context, `/api/robots/${robotId}/errands/${episodeId}`, ErrandView)

const teeText = (tee: { readonly verified: boolean } | null) =>
  tee === null ? 'no TEE proof' : tee.verified ? 'TEE verified' : 'TEE unverified'

const callText = (call: NavCall) => {
  if (call.name === 'go_to') return `go_to(${String(call.args.place)})`
  if (call.name === 'say') return `say(“${String(call.args.text).slice(0, 80)}”)`
  if (call.name === 'wait') return `wait(${String(call.args.seconds)})`
  if (call.name === 'finish') return `finish(bought=${String(call.args.bought)})`
  return `${call.name}()`
}

const turnLine = (turn: NavTurnView) => {
  const calls = turn.calls.map(callText).join(', ') || '(none)'
  const error = turn.error === null ? '' : ` error: ${turn.error}`
  return `  turn ${turn.step}: ${calls}${error} · chat ${turn.chatId ?? '-'} · ${turn.latencyMs ?? '-'} ms · ${teeText(turn.tee)}`
}

/** Print each nav turn once per intent; a running intent's turn waits for its TEE proof (stored after the reply). */
const printed = new Map<string, Set<number>>()
const printTurns = (intent: IntentView) => {
  const seen = printed.get(intent.id) ?? new Set<number>()
  printed.set(intent.id, seen)
  const pending = (turn: NavTurnView) => turn.tee === null && turn.error === null && isOpenIntent(intent.state)
  for (const turn of intent.turns.filter((each) => !seen.has(each.step) && !pending(each))) {
    seen.add(turn.step)
    say(turnLine(turn))
  }
}

const stateLine = (intent: IntentView) =>
  `${intent.state}/${intent.episodeState ?? '-'}${intent.reason === null ? '' : ` (${intent.reason})`}`

/** After the intent closed: one more read, so the last turn's TEE proof shows. */
const finalRead = async (context: BrowserContext, intent: IntentView) => {
  await sleep(4000)
  const final = await readIntent(context, intent.robotId, intent.id)
  if (final !== null) printTurns(final)
  return final ?? intent
}

/** Poll the intent until `done` says so or it closes; print turns and state changes as they land. */
const watchIntent = async (
  context: BrowserContext,
  robotId: string,
  intentId: string,
  seconds: number,
  done: (intent: IntentView) => boolean = () => false,
) => {
  let last: IntentView | null = null
  for (const until = Date.now() + seconds * 1000; Date.now() < until; await sleep(3000)) {
    const intent = await readIntent(context, robotId, intentId)
    if (intent === null) continue
    printTurns(intent)
    if (last === null || stateLine(last) !== stateLine(intent)) say(`  intent ${stateLine(intent)}`)
    last = intent
    if (done(intent)) return intent
    if (!isOpenIntent(intent.state)) return finalRead(context, intent)
  }
  say(`  the intent did not end within ${seconds} s`)
  return last
}

const decisionLine = (decision: Decision) => {
  const tee = Option.getOrNull(
    Schema.decodeUnknownOption(Schema.fromJsonString(TeeVerified))(decision.tee_json ?? 'null'),
  )
  return `  decide: ${decision.action} · “${(decision.reason ?? '').slice(0, 140)}” · request ${decision.request_id ?? '-'} · chat ${decision.chat_id ?? '-'} · ${decision.latency_ms ?? '-'} ms · ${teeText(tee)}`
}

const reportErrand = async (context: BrowserContext, robotId: string, episodeId: string | null) => {
  if (episodeId === null) {
    say('  no errand came of it (the duck never scanned)')
    return null
  }
  const errand = await readErrand(context, robotId, episodeId)
  if (errand === null) {
    say(`  errand ${episodeId}: unreadable`)
    return null
  }
  const { episode, payment, approval } = errand
  say(
    `  errand ${episodeId}: ${episode.item} ${episode.state}${episode.result === null ? '' : ` (${episode.result.slice(0, 120)})`}`,
  )
  for (const decision of errand.decisions) say(decisionLine(decision))
  if (payment !== null && payment.txHash !== null) say(`  paid ${explorer(payment.txHash)}`)
  if (approval !== null) say(`  approval ${approval.id} ${approval.status}`)
  return errand
}

// --- the journey ----------------------------------------------------------------------------------------------------

const signup = async (page: Page) => {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.locator('#display-name').fill('Sim Owner')
  await page.getByRole('button', { name: 'Create passkey wallet' }).click()
  await page.waitForURL(/\/wallet/, { timeout: 60_000 })
  const wallet = await getJson(page.context(), '/api/wallet', WalletView)
  const address = wallet?.account.smartAccount ?? ''
  say(`signed up: owner ${address}`)
  await shot(page, '01-signed-up')
  return address
}

const fundOwner = async (address: string) => {
  const units = usdcToUnits(fund)
  if (units === 0n) return say('not funded (--fund 0): a payment will fail on Arc')
  if (units > 300_000n) throw new Error('--fund is capped at 0.30 USDC')
  if (!isHex(address)) throw new Error('no owner address to fund')
  const key = process.env.APP_RELAYER_PRIVATE_KEY ?? ''
  if (!/^0x[0-9a-f]{64}$/.test(key)) throw new Error('--fund needs APP_RELAYER_PRIVATE_KEY (run with --env-file)')
  const funded = await Effect.runPromise(
    sendUsdc({
      client: makeArcClient('https://rpc.mainnet.arc.io'),
      privateKey: `0x${key.slice(2)}`,
      to: address,
      units,
    }),
  )
  if (!funded.success) throw new Error(`the funding transfer reverted: ${explorer(funded.hash)}`)
  say(`funded ${fund} USDC ${explorer(funded.hash)}`)
}

/** Add robot → Simulator → name → the code bubble's "Open simulator", opened in a second tab with `debug=1`. */
const addSimulator = async (page: Page, context: BrowserContext) => {
  await page.goto(`${base}/wallet/robots`, { waitUntil: 'networkidle' })
  await page.locator('label[for="robot-kind-sim"]').click()
  await page.locator('#robot-name').fill('Sim duck')
  await page.getByRole('button', { name: 'Next' }).click()
  const open = page.getByRole('link', { name: 'Open simulator' })
  await open.waitFor({ timeout: 30_000 })
  await shot(page, '02-add-robot-code')
  const href = (await open.getAttribute('href')) ?? ''
  const url = new URL(href, base)
  const robotId = url.searchParams.get('robot') ?? ''
  if (robotId === '' || !url.hash.startsWith('#pair=')) throw new Error(`unexpected simulator link ${url.pathname}`)
  say(`robot ${robotId} (kind sim); simulator link ${url.pathname}?robot=… #pair=<code>`)
  url.searchParams.set('debug', '1')
  const sim = await context.newPage()
  sim.on('pageerror', (error) => say(`  [sim pageerror] ${error.message.slice(0, 200)}`))
  sim.on('console', (message) => {
    if (message.type() === 'error') say(`  [sim console] ${message.text().slice(0, 200)}`)
  })
  const booting = Date.now()
  await sim.goto(url.toString(), { waitUntil: 'domcontentloaded' })
  await sim.getByText('chip paired').waitFor({ timeout: 180_000 })
  say(`sim chip paired after ${Math.round((Date.now() - booting) / 1000)} s`)
  await sim.waitForFunction(() => 'vqDebug' in window, null, { timeout: 300_000, polling: 1000 })
  say(`duck standing at the entrance after ${Math.round((Date.now() - booting) / 1000)} s`)
  await page.getByText('Sim duck connected').waitFor({ timeout: 60_000 })
  say('the wallet saw the pairing')
  await shot(sim, '03-sim-paired')
  return { robotId, sim }
}

const grant = async (page: Page) => {
  await shot(page, '04-allowance-form')
  await page.getByRole('button', { name: 'Confirm with passkey' }).click()
  await page.waitForURL(/\/robot\//, { timeout: 180_000 })
  await page.locator('#instruction').waitFor({ timeout: 60_000 })
  say('allowance active; the conversation is open')
  await shot(page, '05-conversation')
}

/** Send an instruction from the conversation's text box; returns the new intent id. */
const instruct = async (page: Page, instruction: string) => {
  // `fill` waits (up to its timeout) for the box to be enabled again: the dock disables it while an errand runs.
  await page.locator('#instruction').fill(instruction, { timeout: 120_000 })
  const created = page.waitForResponse(
    (response) => /\/api\/robots\/[^/]+\/intents$/.test(response.url()) && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const response = await created
  const body: unknown = await response.json().catch(() => null)
  const intent = Option.getOrNull(Schema.decodeUnknownOption(CreatedIntent)(body))
  if (!response.ok() || intent === null) {
    const error = Option.match(Schema.decodeUnknownOption(ErrorBody)(body), {
      onNone: () => '',
      onSome: (e) => e.error,
    })
    throw new Error(`the intent was refused (${response.status()}): ${error}`)
  }
  say(`“${instruction}” → intent ${intent.id}`)
  return intent.id
}

const simGateOpened = (sim: Page, stall: string) =>
  sim
    .getByText(new RegExp(`${stall} invoice \\S+ paid: gate open`))
    .waitFor({ timeout: 600_000 })
    .then(() => true)
    .catch(() => false)

const chai = async (page: Page, sim: Page, robotId: string) => {
  say('step: chai')
  const t0 = Date.now()
  const intentId = await instruct(page, 'Get me a chai')
  const gate = simGateOpened(sim, 'chai')
  const watched = setInterval(() => void shot(sim, '06-chai-walking'), 90_000)
  const intent = await watchIntent(page.context(), robotId, intentId, 900)
  clearInterval(watched)
  say(`chai intent ended ${intent?.state ?? '?'} after ${Math.round((Date.now() - t0) / 1000)} s`)
  const errand = await reportErrand(page.context(), robotId, intent?.episodeId ?? null)
  const opened = errand?.episode.state === 'paid' ? await Promise.race([gate, sleep(30_000).then(() => false)]) : false
  say(`chai stall gate opened in the sim: ${opened}`)
  await shot(sim, '07-chai-sim-end')
  await shot(page, '08-chai-conversation')
  return errand?.episode.state === 'paid'
}

const thali = async (page: Page, sim: Page, robotId: string) => {
  say('step: thali (2.00 over the 1.00 per-purchase cap)')
  const t0 = Date.now()
  const intentId = await instruct(page, 'Get me a thali')
  const intent = await watchIntent(
    page.context(),
    robotId,
    intentId,
    900,
    (view) => view.episodeState === 'awaiting_approval',
  )
  say(`thali: ${intent?.state ?? '?'}/${intent?.episodeState ?? '-'} after ${Math.round((Date.now() - t0) / 1000)} s`)
  await reportErrand(page.context(), robotId, intent?.episodeId ?? null)
  await shot(sim, '09-thali-sim')
  if (intent?.episodeState !== 'awaiting_approval') return false
  const approve = page.getByRole('link', { name: 'Approve with World ID' })
  await approve.waitFor({ timeout: 60_000 })
  const href = new URL((await approve.getAttribute('href')) ?? '', base)
  say(`the conversation asks the owner: "Approve with World ID" → ${href.origin}${href.pathname} (not followed)`)
  await shot(page, '10-thali-asks')
  // Say No here (not World) and stop the duck, so the next errand can start.
  await page.getByRole('button', { name: 'No', exact: true }).click()
  await watchIntent(page.context(), robotId, intentId, 240)
  await reportErrand(page.context(), robotId, intent.episodeId)
  await shot(page, '11-thali-declined')
  return true
}

/**
 * Runs in the sim page (`?debug=1` exposes `window.vqDebug`): once the samosa screen shows an invoice QR, put the same
 * content on the chai screen and return its payload; null (keep polling) until then. A string, so it is not typed here.
 */
const SHOW_SAMOSA_AT_CHAI = `(() => {
  const cafe = window.vqDebug.cafe
  const samosa = cafe.stall('samosa').screen()
  if (samosa.kind !== 'qr') return null
  cafe.stall('chai').setScreen(samosa)
  return samosa.payload
})()`

const mismatch = async (page: Page, sim: Page, robotId: string) => {
  say('step: mismatch ("Get me a chai", the chai screen shows the samosa invoice)')
  // Wait for the samosa screen to show an invoice, then put it on the chai stall's screen too (the merchant's mistake).
  const swapped = await sim.waitForFunction(SHOW_SAMOSA_AT_CHAI, null, { timeout: 120_000, polling: 2000 })
  say(`the chai screen now shows the samosa invoice ${String(await swapped.jsonValue()).slice(4)}`)
  const t0 = Date.now()
  const intentId = await instruct(page, 'Get me a chai')
  const intent = await watchIntent(page.context(), robotId, intentId, 900)
  say(`mismatch intent ended ${intent?.state ?? '?'} after ${Math.round((Date.now() - t0) / 1000)} s`)
  const errand = await reportErrand(page.context(), robotId, intent?.episodeId ?? null)
  await shot(sim, '12-mismatch-sim')
  await shot(page, '13-mismatch-conversation')
  return errand?.episode.state === 'walked_away'
}

const main = async () => {
  mkdirSync(screens, { recursive: true })
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const results: Record<string, boolean> = {}
  try {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    await addVirtualAuthenticator(context, page)
    const owner = await signup(page)
    // Fund while the account is still counterfactual: sendUsdc is a 21,000-gas plain transfer, which reverts out of gas
    // once the grant has deployed the account (6 Nov run, tx 0xa691c2ea…0acf).
    if (runs('chai')) await fundOwner(owner)
    const { robotId, sim } = await addSimulator(page, context)
    await grant(page)
    if (runs('chai')) results.chai = await chai(page, sim, robotId)
    if (runs('thali')) results.thali = await thali(page, sim, robotId)
    if (runs('mismatch')) results.mismatch = await mismatch(page, sim, robotId)
  } finally {
    say(`results ${JSON.stringify(results)}`)
    await browser.close()
  }
  if (Object.values(results).some((ok) => !ok)) process.exitCode = 1
}

await main()
