type FetchService = {
  readonly fetch: (request: Request) => Promise<Response>
}

/**
 * The landing page (docs/site/pitch, copied by tools/copy-landing.ts) is the edge's static asset `/landing/`, because
 * Foldkit's build refuses a root index.html it did not prerender. The edge answers `/` with it and sends the asset's own
 * path back to `/`, so the page has one address. Its files are referenced as relative `media/<name>`, which from `/`
 * resolves to `/media/*`.
 */
const LANDING_ASSET = '/landing/'

/** `/landing` and everything under it: run through the edge (`runWorkerFirst`) only to be redirected to `/`. */
export const isLandingAssetPath = (path: string): boolean => path === '/landing' || path.startsWith(LANDING_ASSET)

/** The landing page's films and photos. */
export const isMediaPath = (path: string): boolean => path.startsWith('/media/')

const readable = (method: string) => method === 'GET' || method === 'HEAD'

/** `GET /` and `HEAD /`: the landing asset, with the caller's conditional headers (so a revalidation can be a 304). */
export const serveLanding = (request: Request, assets: FetchService): Promise<Response> =>
  assets.fetch(new Request(new URL(LANDING_ASSET, request.url), { method: request.method, headers: request.headers }))

/** The landing's asset path is not an address of its own: 301 to `/`. */
export const landingHome = (request: Request): Response =>
  new Response(null, { status: 301, headers: { location: new URL('/', request.url).toString() } })

type ByteRange = { readonly start: number; readonly end: number }

/**
 * The single range a `Range: bytes=…` header asks for within `size` bytes: `undefined` when the header is not one
 * single byte range (the whole file is the answer), `'unsatisfiable'` when it starts past the end (416).
 */
export const byteRange = (header: string, size: number): ByteRange | 'unsatisfiable' | undefined => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return undefined
  const [, from = '', to = ''] = match
  if (from === '' && to === '') return undefined
  // `bytes=-N` is the last N bytes; an open end runs to the last byte.
  const start = from === '' ? Math.max(0, size - Number(to)) : Number(from)
  const end = from === '' || to === '' ? size - 1 : Math.min(Number(to), size - 1)
  return start > end || start >= size ? 'unsatisfiable' : { start, end }
}

/**
 * Serves `/media/*` from the edge's own static assets with byte ranges. The asset layer answers a Range request with
 * the whole file, and Safari on iPhone will not play an mp4 without a 206, so these paths run through the edge first
 * (`runWorkerFirst` in alchemy.run.ts), as the scratch site's `/pitch/media/*` do (docs/site/worker.ts). Every file
 * is under 1 MB, so a slice is cut from the whole asset in memory. HEAD answers the same headers without a body.
 */
export const serveMedia = async (request: Request, assets: FetchService): Promise<Response> => {
  if (!readable(request.method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  const asset = await assets.fetch(new Request(request.url, { method: 'GET' }))
  if (!asset.ok) return asset
  const headers = new Headers(asset.headers)
  headers.set('accept-ranges', 'bytes')
  headers.set('cache-control', 'public, max-age=3600')
  const body = (content: BodyInit | null) => (request.method === 'HEAD' ? null : content)
  const header = request.headers.get('range')
  if (header === null) return new Response(body(asset.body), { status: 200, headers })
  const bytes = new Uint8Array(await asset.arrayBuffer())
  const range = byteRange(header, bytes.byteLength)
  headers.set('content-length', String(bytes.byteLength))
  if (range === undefined) return new Response(body(bytes), { status: 200, headers })
  if (range === 'unsatisfiable') {
    headers.delete('content-length')
    headers.set('content-range', `bytes */${bytes.byteLength}`)
    return new Response(null, { status: 416, headers })
  }
  headers.set('content-range', `bytes ${range.start}-${range.end}/${bytes.byteLength}`)
  headers.set('content-length', String(range.end - range.start + 1))
  return new Response(body(bytes.slice(range.start, range.end + 1)), { status: 206, headers })
}
