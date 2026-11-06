import { Effect } from 'effect'
import { expect, test } from 'vitest'
import { catalogVersion } from '@ethmumbai/i18n'
import * as Server from 'foldkit/experimental/server'
import { renderDocument, renderRequest } from '../src/entry.server.ts'

const assets = { entryScript: '/entry.js', stylesheets: [], modulePreloads: [] }

test('concurrent server renders carry the exact English catalog and the release into hydration', async () => {
  const results = await Effect.runPromise(
    Effect.all(
      Array.from({ length: 4 }, () =>
        renderRequest(new Request('https://app.test/app/', { headers: { 'accept-language': 'sl,ja;q=0.8' } }), {
          buildId: 'test-release',
        }),
      ),
      { concurrency: 'unbounded' },
    ),
  )
  for (const result of results) {
    const response = Server.toResponse((app) => renderDocument(app, assets), result)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('lang="en"')
    expect(html).toContain(catalogVersion)
    expect(html).toContain('test-release')
    expect(html).toContain('viewport-fit=cover')
  }
})

test('the old language endpoint is gone: a POST to /locale is refused without a render', async () => {
  const result = await Effect.runPromise(
    renderRequest(new Request('https://app.test/locale', { method: 'POST', body: 'locale=sl' })),
  )
  expect(Server.toResponse((app) => renderDocument(app, assets), result).status).toBe(405)
})

const respond = async (path: string, requestInit?: RequestInit) =>
  Server.toResponse(
    (app) => renderDocument(app, assets),
    await Effect.runPromise(renderRequest(new Request(`https://app.test${path}`, requestInit), { buildId: 'test' })),
  )

test('a page response names its first API reads for the browser to preload; a missing page names none', async () => {
  const session = '</api/auth/session>; rel=preload; as=fetch; crossorigin'
  expect((await respond('/app/')).headers.get('link')).toBe(session)
  expect((await respond('/app/wallet')).headers.get('link')).toContain(
    '</api/wallet>; rel=preload; as=fetch; crossorigin',
  )
  expect((await respond('/app/wallet')).headers.get('link')).toContain(session)
  expect((await respond('/app/nowhere')).headers.get('link')).toBeNull()
})

test("the merchant counter's server render already shows the menu, not a loading state", async () => {
  const html = await (await respond('/app/merchant')).text()
  expect(html).toMatch(/<h1[^>]*>Duck Café<\/h1>/)
  for (const price of ['0.10 USDC', '0.25 USDC', '2.00 USDC']) expect(html).toContain(price)
  expect(html).not.toContain('role="status"')
})

test('typed routes decide the status, and a preflight gets the allowed methods without a render', async () => {
  expect((await respond('/app')).status).toBe(200)
  expect((await respond('/app/')).status).toBe(200)
  // "/" is the static landing page on vitaquack.com; the app itself no longer claims it.
  expect((await respond('/')).status).toBe(404)
  expect((await respond('/login')).status).toBe(404)
  expect((await respond('/account')).status).toBe(404)
  for (const path of [
    '/app/wallet',
    '/app/welcome',
    '/app/wallet/robots',
    '/app/robot/abc',
    '/app/merchant',
    '/app/gate/duck-cafe',
  ])
    expect((await respond(path)).status, path).toBe(200)
  const preflight = await respond('/', { method: 'OPTIONS' })
  expect(preflight.status).toBe(204)
  expect(preflight.headers.get('allow')).toContain('GET')
})
