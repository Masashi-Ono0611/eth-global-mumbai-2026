import { Effect, Fiber, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { describe, expect, test } from 'vitest'
import { catalogVersion } from '@ethmumbai/i18n'
import { Clipboard } from '../src/Clipboard.ts'
import { fixturePasskeysLayer } from '../src/Passkey.ts'
import { preloadLink } from '../src/Preloads.ts'
import { routeFromPathname } from '../src/route.ts'
import { init } from '../src/update.ts'

/** A Worker that records every request and never answers: what a page starts on load is exactly what it records. */
const recording = (requests: Array<string>) =>
  Layer.mergeAll(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request, url) => {
        requests.push(`${request.method} ${url.pathname}${url.search}`)
        return Effect.never
      }).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl('https://app.test'))),
    ),
    fixturePasskeysLayer,
    Layer.succeed(Clipboard, Clipboard.of({ copy: () => Effect.void })),
  )

/** The paths a route's `Link` header asks the browser to preload, in order. */
const preloadsFor = (pathname: string) =>
  (preloadLink(routeFromPathname(pathname)) ?? '')
    .split(', ')
    .filter((entry) => entry !== '')
    .map((entry) => {
      expect(entry).toMatch(/^<\/api\/[^>]+>; rel=preload; as=fetch; crossorigin$/)
      return entry.slice(1, entry.indexOf('>'))
    })

/** The requests a page's start commands send before any answer arrives. */
const startRequests = async (pathname: string) => {
  const requests: Array<string> = []
  const commands = init({ locale: 'en', catalogVersion, timeZone: 'UTC', referenceTime: 0, pathname }).commands ?? []
  await Effect.runPromise(
    Effect.gen(function* () {
      const fibers = yield* Effect.forEach(commands, (command) => Effect.forkChild(command.effect))
      yield* Effect.sleep('50 millis')
      yield* Fiber.interruptAll(fibers)
    }).pipe(Effect.provide(recording(requests))),
  )
  return requests.toSorted()
}

const pages = [
  '/app/',
  '/app/wallet',
  '/app/welcome',
  '/app/wallet/robots',
  '/app/robot/robot_1',
  '/app/wallet/approvals/approval_1',
  '/app/wallet/episodes',
  '/app/robot/robot_1/episodes',
  '/app/wallet/episodes/episode_1',
  '/app/merchant',
  '/app/gate/duck-cafe',
]

describe('response preloads', () => {
  test.each(pages)('%s preloads exactly the reads its start commands send', async (pathname) => {
    const requests = await startRequests(pathname)
    const gets = requests.filter((request) => request.startsWith('GET ')).map((request) => request.slice(4))
    expect(gets.length).toBeGreaterThan(0)
    expect(preloadsFor(pathname).toSorted()).toEqual(gets)
  })

  test('a page that does not exist preloads nothing', () => {
    expect(preloadLink(routeFromPathname('/app/nowhere'))).toBeUndefined()
  })

  test('an id that is not plainly an id gets no preload of its own', () => {
    expect(preloadsFor('/app/wallet/episodes/a%3E%2C%20b')).toEqual(['/api/auth/session'])
  })
})
