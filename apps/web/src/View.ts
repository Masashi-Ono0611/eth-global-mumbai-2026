import { direction, format, type Locale } from '@styld/i18n'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { LocaleSave, Message, type Model } from './App.ts'

import { accountView } from './ViewAccount.ts'

const homePath = '/'
const loginPath = '/login'
const browseAnchor = '#inspiration'
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
          h.a([h.Href(browseAnchor), h.Class('primary-action')], [format(locale, 'landing.browse', {})]),
          h.a([h.Href(loginPath), h.Class('secondary-action')], [format(locale, 'auth.signInWithEmail', {})]),
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
      h.a([h.Href(homePath)], [format(locale, 'common.goHome', {})]),
    ],
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const { locale, pathname } = model.context
  const isHome = pathname === homePath
  const isLogin = pathname === loginPath || pathname === '/account'
  return {
    title:
      format(locale, isHome ? 'landing.title' : isLogin ? 'auth.signInTitle' : 'common.notFoundTitle', {}) + ' | Styld',
    lang: locale,
    dir: direction(locale) === 'rtl' ? 'Rtl' : 'Ltr',
    body: h.div(
      [h.Class('site')],
      [
        h.header(
          [h.Class('masthead')],
          [
            h.a(
              [h.Href(homePath), h.Class('brand'), h.AriaLabel('Styld')],
              [h.img([h.Src('/brand/wordmark.svg'), h.Alt('Styld'), h.Width('112'), h.Height('53')])],
            ),
            languagePicker(model, h),
          ],
        ),
        isHome ? homeView(locale, h) : isLogin ? accountView(model, h) : notFoundView(locale, h),
        h.footer(
          [],
          [h.span([], ['Styld']), h.a([h.Href('mailto:hello@styld.app')], [format(locale, 'landing.contact', {})])],
        ),
      ],
    ),
  }
}
