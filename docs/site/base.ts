/**
 * The site under a path prefix (Kris, 6 Nov): on vitaquack.com it lives at `/plan/…` (a zone route sends
 * `vitaquack.com/plan*` here), while its workers.dev URL keeps serving it at the root. Pages keep their root-absolute
 * links (`/lib/…`, `/architecture/`); under the prefix this module strips `/plan` from the request and puts it back on
 * every root-absolute URL in HTML attributes and redirects, and marks `<html data-base="/plan">` so browser scripts
 * (the comments client) can build their own URLs.
 */
const BASE = '/plan'
const PREFIXED_HOSTS: ReadonlySet<string> = new Set(['vitaquack.com'])

/** The request as the site sees it (prefix removed), or null when this host serves the site at its root. */
export const unprefixed = (request: Request): Request | null => {
  const url = new URL(request.url)
  if (!PREFIXED_HOSTS.has(url.hostname)) return null
  const inner = new URL(url)
  inner.pathname = url.pathname === BASE ? '/' : url.pathname.slice(BASE.length) || '/'
  return new Request(inner, request)
}

/** `/x` → `/plan/x`; anything else (relative, `//host`, `https:`, `#`, `mailto:`) unchanged. */
const withBase = (value: string) => (value.startsWith('/') && !value.startsWith('//') ? `${BASE}${value}` : value)

const URL_ATTRIBUTES = ['href', 'src', 'action', 'poster', 'data-src'] as const

/** `srcset="/a.webp 1x, /b.webp 2x"`: each candidate's URL gets the prefix. */
const withBaseSrcset = (srcset: string) =>
  srcset
    .split(',')
    .map((candidate) => candidate.trim().replace(/^(\S+)/, (link) => withBase(link)))
    .join(', ')

/** The site's response with the prefix put back on redirects and on root-absolute URLs in HTML. */
export const prefixed = (response: Response): Response => {
  const location = response.headers.get('location')
  if (location !== null && location.startsWith('/') && !location.startsWith('//')) {
    const headers = new Headers(response.headers)
    headers.set('location', withBase(location))
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) return response
  return new HTMLRewriter()
    .on('html', {
      element: (element) => {
        element.setAttribute('data-base', BASE)
      },
    })
    .on('[href], [src], [action], [poster], [data-src], [srcset]', {
      element: (element) => {
        for (const name of URL_ATTRIBUTES) {
          const value = element.getAttribute(name)
          if (value !== null) element.setAttribute(name, withBase(value))
        }
        const srcset = element.getAttribute('srcset')
        if (srcset !== null) element.setAttribute('srcset', withBaseSrcset(srcset))
      },
    })
    .transform(response)
}
