import { format, type Locale } from '@ethmumbai/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { duck } from '../Duck.ts'
import { homeRouter } from '../route.ts'

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

const loaderClassName =
  'grid min-h-[40svh] place-content-center justify-items-center gap-3 text-muted motion-safe:animate-loader-in'
const loaderFaceClassName = 'grid size-16 place-items-center rounded-full bg-ink motion-safe:animate-duck-bob'

const typingClassName =
  'inline-flex max-w-[86%] items-center gap-1.5 self-start rounded-[20px_20px_20px_6px] bg-surface px-4 py-3'
const dotClassName = 'size-2 rounded-full bg-muted motion-safe:animate-typing-dot'
const DOTS = [
  { id: 'dot-1', delay: '0ms' },
  { id: 'dot-2', delay: '150ms' },
  { id: 'dot-3', delay: '300ms' },
]

/** Three dots, one after another (static under reduced motion): the robot is working something out. */
export const typingDots = <M>(h: HtmlBuilder<M>): ReadonlyArray<Html> =>
  DOTS.map((dot) => h.keyed('span')(dot.id, [h.Class(dotClassName), h.Style({ 'animation-delay': dot.delay })]))

/** A robot bubble that is still being written, for a thread's loading message; screen readers hear "Loading…". */
export const typingBubble = <M>(locale: Locale, h: HtmlBuilder<M>): Html =>
  h.p([h.Class(typingClassName), h.Role('status'), h.AriaLabel(format(locale, 'common.loading', {}))], typingDots(h))

/** Every owner page's loading state: the duck bobbing (still under reduced motion), then "Loading…". It fades in after a
 *  moment, so a fast load shows nothing at all. */
export const loadingView = <M>(locale: Locale, h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Role('status'), h.Class(loaderClassName)],
    [
      h.span([h.Class(loaderFaceClassName)], [duck('size-11', false, h)]),
      h.span([], [format(locale, 'common.loading', {})]),
    ],
  )
