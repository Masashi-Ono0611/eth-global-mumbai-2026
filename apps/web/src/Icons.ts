import type { Html, HtmlBuilder } from 'foldkit/html'

// STYLES

const iconClassName = 'size-5 shrink-0 fill-none stroke-current text-muted'
const badgeIconClassName = 'size-4 shrink-0 fill-none stroke-current'

// VIEW

/** A 24px line icon drawn from `paths`. Decorative: the text beside it says the same thing. */
const icon = <M>(paths: ReadonlyArray<string>, h: HtmlBuilder<M>, className = iconClassName): Html =>
  h.svg(
    [h.ViewBox('0 0 24 24'), h.Class(className), h.AriaHidden(true)],
    paths.map((d) => h.path([h.D(d), h.StrokeWidth('1.8'), h.StrokeLinecap('round'), h.StrokeLinejoin('round')])),
  )

/** A receipt: the most one purchase may cost. */
export const receiptIcon = <M>(h: HtmlBuilder<M>): Html =>
  icon(['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'], h)

/** A map pin: the one place the robot may pay. */
export const placeIcon = <M>(h: HtmlBuilder<M>): Html =>
  icon(['M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z', 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'], h)

/** A clock: when the allowance ends. */
export const clockIcon = <M>(h: HtmlBuilder<M>): Html =>
  icon(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'], h)

/** A shield with a check: a purchase that waits for the owner's approval. */
export const approvalIcon = <M>(h: HtmlBuilder<M>): Html =>
  icon(['M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z', 'M9 12l2 2 4-4'], h)

/** A dollar coin: USDC, the only token the wallet takes (a generic mark, not Circle's logo). */
export const coinIcon = <M>(h: HtmlBuilder<M>): Html =>
  icon(
    [
      'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
      'M14.5 9.5c-.5-1-1.4-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2-.5-2.5-1.5',
      'M12 6.5v11',
    ],
    h,
    badgeIconClassName,
  )
