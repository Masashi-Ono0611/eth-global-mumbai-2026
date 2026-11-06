import { renderSVG } from 'uqr'

/** A QR code as an SVG data URI for an `img`: dark modules on a transparent ground, error correction M (so a small
 *  mark in the middle stays readable). Pure, so the server and the browser render the same image. */
export const qrDataUri = (text: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    renderSVG(text, { ecc: 'M', border: 0, whiteColor: 'transparent', blackColor: '#1f2d36' }),
  )}`
