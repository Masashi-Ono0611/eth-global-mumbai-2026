import type { Html, HtmlBuilder } from 'foldkit/html'

// Stroke icons on a 24 px grid (Heroicons outline paths, as Foldkit's ui-showcase draws them). Decorative: the control
// that holds one names itself in text or an aria-label.

const strokeIcon = <M>(className: string, strokeWidth: string, d: string, h: HtmlBuilder<M>): Html =>
  h.svg(
    [
      h.AriaHidden(true),
      h.Class(className),
      h.Fill('none'),
      h.ViewBox('0 0 24 24'),
      h.StrokeWidth(strokeWidth),
      h.Stroke('currentColor'),
    ],
    [h.path([h.StrokeLinecap('round'), h.StrokeLinejoin('round'), h.D(d)])],
  )

export const arrowUp = <M>(className: string, h: HtmlBuilder<M>): Html =>
  strokeIcon(className, '2.25', 'M12 19.5v-15m0 0-6.75 6.75M12 4.5l6.75 6.75', h)

export const chevronDown = <M>(className: string, h: HtmlBuilder<M>): Html =>
  strokeIcon(className, '2', 'M19.5 8.25l-7.5 7.5-7.5-7.5', h)

export const check = <M>(className: string, h: HtmlBuilder<M>): Html =>
  strokeIcon(className, '2.5', 'M4.5 12.75l6 6 9-13.5', h)
