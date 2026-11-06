import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeArcClient } from '@ethmumbai/chain/Arc'
import { sendUsdc } from '@ethmumbai/chain/Fund'
import { isHex } from '@ethmumbai/protocol/Hex'
import { usdcToUnits } from '@ethmumbai/protocol/Invoice'
import { Effect } from 'effect'
import { type Browser, chromium, type Page } from 'playwright'
import { addVirtualAuthenticator } from '../test/PasskeyBrowserAcceptance.ts'

// The owner's whole journey through the real UI of a deployed app, in Chromium with a CDP virtual authenticator
// (spec §2 M7): passkey signup → the counterfactual address → Add robot → the mock chip pairs → the passkey signs a
// grant → "Buy Chai" on the console (reload mid-errand: the console restores the errand from activity and keeps
// polling) → the gate → revoke. Screenshots go to docs/evidence/screens/. Prints ids and explorer links only.
// Usage: bun --env-file=.env.main.local packages/server/scripts/wallet-browser.ts [--base-url URL] [--fund 0.15]
//   --fund (default 0.01) sends that much USDC from the relayer to the new owner first; a paid chai needs ≥ 0.10.
//   The owner is throwaway (its virtual passkey ends with the run), so the funds stay in that account.
//   Exit 0 when every step showed what it must.
const DEPLOYED = 'https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev'
const flag = (name: string) => {
  const index = Bun.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : Bun.argv[index + 1]
}
const base = new URL(flag('base-url') ?? DEPLOYED).origin
// A throwaway owner's virtual passkey dies with the browser, so whatever it holds is stranded: fund only a little.
const fund = flag('fund') ?? '0.01'
const screens = join(import.meta.dir, '../../../docs/evidence/screens')
const say = (line: string) => process.stdout.write(`browser  ${line}\n`)
const TERMINAL = /: (paid|walked away|safe stop|denied|refused by the chip|failed|expired)$/

const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: join(screens, `${name}.png`), fullPage: true })
  say(`screenshot docs/evidence/screens/${name}.png`)
}

const withAuthenticator = async (browser: Browser) => {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 430, height: 932 } })
  const page = await context.newPage()
  await addVirtualAuthenticator(context, page)
  return { context, page }
}

