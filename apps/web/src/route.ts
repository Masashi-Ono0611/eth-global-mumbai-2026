import { APP_BASE } from '@ethmumbai/protocol/Pages'
import { Option, Schema, pipe } from 'effect'
import { defineRouteUnion, literal, mapTo, oneOf, parseUrlWithFallback, slash, string } from 'foldkit/route'

/** Every page of the website. A route both parses its URL and, called as a function, builds its link. */
export const AppRoute = defineRouteUnion({
  Home: {},
  Wallet: {},
  Robots: {},
  RobotConsole: { robotId: Schema.String },
  Approval: { approvalId: Schema.String },
  Episodes: {},
  RobotEpisodes: { robotId: Schema.String },
  Episode: { episodeId: Schema.String },
  Merchant: {},
  Gate: { merchantId: Schema.String },
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

/** Every page lives under /app (vitaquack.com: "/" is the static landing page, /api stays where it is). */
const app = literal(APP_BASE.slice(1))

export const homeRouter = pipe(app, mapTo(AppRoute.Home))
export const walletRouter = pipe(app, slash(literal('wallet')), mapTo(AppRoute.Wallet))
export const robotsRouter = pipe(app, slash(literal('wallet')), slash(literal('robots')), mapTo(AppRoute.Robots))
export const robotConsoleRouter = pipe(
  app,
  slash(literal('robot')),
  slash(string('robotId')),
  mapTo(AppRoute.RobotConsole),
)
export const episodesRouter = pipe(app, slash(literal('wallet')), slash(literal('episodes')), mapTo(AppRoute.Episodes))
export const episodeRouter = pipe(
  app,
  slash(literal('wallet')),
  slash(literal('episodes')),
  slash(string('episodeId')),
  mapTo(AppRoute.Episode),
)
export const robotEpisodesRouter = pipe(
  app,
  slash(literal('robot')),
  slash(string('robotId')),
  slash(literal('episodes')),
  mapTo(AppRoute.RobotEpisodes),
)

const approvalRouter = pipe(
  app,
  slash(literal('wallet')),
  slash(literal('approvals')),
  slash(string('approvalId')),
  mapTo(AppRoute.Approval),
)
const merchantRouter = pipe(app, slash(literal('merchant')), mapTo(AppRoute.Merchant))
export const gateRouter = pipe(app, slash(literal('gate')), slash(string('merchantId')), mapTo(AppRoute.Gate))

const parser = oneOf(
  robotsRouter,
  approvalRouter,
  episodeRouter,
  episodesRouter,
  robotEpisodesRouter,
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
