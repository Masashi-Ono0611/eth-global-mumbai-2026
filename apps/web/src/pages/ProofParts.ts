import { format, type Locale } from '@ethmumbai/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { chainScan, observationImage, type SeenCrop, storageScan } from '../api/Episodes.ts'
import { workingDots } from '../Busy.ts'

// STYLES

const zeroGLineClassName = 'flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9rem]'
const zeroGLinkClassName = 'font-semibold text-paid decoration-paid/40'
const zeroGPendingClassName = 'text-[0.9rem] text-muted'
const zeroGFailedClassName = 'text-[0.9rem] text-error'
const teeMarkClassName =
  'ml-1.5 inline-flex items-center rounded-full bg-paid/10 px-1.5 align-middle text-[0.72rem] font-semibold text-paid'

const seenBubbleClassName = 'grid max-w-[86%] gap-1.5 self-start rounded-[20px_20px_20px_6px] bg-surface p-2 pb-2.5'
const seenLabelClassName = 'px-1.5 text-[0.8rem] text-muted'
/** Inner radius = the bubble's 20 px minus its 8 px padding; a pure-black 10 % outline keeps the photo's edge clean. */
// A crop is the QR's box plus a margin, about square: the space is reserved before the image arrives.
const seenImageClassName =
  'block aspect-square w-44 rounded-[12px] bg-paper object-contain outline outline-1 -outline-offset-1 outline-black/10'
const seenCaptionClassName = 'px-1.5 text-[0.95rem]'
const seenFrameLinkClassName = 'block px-1.5 text-[0.85rem] font-semibold text-paid decoration-paid/40'
const seenSourceClassName = 'block px-1.5 text-[0.8rem] text-muted'

// VIEW

/** The errand's record as the evidence uploader left it (protocol upload states). */
export type ZeroGRecord = Readonly<{
  status: string
  rootHash: string | null
  logTx: string | null
  error?: string | null
}>

/**
 * Where the errand's record is: saved on 0G (the episode on 0G Storage and its EpisodeLog record on 0G Chain), still
 * being saved, or why it is not saved yet. Nothing before the errand ends (no upload row yet).
 */
export const zeroGLine = <M>(record: ZeroGRecord | null, locale: Locale, h: HtmlBuilder<M>): Html => {
  if (record === null) return h.empty
  if (record.status === 'uploaded')
    return h.p(
      [h.Class(zeroGLineClassName)],
      [
        h.span([], [format(locale, 'proof.saved', {})]),
        record.rootHash === null
          ? h.empty
          : h.a(
              [h.Href(storageScan(record.rootHash)), h.Class(zeroGLinkClassName)],
              [format(locale, 'proof.storage', {})],
            ),
        record.logTx === null
          ? h.empty
          : h.a([h.Href(chainScan(record.logTx)), h.Class(zeroGLinkClassName)], [format(locale, 'proof.log', {})]),
      ],
    )
  if (record.status === 'failed')
    return h.p(
      [h.Class(zeroGFailedClassName)],
      [format(locale, 'proof.failed', { error: record.error ?? format(locale, 'proof.noReason', {}) })],
    )
  return h.p([h.Class(zeroGPendingClassName)], [workingDots(h), format(locale, 'proof.saving', {})])
}

/** A decision whose 0G provider proved its answer from a TEE (the stored verification flag; the proof page re-checks). */
export const teeMark = <M>(verified: boolean, locale: Locale, h: HtmlBuilder<M>): Html =>
  verified ? h.span([h.Class(teeMarkClassName)], [format(locale, 'proof.tee', {})]) : h.empty

/** What the robot saw: the chip-signed QR crop it scanned at the counter, as the errand's first robot message. A sim
 *  robot's crop comes from the simulator's head camera, and says so. Never a camera frame beyond this crop. */
export const seenBubble = <M>(
  key: string,
  episodeId: string,
  crop: SeenCrop,
  caption: string | null,
  sim: boolean,
  robotName: string,
  locale: Locale,
  h: HtmlBuilder<M>,
): Html =>
  h.keyed('figure')(
    `${key}-seen`,
    [h.Class(seenBubbleClassName)],
    [
      h.span([h.Class(seenLabelClassName)], [format(locale, 'proof.atCounter', {})]),
      h.img([
        h.Src(observationImage(episodeId, crop.sha256)),
        h.Alt(format(locale, 'proof.seenAlt', { name: robotName })),
        h.Loading('lazy'),
        h.Decoding('async'),
        h.Class(seenImageClassName),
      ]),
      h.figcaption(
        [],
        [
          caption === null ? h.empty : h.span([h.Class(seenCaptionClassName)], [caption]),
          sim ? h.span([h.Class(seenSourceClassName)], [format(locale, 'proof.seenBySim', {})]) : h.empty,
          crop.rootHash === undefined
            ? h.empty
            : crop.rootHash === null
              ? h.span([h.Class(seenSourceClassName)], [workingDots(h), format(locale, 'proof.frameSaving', {})])
              : h.a(
                  [h.Href(storageScan(crop.rootHash)), h.Class(seenFrameLinkClassName)],
                  [format(locale, 'proof.frameOnZeroG', {})],
                ),
        ],
      ),
    ],
  )
