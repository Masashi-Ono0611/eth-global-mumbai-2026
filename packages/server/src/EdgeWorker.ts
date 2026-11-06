import {
  isLandingAssetPath,
  isMediaPath,
  isSubpagePath,
  landingHome,
  serveLanding,
  serveMedia,
  serveSubpage,
} from './EdgeLanding.ts'

type FetchService = {
  readonly fetch: (request: Request) => Promise<Response>
}

export type EdgeEnvironment = {
  readonly API: FetchService
  readonly WEBSITE: FetchService
  /** The edge's own static assets (apps/web/dist/client): Alchemy binds it when `assets` is configured. */
  readonly ASSETS: FetchService
}

const apiNamespaces = ['/api', '/rpc', '/mcp', '/.well-known', '/out', '/cdn'] as const

export const isApiPath = (path: string): boolean =>
  apiNamespaces.some((namespace) => path === namespace || path.startsWith(`${namespace}/`))

/** Native transport boundary. Reserved telemetry fields belong to the edge;
 * callers cannot choose log labels or smuggle payloads through correlation IDs.
 * Request bodies and responses keep their native streaming semantics.
 * Files of the build (the app's under /app, the simulator under /sim) never reach this Worker: the asset layer answers
 * them first. The landing is the edge's (EdgeLanding.ts): `GET /` is its asset, `GET /shop/` and `GET /pitch/` its
 * subpages', `/media/*` their files with byte ranges,
 * and its asset path redirects to `/`. Every other path goes to the API or the website with its full URL. */
export default {
  fetch(request: Request, env: EdgeEnvironment): Promise<Response> {
    const path = new URL(request.url).pathname
    if (isMediaPath(path)) return serveMedia(request, env.ASSETS)
    if (isLandingAssetPath(path)) return Promise.resolve(landingHome(request))
    const readable = request.method === 'GET' || request.method === 'HEAD'
    if (path === '/' && readable) return serveLanding(request, env.ASSETS)
    if (isSubpagePath(path) && readable) return serveSubpage(request, env.ASSETS)
    const headers = new Headers(request.headers)
    for (const name of request.headers.keys()) {
      if (name.startsWith('x-app-')) headers.delete(name)
    }
    headers.set('x-app-correlation-id', crypto.randomUUID())
    const forwarded = new Request(request, { headers })
    return (isApiPath(path) ? env.API : env.WEBSITE).fetch(forwarded)
  },
}
