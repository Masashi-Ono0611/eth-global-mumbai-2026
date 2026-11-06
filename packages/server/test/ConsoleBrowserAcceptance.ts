import { expect } from 'bun:test'
import type { TestApi } from 'alchemy/Test/Bun'
import { Effect, Schema } from 'effect'
import { chromium, type Page } from 'playwright'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { grantRow, randomId, sampleGrant } from './AgentSamples.ts'
import { TEST_MERCHANT_PAY_TO } from './MerchantAcceptance.ts'
import { addVirtualAuthenticator } from './PasskeyBrowserAcceptance.ts'
import type { ZeroGStub } from './RobotAcceptance.ts'

type Urls = { readonly appUrl: string; readonly url: string }

const Session = Schema.Struct({ accountId: Schema.String })
const ERRAND_POLL = /\/api\/robots\/[^/]+\/errands\/[^/]+$/

const seed = async (url: string, path: string, body: unknown) => {
  const response = await fetch(`${url}${path}`, { method: 'POST', body: JSON.stringify(body) })
  expect(response.status, path).toBe(204)
}

/** A paired robot of the signed-in owner with a signed grant to a throwaway chip that never polls. */
export const seedRobot = async (url: string, accountId: string) => {
  const robotId = randomId()
  const chip = privateKeyToAccount(generatePrivateKey()).address
  await seed(url, '/test/vq/robots', { id: robotId, accountId, pairingCode: null, chipAddress: chip, chipToken: null })
  const delegation = sampleGrant(chip, TEST_MERCHANT_PAY_TO)
  await seed(url, '/test/vq/grants', grantRow({ robotId, accountId, delegation, payee: TEST_MERCHANT_PAY_TO }))
  return robotId
}

/** The live errand's step, as the robot says it in the conversation. */
const signingStep = (page: Page) => page.getByRole('status').filter({ hasText: 'My chip is signing the payment...' })

/**
 * The robot conversation in a real browser (spec §6, M7): "Buy Chai" runs the 0G decision (stub) and queues the chip's sign
 * request; after a reload the console restores the robot's latest errand from /api/wallet/activity and keeps polling
 * it (the chip never answers here, so the errand stays live in `signing`).
 */
export const registerConsoleAcceptance = (test: TestApi['test'], stack: Effect.Effect<Urls>, zeroG: ZeroGStub) =>
  test(
    'console: an errand shows its 0G decision, survives a reload (restored from activity) and keeps polling',
    Effect.scoped(
      Effect.gen(function* () {
        const { appUrl, url } = yield* stack
        zeroG.setMode('pay')
        const browser = yield* Effect.acquireRelease(
          Effect.promise(() => chromium.launch({ headless: true })),
          (instance) => Effect.promise(() => instance.close()),
        )
        yield* Effect.promise(async () => {
          const context = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } })
          const page = await context.newPage()
          const errors: Array<string> = []
          page.on('pageerror', (error) => errors.push(error.message))
          await addVirtualAuthenticator(context, page)
          await page.goto(appUrl, { waitUntil: 'networkidle' })
          await page.locator('#display-name').fill('Console Owner')
          await page.getByRole('button', { name: 'Create passkey wallet' }).click()
          await page.waitForURL(new URL('/wallet', appUrl).toString())
          const body: unknown = await (
            await context.request.get(new URL('/api/auth/session', appUrl).toString())
          ).json()
          if (!Schema.is(Session)(body)) throw new Error('no session after the browser signup')
          const robotId = await seedRobot(url, body.accountId)

          await page.goto(new URL(`/robot/${robotId}`, appUrl).toString(), { waitUntil: 'networkidle' })
          await page.getByRole('button', { name: 'Buy Chai for 0.10 USDC' }).click()
          // 0G's reason is quoted verbatim under the decision; a 0G provider is labelled 0G, not the rehearsal brain.
          await page.getByText('chai is allowlisted and within budget').waitFor({ timeout: 30_000 })
          expect(await page.getByText('0G decided: buy it').count()).toBe(1)
          await signingStep(page).waitFor()
          expect(await page.getByRole('button', { name: 'Buy Chai for 0.10 USDC' }).isDisabled()).toBe(true)

          const polls: Array<string> = []
          page.on('request', (request) => {
            if (ERRAND_POLL.test(new URL(request.url()).pathname)) polls.push(request.url())
          })
          await page.reload({ waitUntil: 'networkidle' })
          await page.getByText('chai is allowlisted and within budget').waitFor({ timeout: 15_000 })
          await signingStep(page).waitFor()
          await page.waitForTimeout(4_000)
          expect(polls.length).toBeGreaterThanOrEqual(2)
          expect(errors).toEqual([])
          await context.close()
        })
      }),
    ),
    { timeout: 90000 },
  )
