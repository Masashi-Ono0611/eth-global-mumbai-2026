import { format, type Locale } from '@ethmumbai/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { homeRouter } from '../route.ts'

/** The sign-in hint every owner page shows when its session is gone. */
export const signedOutView = <M>(locale: Locale, h: HtmlBuilder<M>): Html =>
  h.section(
    [h.Class('signed-out')],
    [
      h.p([h.Role('alert')], [format(locale, 'wallet.signInFirst', {})]),
      h.a([h.Href(homeRouter()), h.Class('primary-action')], [format(locale, 'auth.signInWithPasskey', {})]),
    ],
  )

/** A load that failed for a reason other than the session: the Worker's reason and a retry. */
export const failedView = <M>(error: string, retry: M, locale: Locale, h: HtmlBuilder<M>): Html =>
  h.section(
    [],
    [
      h.p([h.Role('alert')], [format(locale, 'common.errorDetail', { message: error })]),
      h.button([h.Type('button'), h.Class('primary-action'), h.OnClick(retry)], [format(locale, 'common.retry', {})]),
    ],
  )

export const loadingView = <M>(locale: Locale, h: HtmlBuilder<M>): Html =>
  h.p([h.Role('status')], [format(locale, 'common.loading', {})])

/** The frame of every owner page: one `main` landmark with the page heading first. */
export const ownerMain = <M>(title: string, content: Html, h: HtmlBuilder<M>): Html =>
  h.main([h.Id('main'), h.Class('owner-page')], [h.h1([], [title]), content])
