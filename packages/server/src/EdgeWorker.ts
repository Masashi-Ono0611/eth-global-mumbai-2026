type FetchService = {
  readonly fetch: (request: Request) => Promise<Response>
}

export type EdgeEnvironment = {
  readonly API: FetchService
  readonly WEBSITE: FetchService
}

const apiNamespaces = ['/api', '/rpc', '/mcp', '/.well-known', '/out', '/cdn'] as const

export const isApiPath = (path: string): boolean =>
  apiNamespaces.some((namespace) => path === namespace || path.startsWith(`${namespace}/`))

/** Native transport boundary. Reserved telemetry fields belong to the edge;
 * callers cannot choose log labels or smuggle payloads through correlation IDs.
 * Request bodies and responses keep their native streaming semantics. */
export default {
  fetch(request: Request, env: EdgeEnvironment): Promise<Response> {
    const headers = new Headers(request.headers)
    for (const name of request.headers.keys()) {
      if (name.startsWith('x-app-')) headers.delete(name)
    }
    headers.set('x-app-correlation-id', crypto.randomUUID())
    const forwarded = new Request(request, { headers })
    return (isApiPath(new URL(request.url).pathname) ? env.API : env.WEBSITE).fetch(forwarded)
  },
}
