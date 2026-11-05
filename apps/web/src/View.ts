import { direction, format, type Locale } from '@ethmumbai/i18n'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { Message } from './message.ts'
import { LocaleSave, type Model } from './model.ts'
import { AppRoute, homeRouter, loginRouter } from './route.ts'

import { accountView } from './ViewAccount.ts'

/** The team's architecture page on the scratch site (docs/site). */
const architectureUrl = 'https://eth-mumbai-site.kristjan-grm11775.workers.dev/architecture/'
const languages: ReadonlyArray<Readonly<{ locale: Locale; label: string }>> = [
  { locale: 'en', label: 'English' },
  { locale: 'sl', label: 'Slovenščina' },
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

const homeView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.main(
    [h.Id('main')],
    [
      h.section(
        [h.Class('intro')],
        [
          h.h1([], [format(locale, 'landing.title', {})]),
          h.p([h.Class('lead')], [format(locale, 'landing.description', {})]),
          h.a([h.Href(architectureUrl), h.Class('primary-action')], [format(locale, 'landing.browse', {})]),
          h.a([h.Href(loginRouter()), h.Class('secondary-action')], [format(locale, 'auth.signInWithEmail', {})]),
        ],
      ),
      h.section(
        [h.Id('inspiration'), h.Class('inspiration')],
        [
          h.h2([], [format(locale, 'landing.feedTitle', {})]),
          h.p([], [format(locale, 'landing.feedDescription', {})]),
          h.p([h.Class('empty-state')], [format(locale, 'landing.feedEmpty', {})]),
        ],
      ),
    ],
  )

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
    Home: () => ({ title: format(locale, 'landing.title', {}), body: homeView(locale, h) }),
    Login: () => ({ title: format(locale, 'auth.signInTitle', {}), body: accountView(model, h) }),
    Account: () => ({ title: format(locale, 'auth.signInTitle', {}), body: accountView(model, h) }),
    NotFound: () => ({ title: format(locale, 'common.notFoundTitle', {}), body: notFoundView(locale, h) }),
  })
  return {
    title: `${page.title} | ETH Global Mumbai 2026`,
    lang: locale,
    dir: direction(locale) === 'rtl' ? 'Rtl' : 'Ltr',
    body: h.div(
      [h.Class('site')],
      [
        h.header(
          [h.Class('masthead')],
          [h.a([h.Href(homeRouter()), h.Class('brand')], ['ETH Global Mumbai 2026']), languagePicker(model, h)],
        ),
        page.body,
        h.footer(
          [],
          [
            h.span([], ['ETH Global Mumbai 2026']),
            h.a([h.Href('https://github.com/grmkris/eth-global-mumbai-2026')], [format(locale, 'landing.contact', {})]),
          ],
        ),
      ],
    ),
  }
}
