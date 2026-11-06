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

const smartAccount = async (page: Page) => {
  const address = page.locator('.smart-account')
  await address.waitFor({ state: 'visible' })
  return (await address.textContent()) ?? ''
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
    await page.goto(origin, { waitUntil: 'networkidle' })
    await page.locator('#display-name').fill('Browser Owner')
    await page.getByRole('button', { name: 'Create passkey wallet' }).click()
    const address = await smartAccount(page)
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(await page.getByText('Signed in as Browser Owner').isVisible()).toBe(true)
    const session = (await context.cookies()).find((cookie) => cookie.name === 'vq_session')
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })

    await page.reload({ waitUntil: 'networkidle' })
    expect(await smartAccount(page)).toBe(address)

    const cookies = await context.cookies()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
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
