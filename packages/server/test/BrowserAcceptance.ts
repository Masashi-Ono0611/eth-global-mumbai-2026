import { expect } from 'bun:test'
import type { Browser } from 'playwright'

/** Run against either the native edge or the isolated deployed preview. */
export const verifyBrowser = async (browser: Browser, origin: string): Promise<void> => {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } })
  try {
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    // The app lives under /app ("/" is vitaquack.com's landing page).
    const documentResponse = await page.goto(new URL('/app/', origin).toString(), { waitUntil: 'networkidle' })
    expect(documentResponse?.status()).toBe(200)
    expect(await page.locator('h1').textContent()).toBe('A duck with a budget.')
    expect(await page.locator('html').getAttribute('lang')).toBe('en')
    await page.locator('#display-name').waitFor({ state: 'visible' })
    expect(await page.getByRole('button', { name: 'Create passkey wallet' }).isEnabled()).toBe(true)
    expect(await page.getByRole('button', { name: 'Sign in with passkey' }).isEnabled()).toBe(true)
    const removedLogin = await page.goto(new URL('/login', origin).toString(), { waitUntil: 'networkidle' })
    expect(removedLogin?.status()).toBe(404)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
}
