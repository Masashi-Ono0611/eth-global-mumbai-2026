import { format, type Locale } from '@ethmumbai/i18n'
import { clsx } from 'clsx'
import type { Html, HtmlBuilder } from 'foldkit/html'

/** The shape of a page while its data loads (DESIGN.md "Motion"): grey blocks where the content will be, pulsing
 *  calmly, never duck yellow. The server renders them as the first paint. Screen readers hear "Loading..." from a
 *  visually hidden status line; the blocks are hidden from them. */

// STYLES

const blockClassName = 'block animate-skeleton bg-rule/70 motion-reduce:animate-none'
const shortLineClassName = 'h-3.5 w-24 rounded-full'
const titleLineClassName = 'h-5 w-28 rounded-full'
const circleClassName = 'size-[52px] shrink-0 rounded-full'
const smallCircleClassName = 'size-11 shrink-0 rounded-full'
const amountClassName = 'h-14 w-52 rounded-2xl'
const pillClassName = 'h-11 w-24 rounded-full'
const inputClassName = 'h-12 w-full rounded-control'
const ownerBubbleClassName = 'h-10 w-36 self-end rounded-[20px_20px_6px_20px]'
const robotBubbleClassName = 'h-16 w-60 max-w-[86%] self-start rounded-[20px_20px_20px_6px]'
const chipClassName = 'h-[3.25rem] rounded-2xl'

const walletClassName = 'grid gap-0 pb-6'
const balanceClassName = 'grid gap-2.5 px-2 pt-4'
const pillRowClassName = 'flex gap-1.5 px-1 pt-4 pb-1'
const sectionTitleClassName = 'px-2 pt-7 pb-3'
const listClassName = 'mx-0.5 grid rounded-card bg-surface py-1'
const rowClassName = 'grid min-h-[4.5rem] grid-cols-[52px_1fr] items-center gap-3 px-3.5 py-2.5'
const rowTextClassName = 'grid gap-2'
const cardClassName = 'grid gap-3 rounded-card bg-surface p-4'
const panelClassName = 'grid gap-3'
const threadClassName = 'flex min-h-[calc(100svh-2rem)] flex-col'
const threadHeaderClassName =
  'grid grid-cols-[44px_44px_1fr_auto] items-center gap-2.5 border-b border-rule px-1 pt-1 pb-2.5'
const threadBodyClassName = 'flex flex-1 flex-col gap-2 px-1 pt-3 pb-4'
const chipsClassName = 'grid grid-cols-3 gap-1.5 px-1 pt-4 pb-2'

// VIEW

const bar = <M>(className: string, h: HtmlBuilder<M>): Html => h.span([h.Class(clsx(blockClassName, className))])

/** The hidden status line and the decorative shape. Keyed, so the loaded page replaces it as a new node (and fades
 *  in) instead of being patched into it. */
const skeleton = <M>(shape: Html, locale: Locale, h: HtmlBuilder<M>): Html =>
  h.keyed('div')(
    'skeleton',
    [h.Class('contents')],
    [
      h.p([h.Role('status'), h.Class('sr-only')], [format(locale, 'common.loading', {})]),
      h.div([h.Class('contents'), h.AriaHidden(true)], [shape]),
    ],
  )

const listRow = <M>(h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class(rowClassName)],
    [
      bar(circleClassName, h),
      h.span([h.Class(rowTextClassName)], [bar('h-3.5 rounded-full w-28', h), bar('h-3.5 rounded-full w-44', h)]),
    ],
  )

const card = <M>(h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class(cardClassName)],
    [bar('h-5 rounded-full w-40', h), bar('h-3.5 rounded-full w-full', h), bar('h-3.5 rounded-full w-3/5', h)],
  )

/** The wallet home: balance, the action pills, robots and payments. */
export const walletSkeleton = <M>(locale: Locale, h: HtmlBuilder<M>): Html =>
  skeleton(
    h.div(
      [h.Class(walletClassName)],
      [
        h.div([h.Class(balanceClassName)], [bar(amountClassName, h), bar('h-3.5 rounded-full w-40', h)]),
        h.div([h.Class(pillRowClassName)], [bar(pillClassName, h), bar(pillClassName, h), bar(pillClassName, h)]),
        h.div([h.Class(sectionTitleClassName)], [bar(titleLineClassName, h)]),
        h.div([h.Class(listClassName)], [listRow(h), listRow(h)]),
        h.div([h.Class(sectionTitleClassName)], [bar(titleLineClassName, h)]),
        h.div([h.Class(listClassName)], [listRow(h), listRow(h), listRow(h)]),
      ],
    ),
    locale,
    h,
  )

/** Cards, for pages whose title and back link already render (payment records, an errand's proof, an approval). */
export const cardsSkeleton = <M>(locale: Locale, h: HtmlBuilder<M>): Html =>
  skeleton(h.div([h.Class('grid gap-3')], [card(h), card(h)]), locale, h)

/** The sign-in panel: the name field and the two passkey buttons, so the hero above does not jump. */
export const panelSkeleton = <M>(locale: Locale, h: HtmlBuilder<M>): Html =>
  skeleton(
    h.div(
      [h.Class(panelClassName)],
      [bar(shortLineClassName, h), bar(inputClassName, h), bar(inputClassName, h), bar(inputClassName, h)],
    ),
    locale,
    h,
  )

/** One robot bubble, for a conversation that is still loading its first message. */
export const bubbleSkeleton = <M>(locale: Locale, h: HtmlBuilder<M>): Html =>
  skeleton(bar(robotBubbleClassName, h), locale, h)

/** A robot's conversation: its header, a few bubbles and the buy chips. */
export const threadSkeleton = <M>(locale: Locale, h: HtmlBuilder<M>): Html =>
  skeleton(
    h.div(
      [h.Class(threadClassName)],
      [
        h.div(
          [h.Class(threadHeaderClassName)],
          [
            bar(smallCircleClassName, h),
            bar(smallCircleClassName, h),
            h.span([h.Class('grid gap-1.5')], [bar('h-5 rounded-full w-28', h), bar(shortLineClassName, h)]),
            bar('h-11 w-20 rounded-[14px]', h),
          ],
        ),
        h.div(
          [h.Class(threadBodyClassName)],
          [bar(ownerBubbleClassName, h), bar(robotBubbleClassName, h), bar(robotBubbleClassName, h)],
        ),
        h.div([h.Class(chipsClassName)], [bar(chipClassName, h), bar(chipClassName, h), bar(chipClassName, h)]),
      ],
    ),
    locale,
    h,
  )

/** The wallet's avatar slot while the session is read, so the page below does not shift when the avatar arrives. */
export const avatarSkeleton = <M>(h: HtmlBuilder<M>): Html =>
  h.span([h.Class(clsx(blockClassName, smallCircleClassName)), h.AriaHidden(true)])
