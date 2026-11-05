import { Effect } from 'effect'
import * as Server from 'foldkit/experimental/server'
import { localeCookie, parseLocale } from '../Locale.ts'

/** A cookie preference write requires a same-origin POST, and never accepts a return URL. */
export const saveLocale = (request: Request) =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    if (request.method !== 'POST')
      return Server.Responded(new Response(null, { status: 405, headers: { allow: 'POST' } }))
    if (request.headers.get('origin') !== url.origin) return Server.Responded(new Response(null, { status: 403 }))
    if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
      return Server.Responded(new Response(null, { status: 415 }))
    }
    const body = yield* Effect.tryPromise(() => request.text()).pipe(Effect.orElseSucceed(() => ''))
    if (body.length > 64) return Server.Responded(new Response(null, { status: 413 }))
    const locale = parseLocale(new URLSearchParams(body).get('locale'))
    if (locale === undefined) return Server.Responded(new Response(null, { status: 400 }))
    return Server.Responded(
      new Response(null, {
        status: 204,
        headers: { 'set-cookie': localeCookie(locale, url), 'cache-control': 'no-store' },
      }),
    )
  })
