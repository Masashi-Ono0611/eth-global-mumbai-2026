/**
 * The till's Worker: the built app from static assets, and /api/* forwarded to the app's Worker so the browser stays
 * same-origin (no CORS on the API). Only the merchant routes the till uses are forwarded; cookies never are.
 */
interface Env {
  readonly ASSETS: Fetcher
  /** The app's public origin (its edge Worker), e.g. https://ethmumbai-edge-main-….workers.dev */
  readonly APP_ORIGIN: string
}

const forwarded = [/^\/api\/merchants\/[a-z0-9-]+\/(items|invoices|gate-key)$/, /^\/api\/invoices\/[a-z0-9]+\/status$/]

export default {
  fetch: async (request: Request, env: Env): Promise<Response> => {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    if (!forwarded.some((route) => route.test(url.pathname)))
      return Response.json({ error: 'not a till route' }, { status: 404 })
    const target = new URL(url.pathname + url.search, env.APP_ORIGIN)
    const headers = new Headers({ accept: 'application/json' })
    const contentType = request.headers.get('content-type')
    if (contentType !== null) headers.set('content-type', contentType)
    const answer = await fetch(target, { method: request.method, headers, body: request.body })
    return new Response(answer.body, {
      status: answer.status,
      headers: {
        'content-type': answer.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    })
  },
}
