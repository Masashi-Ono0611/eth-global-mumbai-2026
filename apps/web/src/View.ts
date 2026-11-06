import { direction, format, type Locale } from '@ethmumbai/i18n'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { Message } from './message.ts'
import { LocaleSave, type Model } from './model.ts'
import { homeView } from './pages/Home.ts'
import { AppRoute, homeRouter } from './route.ts'
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
          [h.a([h.Href(homeRouter()), h.Class('brand')], ['Vitaquack']), languagePicker(model, h)],
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
