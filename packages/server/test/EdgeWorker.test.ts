import { describe, expect, test } from 'vitest'
import edge, { isApiPath } from '../src/EdgeWorker.ts'

describe('public edge routing', () => {
  test.each([
    '/api',
    '/api/auth/getSession',
    '/rpc/test',
    '/mcp',
    '/.well-known/oauth-authorization-server',
    '/cdn/id',
    '/out/id',
  ])('routes the API namespace %s', (path) => expect(isApiPath(path)).toBe(true))
  test.each(['/', '/@name', '/apiary', '/rpc-other', '/mcps', '/.well-known-example', '/outfit', '/cdn-old'])(
    'keeps website path %s on the website',
    (path) => expect(isApiPath(path)).toBe(false),
  )
  test('passes request bodies, cookies, redirects and repeated response headers unchanged', async () => {
    const request = new Request('https://app.test/api/auth/getSession?x=1', {
      method: 'POST',
      headers: {
        cookie: 'session=test',
        origin: 'https://app.test',
        'x-app-correlation-id': 'caller-controlled-secret',
        'x-app-job-id': 'caller-controlled-secret',
        'x-app-kind': 'caller-controlled-secret',
      },
      body: '{}',
    })
    const headers = new Headers({ location: '/signed-in' })
    headers.append('set-cookie', 'session=one; HttpOnly; Secure')
    headers.append('set-cookie', 'csrf=two; Secure')
    const response = new Response('redirect', { status: 302, headers })
    const api = {
      fetch: async (received: Request) => {
        expect(received.url).toBe(request.url)
        expect(received.method).toBe(request.method)
        expect(await received.text()).toBe('{}')
        expect(received.headers.get('cookie')).toBe('session=test')
        expect(received.headers.get('origin')).toBe('https://app.test')
        expect(received.headers.get('x-app-correlation-id')).toMatch(/^[0-9a-f-]{36}$/)
        expect(received.headers.has('x-app-job-id')).toBe(false)
        expect(received.headers.has('x-app-kind')).toBe(false)
        return response
      },
    }
    const website = {
      fetch: async () => {
        throw new Error('Unexpected website request')
      },
    }
    const assets = {
      fetch: async () => {
        throw new Error('Unexpected assets request')
      },
    }
    const result = await edge.fetch(request, { API: api, WEBSITE: website, ASSETS: assets })
    expect(result).toBe(response)
    expect(result.headers.getSetCookie()).toHaveLength(2)
    expect(result.status).toBe(302)
  })
})
