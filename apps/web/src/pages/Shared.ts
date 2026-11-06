import { format, type Locale } from '@ethmumbai/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { homeRouter } from '../route.ts'
import { cardsSkeleton } from '../Skeleton.ts'

// STYLES

const stackClassName = 'grid justify-items-start gap-3'
const actionClassName =
  'inline-flex min-h-12 cursor-pointer items-center rounded-control bg-ink px-5 font-semibold text-surface no-underline transition-transform active:scale-[0.96]'

/** The sign-in hint every owner page shows when its session is gone. */
export const signedOutView = <M>(locale: Locale, h: HtmlBuilder<M>): Html =>
  h.section(
    [h.Class(stackClassName)],
    [
      h.p([h.Role('alert')], [format(locale, 'wallet.signInFirst', {})]),
      h.a([h.Href(homeRouter()), h.Class(actionClassName)], [format(locale, 'auth.signInWithPasskey', {})]),
    ],
  )

/** A load that failed for a reason other than the session: the Worker's reason and a retry. */
export const failedView = <M>(error: string, retry: M, locale: Locale, h: HtmlBuilder<M>): Html =>
  h.section(
    [h.Class(stackClassName)],
    [
      h.p([h.Role('alert')], [format(locale, 'common.errorDetail', { message: error })]),
      h.button([h.Type('button'), h.Class(actionClassName), h.OnClick(retry)], [format(locale, 'common.retry', {})]),
    ],
  )

/** A page's data on its way: card-shaped skeletons under the page's own title. */
export const loadingView = cardsSkeleton
