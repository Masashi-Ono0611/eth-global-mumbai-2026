import { format, type Locale } from '@ethmumbai/i18n'
import { Option } from 'effect'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { Message } from './message.ts'
import { AuthState, type Model } from './model.ts'
import { homeView } from './pages/Home.ts'
import * as Approval from './pages/Approval.ts'
import { episodeView } from './pages/EpisodeView.ts'
import * as Episodes from './pages/Episodes.ts'
import * as Gate from './pages/gate/Gate.ts'
import * as Merchant from './pages/merchant/Merchant.ts'
import { robotConsoleView } from './pages/RobotConsoleView.ts'
import { robotsView } from './pages/RobotsView.ts'
import * as Wallet from './pages/Wallet.ts'
import { AppRoute, episodesRouter, homeRouter, robotsRouter, walletRouter } from './route.ts'
/** Links to the owner pages once the session is known. */
const ownerNav = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  return AuthState.guards.SignedIn(model.auth)
    ? h.nav(
        [h.Class('owner-nav')],
        [
          h.a([h.Href(walletRouter())], [format(locale, 'wallet.title', {})]),
          h.a([h.Href(robotsRouter())], [format(locale, 'robots.title', {})]),
          h.a([h.Href(episodesRouter())], [format(locale, 'episodes.title', {})]),
        ],
      )
    : h.empty
}

const notFoundView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.main(
    [h.Id('main'), h.Class('intro')],
    [
      h.h1([], [format(locale, 'common.notFoundTitle', {})]),
      h.p([], [format(locale, 'common.notFoundDescription', {})]),
      h.a([h.Href(homeRouter())], [format(locale, 'common.goHome', {})]),
    ],
  )

type Page = { readonly title: string; readonly body: Html }

/** An owner, merchant or gate page: its Submodel when the route created one, otherwise not found. */
const childPage = <A>(
  model: Model,
  title: string,
  maybeChild: Option.Option<A>,
  embed: (child: A) => Html,
  h: HtmlBuilder<Message>,
): Page => ({
  title,
  body: Option.match(maybeChild, { onNone: () => notFoundView(model.context.locale, h), onSome: embed }),
})

const walletPage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'wallet.title', {}),
    model.maybeWallet,
    (wallet) =>
      h.submodel({
        slotId: 'wallet',
        model: wallet,
        view: Wallet.view,
        viewInputs: { locale: model.context.locale },
        toParentMessage: (message) => Message.GotWalletMessage({ message }),
      }),
    h,
  )

const robotsPage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'robots.title', {}),
    model.maybeRobots,
    (robots) =>
      h.submodel({
        slotId: 'robots',
        model: robots,
        view: robotsView,
        viewInputs: { locale: model.context.locale },
        toParentMessage: (message) => Message.GotRobotsMessage({ message }),
      }),
    h,
  )

const consolePage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'console.title', {}),
    model.maybeConsole,
    (robotConsole) =>
      h.submodel({
        slotId: 'robot-console',
        model: robotConsole,
        view: robotConsoleView,
        viewInputs: { locale: model.context.locale },
        toParentMessage: (message) => Message.GotConsoleMessage({ message }),
      }),
    h,
  )

const approvalPage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'approval.title', {}),
    model.maybeApproval,
    (approval) =>
      h.submodel({
        slotId: 'approval',
        model: approval,
        view: Approval.view,
        viewInputs: { locale: model.context.locale },
        toParentMessage: (message) => Message.GotApprovalMessage({ message }),
      }),
    h,
  )

/** The audit pages render times, so they also get the page's time zone. */
const auditInputs = (model: Model) => ({ locale: model.context.locale, timeZone: model.context.timeZone })

const episodesPage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'episodes.title', {}),
    model.maybeEpisodes,
    (episodes) =>
      h.submodel({
        slotId: 'episodes',
        model: episodes,
        view: Episodes.view,
        viewInputs: auditInputs(model),
        toParentMessage: (message) => Message.GotEpisodesMessage({ message }),
      }),
    h,
  )

const episodePage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'episodes.title', {}),
    model.maybeEpisode,
    (episode) =>
      h.submodel({
        slotId: 'episode',
        model: episode,
        view: episodeView,
        viewInputs: auditInputs(model),
        toParentMessage: (message) => Message.GotEpisodeMessage({ message }),
      }),
    h,
  )

const merchantPage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'merchant.pageTitle', {}),
    model.maybeMerchant,
    (merchant) =>
      h.submodel({
        slotId: 'merchant',
        model: merchant,
        view: Merchant.view,
        viewInputs: { locale: model.context.locale },
        toParentMessage: (message) => Message.GotMerchantMessage({ message }),
      }),
    h,
  )

const gatePage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'gate.title', {}),
    model.maybeGate,
    (gate) =>
      h.submodel({
        slotId: 'gate',
        model: gate,
        view: Gate.view,
        viewInputs: { locale: model.context.locale },
        toParentMessage: (message) => Message.GotGateMessage({ message }),
      }),
    h,
  )

const pageOf = (model: Model, h: HtmlBuilder<Message>): Page => {
  const { locale } = model.context
  return AppRoute.match(model.route, {
    Home: () => ({ title: format(locale, 'landing.title', {}), body: homeView(model, h) }),
    NotFound: () => ({ title: format(locale, 'common.notFoundTitle', {}), body: notFoundView(locale, h) }),
    Wallet: () => walletPage(model, h),
    Robots: () => robotsPage(model, h),
    RobotConsole: () => consolePage(model, h),
    Approval: () => approvalPage(model, h),
    Episodes: () => episodesPage(model, h),
    RobotEpisodes: () => episodesPage(model, h),
    Episode: () => episodePage(model, h),
    Merchant: () => merchantPage(model, h),
    Gate: () => gatePage(model, h),
  })
}

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const { locale } = model.context
  const page = pageOf(model, h)
  return {
    title: `${page.title} | Vitaquack`,
    lang: locale,
    dir: 'Ltr',
    body: h.div(
      [h.Class('site')],
      [
        h.header(
          [h.Class('masthead')],
          [h.a([h.Href(homeRouter()), h.Class('brand')], ['Vitaquack']), ownerNav(model, h)],
        ),
        page.body,
        h.footer(
          [],
          [
            h.span([], ['Vitaquack · ETHGlobal Mumbai 2026']),
            h.a([h.Href('https://github.com/grmkris/eth-global-mumbai-2026')], [format(locale, 'landing.contact', {})]),
          ],
        ),
      ],
    ),
  }
}
