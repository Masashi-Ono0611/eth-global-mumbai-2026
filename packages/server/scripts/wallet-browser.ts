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
//   --fund (default 0.01, at most 1.00) sends that much USDC from the relayer to the new owner first; a paid chai needs
//   ≥ 0.10, chai + the approved cigarettes ≥ 0.60.
//   The owner is throwaway (its virtual passkey ends with the run), so the funds stay in that account.
//   --only-restricted skips chai, the gate and the post-revoke chai. Exit 0 when every step showed what it must.
const DEPLOYED = 'https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev'
const flag = (name: string) => {
  const index = Bun.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : Bun.argv[index + 1]
}
const base = new URL(flag('base-url') ?? DEPLOYED).origin
// A throwaway owner's virtual passkey dies with the browser, so whatever it holds is stranded: fund only a little.
const fund = flag('fund') ?? '0.01'
/** Skip the chai, gate and post-revoke steps: only the restricted approve / deny (and the revoke). */
const onlyRestricted = Bun.argv.includes('--only-restricted')
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
  // The form's defaults (1.00 a day, 0.30 per payment): chai 0.10 + an approved 0.50 stay under the daily cap.
  await page.getByRole('button', { name: 'Grant a budget' }).click()
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

const stateText = (page: Page) => page.locator('.errand-detail [role=status]').first().textContent()

/**
 * The restricted item answered through the issuer World authorize sends us to (World IdP, or the rehearsal stub):
 * the brain asks the owner, the approval page shows what is approved, the issuer's Approve or Deny decides.
 * Approve → the chip signs with the co-signed approval and the console ends `paid`; Deny → `denied`, nothing paid.
 */
const restricted = async (page: Page, choice: 'approve' | 'deny', step: number) => {
  const prefix = (n: number, name: string) => `${String(step + n).padStart(2, '0')}-restricted-${choice}-${name}`
  const ask = page.getByRole('link', { name: 'Approve in World App' })
  // The brain may still walk away from a restricted item; that ends the errand with nothing paid, so ask again (≤ 3).
  let asked = false
  for (let attempt = 1; attempt <= 3 && !asked; attempt += 1) {
    await page.getByRole('button', { name: 'Buy Cigarettes (0.50 USDC)' }).click()
    // The previous attempt's ended state must be gone before its text can be read as this attempt's answer.
    await page
      .getByText(/^cigarettes: /)
      .waitFor({ state: 'detached', timeout: 10_000 })
      .catch(() => undefined)
    asked = await Promise.race([
      ask.waitFor({ timeout: 60_000 }).then(() => true),
      page
        .getByText(/^cigarettes: (walked away|safe stop|failed|expired)$/)
        .waitFor({ timeout: 60_000 })
        .then(() => false),
    ]).catch(() => false)
    if (!asked) {
      say(`attempt ${attempt}: ${await stateText(page)} (the brain did not ask the owner)`)
      await shot(page, prefix(0, `no-approval-${attempt}`))
      await page.getByRole('button', { name: 'Buy Cigarettes (0.50 USDC)' }).waitFor()
      await page.waitForTimeout(2000)
    }
  }
  if (!asked) return say('no approval after 3 attempts; skipping this restricted step')
  // The link can show before the errand's decision line has loaded; the shot is for that line.
  await page
    .getByText('cigarettes: waiting for approval')
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined)
  await shot(page, prefix(0, 'asks'))
  await ask.click()
  // The heading renders before the approval loads; the World link is there only once its details are.
  const approveWithWorld = page.getByRole('link', { name: 'Approve with World' })
  await approveWithWorld.waitFor({ timeout: 30_000 })
  await shot(page, prefix(1, 'approval'))
  await approveWithWorld.click()
  await page.waitForLoadState('networkidle')
  const issuerPage = (await page.locator('h1').first().textContent()) ?? ''
  say(`issuer page: ${issuerPage}`)
  await shot(page, prefix(2, 'issuer'))
  await page.locator(`#${choice}`).click()
  const outcome = choice === 'approve' ? 'Approved: the chip signs the payment now' : 'Denied: nothing is paid'
  await page.getByText(outcome).waitFor({ timeout: 60_000 })
  await shot(page, prefix(3, 'answered'))
  await page.getByRole('link', { name: 'Open console' }).click()
  await page.locator('.errand-detail').waitFor({ timeout: 30_000 })
  await until(page, async () => TERMINAL.test((await stateText(page)) ?? ''), 'the restricted errand ending', 240)
  say(`restricted ${choice}: ${await stateText(page)}`)
  const payment = page.getByRole('link', { name: 'Payment on Arc' })
  if (await payment.isVisible()) say(`paid ${await payment.getAttribute('href')}`)
  await shot(page, prefix(4, 'console'))
}

/** After the revoke, the next purchase must fail on Arc (`CannotUseADisabledDelegation`). */
const afterRevoke = async (page: Page, robotUrl: string) => {
  await page.goto(robotUrl, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Buy Chai (0.10 USDC)' }).click()
  await page.locator('.errand-detail').waitFor({ timeout: 60_000 })
  await until(page, async () => TERMINAL.test((await stateText(page)) ?? ''), 'the post-revoke errand ending', 240)
  say(
    `after revoke: ${await stateText(page)} ${(await page.locator('.errand-detail .hint').first().textContent()) ?? ''}`,
  )
  await shot(page, '21-after-revoke')
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
  await shot(page, '20-revoked')
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
      if (units > 1_000_000n) throw new Error('--fund is capped at 1.00 USDC')
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
    if (onlyRestricted) {
      await page.getByRole('link', { name: 'Open console' }).first().click()
      await page.getByRole('button', { name: 'Buy Cigarettes (0.50 USDC)' }).waitFor()
    } else {
      const gate = await context.newPage()
      await gate.goto(`${base}/gate/duck-cafe`, { waitUntil: 'networkidle' })
      await shot(gate, '08-gate-closed')
      // The gate shows OPEN for a few seconds once its invoice is paid, then asks for a fresh one: catch it live.
      const opened = gate
        .getByText('OPEN', { exact: true })
        .waitFor({ timeout: 300_000 })
        .then(() => shot(gate, '08-gate-open').then(() => true))
        .catch(() => false)
      if (!(await errand(page))) return say('the errand did not start; stopping before the restricted steps')
      say(`gate opened: ${await opened}`)
    }
    const robotUrl = page.url()
    await restricted(page, 'approve', 10)
    await restricted(page, 'deny', 15)
    await revoke(page)
    if (!onlyRestricted) await afterRevoke(page, robotUrl)
    say('done')
  } finally {
    for (const stop of stops) stop()
    await browser.close()
  }
}

await main()
