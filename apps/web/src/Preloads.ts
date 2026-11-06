import { AppRoute } from './route.ts'

/**
 * The API reads each page starts on load, so the server's response can name them in a `Link: rel=preload` header and
 * the browser fetches them while it downloads and boots the app (about a second on a phone) instead of after. The
 * app's own fetch then takes the preloaded response (`FetchHttpClient`: same origin, cors mode, same-origin
 * credentials, which `crossorigin` matches; checked in Chromium, including for `no-store` answers). Only GETs, never
 * anything with an effect. test/Preloads.test.ts runs every route's start commands and requires this list to be
 * exactly what they request, so the two cannot drift.
 */
const SESSION = '/api/auth/session'

/** An id from the URL goes into the header only when it is plainly an id; anything else just loses its preload. */
const plainId = /^[A-Za-z0-9_-]+$/
const withId = (id: string, paths: (id: string) => ReadonlyArray<string>): ReadonlyArray<string> =>
  plainId.test(id) ? paths(id) : []

const episodesOf = (robotId: string) => `/api/wallet/episodes?robotId=${robotId}`

const pageReads = (route: AppRoute): ReadonlyArray<string> =>
  AppRoute.match(route, {
    Home: () => [],
    NotFound: () => [],
    Wallet: () => ['/api/wallet', '/api/wallet/activity', '/api/robots', '/api/wallet/episodes', '/api/telegram'],
    Welcome: () => ['/api/wallet', '/api/telegram'],
    Robots: () => ['/api/robots', '/api/merchants/duck-cafe/items', '/api/wallet'],
    RobotConsole: ({ robotId }) =>
      withId(robotId, (id) => [
        `/api/robots/${id}`,
        '/api/merchants/duck-cafe/items',
        '/api/wallet/activity',
        episodesOf(id),
      ]),
    Approval: ({ approvalId }) => withId(approvalId, (id) => [`/api/approvals/${id}`]),
    Episodes: () => ['/api/wallet/episodes', '/api/robots'],
    RobotEpisodes: ({ robotId }) => withId(robotId, (id) => [episodesOf(id), '/api/robots']),
    Episode: ({ episodeId }) => withId(episodeId, (id) => [`/api/wallet/episodes/${id}`]),
    Merchant: () => [],
    Gate: ({ merchantId }) => withId(merchantId, (id) => [`/api/merchants/${id}/gate-key`]),
  })

/** Every page reads the session on start; a page that does not exist reads nothing worth starting early. */
const preloadsFor = (route: AppRoute): ReadonlyArray<string> =>
  AppRoute.guards.NotFound(route) ? [] : [SESSION, ...pageReads(route)]

/** The `Link` header value for a route's preloads, or `undefined` when there are none. */
export const preloadLink = (route: AppRoute): string | undefined => {
  const paths = preloadsFor(route)
  return paths.length === 0
    ? undefined
    : paths.map((path) => `<${path}>; rel=preload; as=fetch; crossorigin`).join(', ')
}
