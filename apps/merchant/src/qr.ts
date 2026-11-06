import { renderSVG } from 'uqr'

/** A QR code for `text` as an SVG data URL, for an `<img>`: high error correction so a robot camera reads it at an angle. */
export const qrDataUrl = (text: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(text, { ecc: 'Q', border: 2 }))}`
