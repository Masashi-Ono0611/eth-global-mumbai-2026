import { Effect } from 'effect'
import { expect, test } from 'vitest'
import { catalogVersion } from '@ethmumbai/i18n'
import * as Server from 'foldkit/experimental/server'
import { Message } from '../src/message.ts'
import { LocaleSave } from '../src/model.ts'
import { init, update } from '../src/update.ts'
import { requestLocale } from '../src/Locale.ts'
import { renderDocument, renderRequest } from '../src/entry.server.ts'

const assets = { entryScript: '/entry.js', stylesheets: [], modulePreloads: [] }
const request = (language: string) => new Request('https://app.test/', { headers: { 'accept-language': language } })
const saveLocale = (origin: string, body = 'locale=sl') =>
  Effect.runPromise(
    renderRequest(
      new Request('https://app.test/locale', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
        body,
      }),
    ),
  )

test('concurrent server renders isolate locales and carry the exact catalog into hydration', async () => {
  const results = await Effect.runPromise(
    Effect.all(
      ['en', 'sl', 'en', 'sl'].map((locale) => renderRequest(request(locale), { buildId: 'test-release' })),
      { concurrency: 'unbounded' },
    ),
  )
  for (const [index, result] of results.entries()) {
    const response = Server.toResponse((app) => renderDocument(app, assets), result)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain(index % 2 === 0 ? 'A duck with a budget.' : 'Raca s proračunom.')
    expect(html).toContain(catalogVersion)
    expect(html).toContain('test-release')
    expect(html).toContain('viewport-fit=cover')
  }
})

test('negotiation respects explicit locale, cookie, language weights and exclusions', () => {
  expect(requestLocale(request('en;q=0,sl-SI;q=0.8'))).toBe('sl')
  expect(requestLocale(request('de,sl;q=0.9,en;q=0.5'))).toBe('sl')
  expect(requestLocale(request('ja-JP,ja;q=0.9,en;q=0.8'))).toBe('ja')
  expect(requestLocale(request('hi-IN,hi;q=0.9,en-IN;q=0.8'))).toBe('hi')
  expect(requestLocale(request('sl;q=0,en;q=0.5'))).toBe('en')
  expect(requestLocale(new Request('https://app.test/?lang=ar-XB', { headers: { cookie: 'app_locale=sl' } }))).toBe(
    'ar-XB',
  )
  expect(
    requestLocale(new Request('https://app.test/', { headers: { cookie: 'app_locale=sl', 'accept-language': 'en' } })),
  ).toBe('sl')
})

test('language preference writes require same-origin POST and produce protected cookies', async () => {
  const result = await saveLocale('https://app.test')
  const response = Server.toResponse((app) => renderDocument(app, assets), result)
  expect(response.status).toBe(204)
  expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Lax; Secure')
  expect(Server.toResponse((app) => renderDocument(app, assets), await saveLocale('https://evil.test')).status).toBe(
    403,
  )
  expect(
    Server.toResponse((app) => renderDocument(app, assets), await saveLocale('https://app.test', 'locale=bad')).status,
  ).toBe(400)
})

test('language changes serialize persistence and keep failure visible', () => {
  const initial = init({ locale: 'en', catalogVersion, timeZone: 'UTC', referenceTime: 0, pathname: '/' }).model
  const saving = update(initial, Message.SelectedLocale({ value: 'sl' }))
  expect(saving.commands?.[0]?.name).toBe('SaveLocale')
  expect(update(saving.model, Message.SelectedLocale({ value: 'en' })).commands).toBeUndefined()
  const failed = update(saving.model, Message.FailedSaveLocale()).model
  expect(failed.context.locale).toBe('en')
  expect(LocaleSave.guards.Failed(failed.localeSave)).toBe(true)
  expect(update(saving.model, Message.SucceededSaveLocale({ locale: 'sl' })).model.context.locale).toBe('sl')
})

test('RTL and expanded locales render without pretending to be Arabic translations', async () => {
  const rtl = await Effect.runPromise(renderRequest(new Request('https://app.test/?lang=ar-XB'), { buildId: 'test' }))
  const html = await Server.toResponse((app) => renderDocument(app, assets), rtl).text()
  expect(html).toContain('dir="rtl"')
  expect(html).toContain('lang="ar-XB"')
  expect(html).toContain('English (RTL)')
  const missing = await Effect.runPromise(renderRequest(new Request('https://app.test/missing'), { buildId: 'test' }))
  expect(Server.toResponse((app) => renderDocument(app, assets), missing).status).toBe(404)
})

const respond = async (path: string, requestInit?: RequestInit) =>
  Server.toResponse(
    (app) => renderDocument(app, assets),
    await Effect.runPromise(renderRequest(new Request(`https://app.test${path}`, requestInit), { buildId: 'test' })),
  )

test('typed routes decide the status, and a preflight gets the allowed methods without a render', async () => {
  expect((await respond('/login')).status).toBe(200)
  expect((await respond('/account')).status).toBe(200)
  expect((await respond('/login/extra')).status).toBe(404)
  const preflight = await respond('/', { method: 'OPTIONS' })
  expect(preflight.status).toBe(204)
  expect(preflight.headers.get('allow')).toContain('GET')
})
