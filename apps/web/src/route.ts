import { Option, Schema, pipe } from 'effect'
import { defineRouteUnion, literal, mapTo, oneOf, parseUrlWithFallback, root } from 'foldkit/route'

/** Every page of the website. A route both parses its URL and, called as a function, builds its link. */
export const AppRoute = defineRouteUnion({
  Home: {},
  Login: {},
  Account: {},
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const homeRouter = pipe(root, mapTo(AppRoute.Home))
export const loginRouter = pipe(literal('login'), mapTo(AppRoute.Login))
const accountRouter = pipe(literal('account'), mapTo(AppRoute.Account))

const parser = oneOf(loginRouter, accountRouter, homeRouter)

/** The page for a request path; unknown paths are NotFound (the server answers those with 404). */
export const routeFromPathname = (pathname: string): AppRoute =>
  parseUrlWithFallback(
    parser,
    AppRoute.NotFound,
  )({ protocol: 'https:', host: 'app', port: Option.none(), pathname, search: Option.none(), hash: Option.none() })
