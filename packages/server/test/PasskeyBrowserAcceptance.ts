import { expect } from 'bun:test'
import type { Browser, BrowserContext, Page } from 'playwright'

/** Chrome's CDP virtual authenticator: a platform passkey with user verification that answers every prompt. */
export const addVirtualAuthenticator = async (context: BrowserContext, page: Page) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
}

/** The wallet's profile sheet (the avatar) shows the signed-in owner's smart account; it stays open afterwards. */
const openProfile = async (page: Page) => {
  await page.getByRole('button', { name: 'Profile, records and sign out' }).click()
  const sheet = page.getByRole('dialog')
  await sheet.waitFor({ state: 'visible' })
  return sheet
}

const smartAccount = async (page: Page) => {
  const sheet = await openProfile(page)
  const address = (await sheet.getByText(/^0x[0-9a-fA-F]{40}$/).textContent()) ?? ''
  await page.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden' })
  return address
}

/** The real browser ceremony through Chrome's virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator`):
 * signup shows the counterfactual address, the session survives a reload, logout kills the old cookie, and the
 * same discoverable passkey signs back in to the same account. */
export const verifyPasskeyBrowser = async (browser: Browser, origin: string): Promise<void> => {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } })
  try {
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await addVirtualAuthenticator(context, page)
    await page.goto(new URL('/app/', origin).toString(), { waitUntil: 'networkidle' })
    await page.locator('#display-name').fill('Browser Owner')
    await page.getByRole('button', { name: 'Create passkey wallet' }).click()
    // Signed up on the sign-in page, the owner lands on the first steps (Telegram, money, robot); the wallet is a tap away.
    await page.waitForURL(new URL('/app/welcome', origin).toString(), { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Where should your robot reach you?' }).waitFor({ state: 'visible' })
    // Let the page crossfade into /welcome finish before the next navigation starts another.
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)))
    await page.getByRole('link', { name: 'Go to the wallet' }).click()
    await page.waitForURL(new URL('/app/wallet', origin).toString())
    const address = await smartAccount(page)
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    const session = (await context.cookies()).find((cookie) => cookie.name === 'vq_session')
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })

    await page.reload({ waitUntil: 'networkidle' })
    expect(await smartAccount(page)).toBe(address)

    const cookies = await context.cookies()
    const sheet = await openProfile(page)
    expect(await sheet.getByRole('heading', { name: 'Browser Owner' }).isVisible()).toBe(true)
    await sheet.getByRole('button', { name: 'Sign out', exact: true }).click()
    await page.getByRole('button', { name: 'Create passkey wallet' }).waitFor({ state: 'visible' })
    // Replaying the old cookie must fail at once: logout bumped the account's security revision.
    const replay = await context.request.get(new URL('/api/auth/session', origin).toString(), {
      headers: { cookie: cookies.map(({ name, value }) => `${name}=${value}`).join('; ') },
    })
    expect(replay.status()).toBe(401)

    await page.getByRole('button', { name: 'Sign in with passkey' }).click()
    expect(await smartAccount(page)).toBe(address)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
}
