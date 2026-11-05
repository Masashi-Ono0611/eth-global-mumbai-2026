import { expect } from 'bun:test'
import type { Browser } from 'playwright'

/** Test-only identity created in native D1; no public seed route is deployed. */
export const verifyBrowserIdentity = async (browser: Browser, origin: string): Promise<void> => {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } })
  try {
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(new URL('/login', origin).toString(), { waitUntil: 'networkidle' })
    await page.locator('#auth-email').fill('native-browser@example.invalid')
    await page.locator('#auth-password').fill('incorrect-password')
    await page.locator('button[type=submit]').click()
    await page.getByRole('alert').waitFor({ state: 'visible' })
    expect(await page.locator('#auth-password').inputValue()).toBe('')
    await page.locator('#auth-password').fill('native-identity-password-52')
    await page.locator('button[type=submit]').click()
    await page.locator('.account-details').waitFor({ state: 'visible' })
    expect(await page.locator('.account-details').textContent()).toContain('native-browser@example.invalid')
    expect((await context.cookies()).some((cookie) => cookie.httpOnly && cookie.sameSite === 'Lax')).toBe(true)
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('.account-details').waitFor({ state: 'visible' })
    expect(await page.locator('.account-details').textContent()).toContain('Native Identity')
    await page.goto(new URL('/account', origin).toString(), { waitUntil: 'networkidle' })
    await page.locator('.account-details').waitFor({ state: 'visible' })
    const cookies = await context.cookies()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await page.locator('#auth-password').waitFor({ state: 'visible' })
    // Replaying the old browser cookie must fail immediately, without waiting for expiry.
    const replay = await context.request.post(new URL('/api/auth/getSession', origin).toString(), {
      headers: {
        origin: new URL(origin).origin,
        'x-effect-auth-csrf': '1',
        cookie: cookies.map(({ name, value }) => `${name}=${value}`).join('; '),
      },
      data: {},
    })
    expect(await replay.json()).toMatchObject({ _tag: 'Success', value: null })
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('#auth-password').waitFor({ state: 'visible' })
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
}
