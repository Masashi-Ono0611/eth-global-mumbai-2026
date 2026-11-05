import { Clock, Effect } from 'effect'
import { layer as cloudflareTracer } from '@alchemy.run/cloudflare/Workers/CloudflareTracer'
import * as Server from 'foldkit/experimental/server'
import { catalogVersion } from '@styld/i18n'
import { makeObservabilityBase, metadataFromHeaders, withObservability } from '@styld/observability'
import { Flags, init } from './App.ts'
import { localeEndpoint, requestLocale } from './Locale.ts'
import { view } from './View.ts'
import { saveLocale } from './server/LocalePreference.ts'

export const application = { Flags, init, view }

const renderApplication = (
  request: Request,
  options: { readonly buildId?: string; readonly runtimeId?: string } = {},
) =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    if (url.pathname === localeEndpoint) return yield* saveLocale(request)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return Server.Responded(new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } }))
    }
    const flags: Flags = {
      locale: requestLocale(request),
      catalogVersion,
      timeZone: 'UTC',
      referenceTime: yield* Clock.currentTimeMillis,
      pathname: url.pathname,
    }
    const rendered = yield* Server.renderToString(application, { ...options, flags })
    return Server.Rendered(rendered, {
      status: ['/', '/login', '/account'].includes(url.pathname) ? 200 : 404,
      headers: {
        'cache-control': 'private, no-store',
        vary: 'Accept-Language, Cookie',
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
      environment: import.meta.env.VITE_STYLD_ENV ?? 'local',
      release: import.meta.env.VITE_STYLD_RELEASE ?? 'local-build',
      component: 'web',
    }).pipe(Effect.orDie)
    return yield* renderApplication(request, options).pipe(
      withObservability('styld.web.render', metadataFromHeaders(identity, request.headers)),
    )
  })

export const renderPage: Server.EntryModule['renderPage'] = (request) =>
  Effect.runPromise(renderRequest(request).pipe(Effect.provide(cloudflareTracer)))

export const renderDocument: Server.DocumentRenderer = (renderedApplication, assets) =>
  Server.renderDocument(renderedApplication, assets, {
    head: '<meta name="theme-color" content="#efede7"><link rel="icon" href="/favicon.svg">',
  }).replace(
    'content="width=device-width, initial-scale=1.0"',
    'content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"',
  )
