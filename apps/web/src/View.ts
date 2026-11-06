import { direction, format, type Locale } from '@ethmumbai/i18n'
import { Option } from 'effect'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { Message } from './message.ts'
import { AuthState, LocaleSave, type Model } from './model.ts'
import { homeView } from './pages/Home.ts'
import { robotConsoleView } from './pages/RobotConsoleView.ts'
import { robotsView } from './pages/RobotsView.ts'
import * as Wallet from './pages/Wallet.ts'
import { AppRoute, homeRouter, robotsRouter, walletRouter } from './route.ts'
const languages: ReadonlyArray<Readonly<{ locale: Locale; label: string }>> = [
  { locale: 'en', label: 'English' },
  { locale: 'sl', label: 'Slovenščina' },
  { locale: 'ja', label: '日本語' },
  { locale: 'hi', label: 'हिन्दी' },
  { locale: 'mr', label: 'मराठी' },
  { locale: 'en-XA', label: 'English (expanded)' },
  { locale: 'ar-XB', label: 'English (RTL)' },
]

const languagePicker = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  const pending = LocaleSave.guards.Saving(model.localeSave)
  return h.div(
    [h.Class('language-picker')],
    [
      h.label([h.For('language')], [format(locale, 'auth.language', {})]),
      h.select(
        [
          h.Id('language'),
          h.Value(locale),
          h.Disabled(pending),
          h.AriaBusy(pending),
          h.OnChange((value) => Message.SelectedLocale({ value })),
        ],
        languages.map((language) => h.keyed('option')(language.locale, [h.Value(language.locale)], [language.label])),
      ),
      LocaleSave.guards.Failed(model.localeSave)
        ? h.p([h.Role('alert')], [format(locale, 'common.error', {})])
        : h.empty,
    ],
  )
}

/** Links to the owner pages once the session is known. */
const ownerNav = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  return AuthState.guards.SignedIn(model.auth)
    ? h.nav(
        [h.Class('owner-nav')],
        [
          h.a([h.Href(walletRouter())], [format(locale, 'wallet.title', {})]),
          h.a([h.Href(robotsRouter())], [format(locale, 'robots.title', {})]),
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

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const { locale } = model.context
  const page = AppRoute.match(model.route, {
    Home: () => ({ title: format(locale, 'landing.title', {}), body: homeView(model, h) }),
    NotFound: () => ({ title: format(locale, 'common.notFoundTitle', {}), body: notFoundView(locale, h) }),
    Wallet: () => ({
      title: format(locale, 'wallet.title', {}),
      body: Option.match(model.maybeWallet, {
        onNone: () => notFoundView(locale, h),
        onSome: (wallet) =>
          h.submodel({
            slotId: 'wallet',
            model: wallet,
            view: Wallet.view,
            viewInputs: { locale },
            toParentMessage: (message) => Message.GotWalletMessage({ message }),
          }),
      }),
    }),
    Robots: () => ({
      title: format(locale, 'robots.title', {}),
      body: Option.match(model.maybeRobots, {
        onNone: () => notFoundView(locale, h),
        onSome: (robots) =>
          h.submodel({
            slotId: 'robots',
            model: robots,
            view: robotsView,
            viewInputs: { locale },
            toParentMessage: (message) => Message.GotRobotsMessage({ message }),
          }),
      }),
    }),
    RobotConsole: () => ({
      title: format(locale, 'console.title', {}),
      body: Option.match(model.maybeConsole, {
        onNone: () => notFoundView(locale, h),
        onSome: (robotConsole) =>
          h.submodel({
            slotId: 'robot-console',
            model: robotConsole,
            view: robotConsoleView,
            viewInputs: { locale },
            toParentMessage: (message) => Message.GotConsoleMessage({ message }),
          }),
      }),
    }),
  })
  return {
    title: `${page.title} | Vitaquack`,
    lang: locale,
    dir: direction(locale) === 'rtl' ? 'Rtl' : 'Ltr',
    body: h.div(
      [h.Class('site')],
      [
        h.header(
          [h.Class('masthead')],
          [h.a([h.Href(homeRouter()), h.Class('brand')], ['Vitaquack']), ownerNav(model, h), languagePicker(model, h)],
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
