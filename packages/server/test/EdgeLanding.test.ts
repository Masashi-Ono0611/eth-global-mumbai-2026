import { describe, expect, test } from 'vitest'
import { byteRange, isLandingAssetPath, isMediaPath, serveMedia } from '../src/EdgeLanding.ts'
import edge from '../src/EdgeWorker.ts'

const film = Uint8Array.from({ length: 100 }, (_, index) => index)

/** The asset layer: answers every GET with the whole file and ignores Range, as Cloudflare's does. */
const assets = (seen: Request[] = []) => ({
  fetch: async (request: Request) => {
    seen.push(request)
    const path = new URL(request.url).pathname
    if (path === '/landing/') return new Response('<h1>Vitaquack</h1>', { headers: { 'content-type': 'text/html' } })
    if (path === '/landing/shop/') return new Response('<h1>Shop</h1>', { headers: { 'content-type': 'text/html' } })
    if (path !== '/media/f2.mp4') return new Response('not found', { status: 404 })
    return new Response(film, { headers: { 'content-type': 'video/mp4', etag: '"f2"' } })
  },
})

const refuse = {
  fetch: async () => {
    throw new Error('Unexpected request')
  },
}

/** The website Worker, recording the method and path of everything the edge forwards to it. */
const recordingWebsite = () => {
  const paths: string[] = []
  const website = {
    fetch: async (request: Request) => {
      paths.push(`${request.method} ${new URL(request.url).pathname}`)
      return new Response('website')
    },
  }
  return { paths, website }
}

const get = (headers: Record<string, string> = {}, method = 'GET') =>
  new Request('https://vitaquack.com/media/f2.mp4', { method, headers })

describe('the landing through the edge', () => {
  test('only /media/* is the landing media, and only /landing… its asset path', () => {
    expect(isMediaPath('/media/f2.mp4')).toBe(true)
    for (const path of ['/', '/media', '/app/media/x', '/api/media/x', '/sim/media/x'])
      expect(isMediaPath(path)).toBe(false)
    for (const path of ['/landing', '/landing/', '/landing/index.html']) expect(isLandingAssetPath(path)).toBe(true)
    for (const path of ['/', '/landings', '/app/landing']) expect(isLandingAssetPath(path)).toBe(false)
  })

  test('answers GET / with the landing asset, keeping conditional headers for a 304', async () => {
    const seen: Request[] = []
    const request = new Request('https://vitaquack.com/', { headers: { 'if-none-match': '"x"' } })
    const response = await edge.fetch(request, { API: refuse, WEBSITE: refuse, ASSETS: assets(seen) })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<h1>Vitaquack</h1>')
    expect(
      seen.map((asked) => [asked.method, new URL(asked.url).pathname, asked.headers.get('if-none-match')]),
    ).toEqual([['GET', '/landing/', '"x"']])
  })

  test('redirects the landing asset path to / and leaves other methods on / and /app to the website', async () => {
    const redirect = await edge.fetch(new Request('https://vitaquack.com/landing/'), {
      API: refuse,
      WEBSITE: refuse,
      ASSETS: refuse,
    })
    expect(redirect.status).toBe(301)
    expect(redirect.headers.get('location')).toBe('https://vitaquack.com/')
    const { paths, website } = recordingWebsite()
    await edge.fetch(new Request('https://vitaquack.com/', { method: 'POST' }), {
      API: refuse,
      WEBSITE: website,
      ASSETS: refuse,
    })
    await edge.fetch(new Request('https://vitaquack.com/app'), { API: refuse, WEBSITE: website, ASSETS: refuse })
    await edge.fetch(new Request('https://vitaquack.com/app/wallet/approvals/a1'), {
      API: refuse,
      WEBSITE: website,
      ASSETS: refuse,
    })
    expect(paths).toEqual(['POST /', 'GET /app', 'GET /app/wallet/approvals/a1'])
  })

  test('answers GET /shop/ with the shop asset, sends /shop to /shop/ and leaves writes to the website', async () => {
    const seen: Request[] = []
    const env = { API: refuse, WEBSITE: refuse, ASSETS: assets(seen) }
    const shop = await edge.fetch(
      new Request('https://vitaquack.com/shop/', { headers: { 'if-none-match': '"s"' } }),
      env,
    )
    expect(shop.status).toBe(200)
    expect(await shop.text()).toBe('<h1>Shop</h1>')
    expect(seen.map((asked) => [new URL(asked.url).pathname, asked.headers.get('if-none-match')])).toEqual([
      ['/landing/shop/', '"s"'],
    ])
    const bare = await edge.fetch(new Request('https://vitaquack.com/shop'), env)
    expect(bare.status).toBe(301)
    expect(bare.headers.get('location')).toBe('https://vitaquack.com/shop/')
    const { paths, website } = recordingWebsite()
    await edge.fetch(new Request('https://vitaquack.com/shop/', { method: 'POST' }), { ...env, WEBSITE: website })
    await edge.fetch(new Request('https://vitaquack.com/shops'), { ...env, WEBSITE: website })
    expect(paths).toEqual(['POST /shop/', 'GET /shops'])
  })

  test.each([
    ['bytes=0-9', { start: 0, end: 9 }],
    ['bytes=90-', { start: 90, end: 99 }],
    ['bytes=-10', { start: 90, end: 99 }],
    ['bytes=-500', { start: 0, end: 99 }],
    ['bytes=95-200', { start: 95, end: 99 }],
    ['bytes=100-', 'unsatisfiable'],
    ['bytes=-0', 'unsatisfiable'],
    ['bytes=9-0', 'unsatisfiable'],
    ['bytes=-', undefined],
    ['bytes=0-1,5-6', undefined],
    ['items=0-1', undefined],
  ] as const)('reads %s of a 100-byte file', (header, expected) => expect(byteRange(header, 100)).toEqual(expected))

  test('answers a range with a 206 slice and its Content-Range, the probe Safari sends first', async () => {
    const response = await serveMedia(get({ range: 'bytes=0-1' }), assets())
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-1/100')
    expect(response.headers.get('content-length')).toBe('2')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1])
  })

  test('answers no range with the whole file and advertises ranges', async () => {
    const response = await serveMedia(get(), assets())
    expect(response.status).toBe(200)
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400, stale-while-revalidate=604800')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(film)
  })

  test('answers a range past the end with 416 and the size', async () => {
    const response = await serveMedia(get({ range: 'bytes=100-' }), assets())
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */100')
    expect(await response.text()).toBe('')
  })

  test('answers HEAD with the range headers and no body, and asks the assets with a plain GET', async () => {
    const seen: Request[] = []
    const response = await serveMedia(get({ range: 'bytes=10-19' }, 'HEAD'), assets(seen))
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 10-19/100')
    expect(await response.text()).toBe('')
    expect(seen.map((request) => [request.method, request.headers.has('range')])).toEqual([['GET', false]])
  })

  test('passes a missing file through and refuses writes', async () => {
    const missing = await serveMedia(new Request('https://vitaquack.com/media/nope.mp4'), assets())
    expect(missing.status).toBe(404)
    const post = await serveMedia(get({}, 'POST'), assets())
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
  })

  test('the edge sends /media/* to its assets, never to the API or the website', async () => {
    const response = await edge.fetch(get({ range: 'bytes=0-1' }), { API: refuse, WEBSITE: refuse, ASSETS: assets() })
    expect(response.status).toBe(206)
  })
})
