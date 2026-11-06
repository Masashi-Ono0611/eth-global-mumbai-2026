import { Clock, Effect } from 'effect'
import { layer as cloudflareTracer } from '@alchemy.run/cloudflare/Workers/CloudflareTracer'
import * as Server from 'foldkit/experimental/server'
import { catalogVersion } from '@ethmumbai/i18n'
import { makeObservabilityBase, metadataFromHeaders, withObservability } from '@ethmumbai/observability'
import { Flags } from './model.ts'
import { AppRoute, routeFromPathname } from './route.ts'
import { init } from './update.ts'
import { view } from './View.ts'

export const application = { Flags, init, view }

const renderApplication = (
  request: Request,
  options: { readonly buildId?: string; readonly runtimeId?: string } = {},
) =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    // A preflight reaches the entry too; the app allows no cross-origin calls, so it only reports the methods.
    if (request.method === 'OPTIONS') {
      return Server.Responded(new Response(null, { status: 204, headers: { allow: Server.HOST_METHOD_ANSWERS.allow } }))
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return Server.Responded(new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } }))
    }
    const flags: Flags = {
      locale: 'en',
      catalogVersion,
      timeZone: 'UTC',
      referenceTime: yield* Clock.currentTimeMillis,
      pathname: url.pathname,
    }
    const rendered = yield* Server.renderToString(application, { ...options, flags })
    return Server.Rendered(rendered, {
      status: AppRoute.guards.NotFound(routeFromPathname(url.pathname)) ? 404 : 200,
      headers: {
        'cache-control': 'private, no-store',
        'content-language': flags.locale,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      },
    })
  })

export const renderRequest = (
  request: Request,
  options: { readonly buildId?: string; readonly runtimeId?: string } = {},
) =>
  Effect.gen(function* () {
    const identity = yield* makeObservabilityBase({
      environment: import.meta.env.VITE_APP_ENV ?? 'local',
      release: import.meta.env.VITE_APP_RELEASE ?? 'local-build',
      component: 'web',
    }).pipe(Effect.orDie)
    return yield* renderApplication(request, options).pipe(
      withObservability('app.web.render', metadataFromHeaders(identity, request.headers)),
    )
  })

export const renderPage: Server.EntryModule['renderPage'] = (request) =>
  Effect.runPromise(renderRequest(request).pipe(Effect.provide(cloudflareTracer)))

export const renderDocument: Server.DocumentRenderer = (renderedApplication, assets) =>
  Server.renderDocument(renderedApplication, assets, {
    head:
      '<meta name="theme-color" content="#e7f1f6"><link rel="icon" href="/favicon.svg">' +
      '<link rel="preload" href="/fonts/mukta-400-latin.woff2" as="font" type="font/woff2" crossorigin>' +
      '<link rel="preload" href="/fonts/baloo2-latin.woff2" as="font" type="font/woff2" crossorigin>',
  }).replace(
    'content="width=device-width, initial-scale=1.0"',
    'content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"',
  )
