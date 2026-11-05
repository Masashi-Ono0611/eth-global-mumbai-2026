import { expect } from 'bun:test'
import type { Browser } from 'playwright'

/** Run against either the native edge or the isolated deployed preview. */
export const verifyBrowser = async (browser: Browser, origin: string): Promise<void> => {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } })
  try {
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const documentResponse = await page.goto(origin, { waitUntil: 'networkidle' })
    expect(documentResponse?.status()).toBe(200)
    expect(await page.locator('h1').textContent()).toBe('A wardrobe shaped by you.')
    expect(await page.locator('.masthead').evaluate((element) => getComputedStyle(element).display)).toBe('flex')
    await page.selectOption('#language', 'sl')
    await page.waitForFunction(() => document.documentElement.lang === 'sl')
    expect(await page.locator('h1').textContent()).toBe('Garderoba po tvojem okusu.')
    expect((await context.cookies()).find((cookie) => cookie.name === 'styld_locale')).toMatchObject({
      value: 'sl',
      httpOnly: true,
      sameSite: 'Lax',
    })
    await page.reload({ waitUntil: 'networkidle' })
    expect(await page.locator('html').getAttribute('lang')).toBe('sl')
    await page.selectOption('#language', 'ar-XB')
    await page.waitForFunction(() => document.documentElement.dir === 'rtl')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.selectOption('#language', 'en')
    await page.waitForFunction(() => document.documentElement.lang === 'en')
    const loginResponse = await page.goto(new URL('/login', origin).toString(), { waitUntil: 'networkidle' })
    expect(loginResponse?.status()).toBe(200)
    await page.locator('#auth-password').waitFor({ state: 'visible' })
    expect(await page.locator('h1').textContent()).toBe('Sign in to Styld')
    expect(await page.locator('#auth-password').getAttribute('autocomplete')).toBe('current-password')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
}
