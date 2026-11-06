import type { Html, HtmlBuilder } from 'foldkit/html'

// STYLES

const bodyClassName = 'fill-duck-body'
const offlineBodyClassName = 'fill-surface'
const billClassName = 'fill-bill'
const offlineBillClassName = 'fill-muted/50'
const eyeClassName = 'fill-ink'
const antennaClassName = 'stroke-duck-body'
const offlineAntennaClassName = 'stroke-surface'

// VIEW

/** The robot duck (DESIGN.md): a rubber duck with an antenna. Decorative; the caller names the robot in text.
 *  `asleep` greys it out for an offline robot. */
export const duck = <M>(className: string, asleep: boolean, h: HtmlBuilder<M>): Html =>
  h.svg(
    [h.ViewBox('0 0 48 48'), h.Class(className), h.AriaHidden(true)],
    [
      h.path([
        h.D('M26 8.6V4.8'),
        h.StrokeWidth('2'),
        h.StrokeLinecap('round'),
        h.Class(asleep ? offlineAntennaClassName : antennaClassName),
      ]),
      h.circle([h.Cx('26'), h.Cy('3.8'), h.R('2'), h.Class(asleep ? offlineBillClassName : billClassName)]),
      h.path([h.D('M4.5 21.5 15 27.5 8 33z'), h.Class(asleep ? offlineBodyClassName : bodyClassName)]),
      h.ellipse([
        h.Cx('23'),
        h.Cy('34'),
        h.Rx('17'),
        h.Ry('9.5'),
        h.Class(asleep ? offlineBodyClassName : bodyClassName),
      ]),
      h.circle([h.Cx('26'), h.Cy('18'), h.R('9.6'), h.Class(asleep ? offlineBodyClassName : bodyClassName)]),
      h.path([
        h.D('M34.2 16.4c4.2-.6 7.8.3 9.3 2.5-1.6 2.1-5.4 2.9-9.4 2.2z'),
        h.Class(asleep ? offlineBillClassName : billClassName),
      ]),
      h.circle([h.Cx('29'), h.Cy('15.6'), h.R('1.9'), h.Class(eyeClassName)]),
    ],
  )
