import { Option, Schema, pipe } from 'effect'
import { defineRouteUnion, literal, mapTo, oneOf, parseUrlWithFallback, root, slash, string } from 'foldkit/route'

/** Every page of the website. A route both parses its URL and, called as a function, builds its link. */
export const AppRoute = defineRouteUnion({
  Home: {},
  Wallet: {},
  Robots: {},
  RobotConsole: { robotId: Schema.String },
  Approval: { approvalId: Schema.String },
  Merchant: {},
  Gate: { merchantId: Schema.String },
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const homeRouter = pipe(root, mapTo(AppRoute.Home))
export const walletRouter = pipe(literal('wallet'), mapTo(AppRoute.Wallet))
export const robotsRouter = pipe(literal('wallet'), slash(literal('robots')), mapTo(AppRoute.Robots))
export const robotConsoleRouter = pipe(literal('robot'), slash(string('robotId')), mapTo(AppRoute.RobotConsole))

const approvalRouter = pipe(
  literal('wallet'),
  slash(literal('approvals')),
  slash(string('approvalId')),
  mapTo(AppRoute.Approval),
)
const merchantRouter = pipe(literal('merchant'), mapTo(AppRoute.Merchant))
export const gateRouter = pipe(literal('gate'), slash(string('merchantId')), mapTo(AppRoute.Gate))

const parser = oneOf(
  robotsRouter,
  approvalRouter,
  walletRouter,
  robotConsoleRouter,
  merchantRouter,
  gateRouter,
  homeRouter,
)

/** The page for a request path; unknown paths are NotFound (the server answers those with 404). */
export const routeFromPathname = (pathname: string): AppRoute =>
  parseUrlWithFallback(
    parser,
    AppRoute.NotFound,
  )({ protocol: 'https:', host: 'app', port: Option.none(), pathname, search: Option.none(), hash: Option.none() })
