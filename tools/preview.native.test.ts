import { expect, test } from 'bun:test'
import { chromium } from 'playwright'
import { verifyBrowser } from '../packages/server/test/BrowserAcceptance.ts'

const origin = new URL(process.env.APP_PREVIEW_URL ?? '')
if (!origin.hostname.startsWith('ethmumbai-edge-') || !origin.hostname.endsWith('.workers.dev')) {
  throw new Error('Acceptance requires the deployed edge URL')
}

test('deployed preview serves API/auth contracts and the hydrated website', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    const health = await context.request.get(new URL('/api/health', origin).toString())
    expect(health.status()).toBe(200)
    expect(await health.json()).toMatchObject({ service: 'styldappv2', status: 'ok' })
    const session = await context.request.post(new URL('/api/auth/getSession', origin).toString(), {
      headers: { origin: origin.origin, 'x-effect-auth-csrf': '1' },
      data: {},
    })
    expect(session.status()).toBe(200)
    expect(await session.json()).toMatchObject({ _tag: 'Success' })
    const rejected = await context.request.post(new URL('/api/auth/getSession', origin).toString(), {
      headers: { origin: 'https://evil.invalid', 'x-effect-auth-csrf': '1' },
      data: {},
    })
    expect(rejected.status()).toBe(403)
    const missing = await context.request.get(new URL('/api/missing', origin).toString())
    expect(missing.status()).toBe(404)
    await context.close()
    await verifyBrowser(browser, origin.origin)
  } finally {
    await browser.close()
  }
}, 60000)