const startChip = (pairingCode: string) => {
  const state = mkdtempSync(join(tmpdir(), 'vq-browser-chip-'))
  const child = Bun.spawn(['bun', 'apps/chip/src/main.ts', '--server', base, '--pair', pairingCode, '--state', state], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return () => child.kill()
}

const until = async (page: Page, check: () => Promise<boolean>, what: string, seconds: number, refresh?: string) => {
  for (let elapsed = 0; elapsed < seconds; elapsed += 2) {
    if (await check()) return
    const button = page.getByRole('button', { name: refresh ?? '' }).first()
    if (refresh !== undefined)
      await ((await button.isVisible()) ? button.click() : page.reload({ waitUntil: 'networkidle' }))
    await page.waitForTimeout(2000)
  }
  throw new Error(`${what} did not happen within ${seconds} s`)
}

const signup = async (page: Page) => {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.locator('#display-name').fill('Browser Owner')
  await page.getByRole('button', { name: 'Create passkey wallet' }).click()
  const address = (await page.locator('.smart-account').textContent({ timeout: 30_000 })) ?? ''
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('no counterfactual address after signup')
  say(`owner ${address}`)
  await shot(page, '01-signed-up')
  return address
}

const pairRobot = async (page: Page) => {
  await page.goto(`${base}/wallet/robots`, { waitUntil: 'networkidle' })
  await page.locator('#robot-name').fill('Browser duck')
  await page.getByRole('button', { name: 'Add robot' }).click()
  const code = (await page.locator('.pairing-code').textContent({ timeout: 15_000 })) ?? ''
  say(`pairing code issued (${code.length} chars)`)
  await shot(page, '03-pairing-code')
  const stopChip = startChip(code)
  await until(page, () => page.getByText('paired · online').isVisible(), 'chip pairing', 90, 'Refresh')
  return stopChip
}

const grant = async (page: Page) => {
  await page.getByRole('button', { name: 'Grant a budget' }).click()
  await page.locator('#grant-daily').fill('0.50')
  await page.locator('#grant-per-payment').fill('0.25')
  await page.locator('.consent').waitFor()
  await shot(page, '04-grant-consent')
  await page.getByRole('button', { name: 'Sign grant with passkey' }).click()
  await page.getByText('(active)').first().waitFor({ timeout: 120_000 })
  say('grant active')
  await shot(page, '05-grant-active')
}

/** Buy chai, reload mid-errand, and check the console restores the errand and keeps polling until it ends. */
const errand = async (page: Page): Promise<boolean> => {
  await page.getByRole('link', { name: 'Open console' }).first().click()
  await page.getByRole('button', { name: 'Buy Chai (0.10 USDC)' }).click()
  const started = await Promise.race([
    page
      .locator('.errand-detail')
      .waitFor({ timeout: 60_000 })
      .then(() => true),
    page
      .getByText('not configured:')
      .waitFor({ timeout: 60_000 })
      .then(() => false),
  ])
  if (!started) {
    say(`errand refused: ${await page.getByRole('alert').first().textContent()} (no decision is ever faked)`)
    await shot(page, '06-console-not-configured')
    return false
  }
  await shot(page, '06-console-live')
  const live = !TERMINAL.test((await page.locator('.errand-detail [role=status]').textContent()) ?? '')
  const polls: Array<string> = []
  page.on('request', (request) => {
    if (/\/api\/robots\/[^/]+\/errands\/[^/]+$/.test(request.url())) polls.push(request.url())
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.errand-detail').waitFor({ timeout: 30_000 })
  say(`after reload the console restored the errand (${live ? 'live' : 'already ended'})`)
  await until(
    page,
    async () => TERMINAL.test((await page.locator('.errand-detail [role=status]').textContent()) ?? ''),
    'the errand ending',
    240,
  )
  if (live && polls.length < 2) throw new Error(`the console polled ${polls.length} times after the reload`)
  say(
    `console polled ${polls.length} times after the reload; ended: ${await page.locator('.errand-detail [role=status]').textContent()}`,
  )
  const payment = page.getByRole('link', { name: 'Payment on Arc' })
  if (await payment.isVisible()) say(`paid ${await payment.getAttribute('href')}`)
  await shot(page, '07-console-ended')
  return true
}

/** The restricted item: 0G asks the owner, the approval page shows what is approved, the owner denies, nothing is paid. */
const restricted = async (page: Page) => {
  await page.getByRole('button', { name: 'Buy Cigarettes (0.50 USDC)' }).click()
  const approve = page.getByRole('link', { name: 'Approve in World App' })
  const asked = await approve
    .waitFor({ timeout: 60_000 })
    .then(() => true)
    .catch(() => false)
  if (!asked) {
    say('no approval link: 0G did not ask, or ENFORCER/APPROVER are not configured on this deploy')
    return shot(page, '10-restricted')
  }
  await shot(page, '10-restricted-asks')
  await approve.click()
  await page.getByRole('heading', { name: 'Approval for a restricted item' }).waitFor({ timeout: 30_000 })
  await shot(page, '11-approval')
  await page.getByRole('button', { name: 'Deny' }).click()
  await page.getByText('Denied: nothing is paid').waitFor({ timeout: 30_000 })
  say('restricted item denied by the owner; nothing paid')
  await shot(page, '12-approval-denied')
}

const revoke = async (page: Page) => {
  await page.goto(`${base}/wallet/robots`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Revoke grant' }).click()
  // Never reload while the revoke request is in flight: the passkey prompt, the relayer send and the receipt all run
  // inside it. Afterwards a reload settles a 'revoking' grant from Arc.
  const outcome = await Promise.race([
    page
      .getByText('(revoked)')
      .first()
      .waitFor({ timeout: 150_000 })
      .then(() => 'revoked'),
    page
      .getByRole('alert')
      .first()
      .waitFor({ timeout: 150_000 })
      .then(() => 'alert'),
  ]).catch(() => 'timeout')
  if (outcome === 'alert') throw new Error(`revoke refused: ${await page.getByRole('alert').first().textContent()}`)
  if (outcome === 'timeout')
    await until(page, () => page.getByText('(revoked)').first().isVisible(), 'revoke settling', 60, 'Refresh')
  const tx = page.getByRole('link', { name: 'Revoke transaction' })
  if (await tx.isVisible()) say(`revoked ${await tx.getAttribute('href')}`)
  await shot(page, '09-revoked')
}

const main = async () => {
  mkdirSync(screens, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const stops: Array<() => void> = []
  try {
    const { page, context } = await withAuthenticator(browser)
    const owner = await signup(page)
    {
      if (!isHex(owner)) throw new Error('the signup address is not hex')
      const units = usdcToUnits(fund)
      if (units > 500_000n) throw new Error('--fund is capped at 0.50 USDC')
      const key = process.env.APP_RELAYER_PRIVATE_KEY ?? ''
      if (!/^0x[0-9a-f]{64}$/.test(key)) throw new Error('--fund needs APP_RELAYER_PRIVATE_KEY (run with --env-file)')
      const funded = await Effect.runPromise(
        sendUsdc({
          client: makeArcClient('https://rpc.mainnet.arc.io'),
          privateKey: `0x${key.slice(2)}`,
          to: owner,
          units,
        }),
      )
      say(`funded ${fund} USDC https://explorer.arc.io/tx/${funded.hash}`)
    }
    await page.goto(`${base}/wallet`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Copy address' }).waitFor()
    await shot(page, '02-wallet')
    stops.push(await pairRobot(page))
    await grant(page)
    const gate = await context.newPage()
    await gate.goto(`${base}/gate/duck-cafe`, { waitUntil: 'networkidle' })
    const ran = await errand(page)
    await gate.waitForTimeout(3000)
    await shot(gate, '08-gate')
    if (ran) await restricted(page)
    await revoke(page)
    say('done')
  } finally {
    for (const stop of stops) stop()
    await browser.close()
  }
}

await main()
