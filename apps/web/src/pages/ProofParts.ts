import { format, type Locale } from '@ethmumbai/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { chainScan, storageScan } from '../api/Episodes.ts'

// STYLES

const zeroGLineClassName = 'flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9rem]'
const zeroGLinkClassName = 'font-semibold text-paid decoration-paid/40'
const zeroGPendingClassName = 'text-[0.9rem] text-muted'
const zeroGFailedClassName = 'text-[0.9rem] text-error'
const teeMarkClassName =
  'ml-1.5 inline-flex items-center rounded-full bg-paid/10 px-1.5 align-middle text-[0.72rem] font-semibold text-paid'

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
  return h.p([h.Class(zeroGPendingClassName)], [format(locale, 'proof.saving', {})])
}

/** A decision whose 0G provider proved its answer from a TEE (the stored verification flag; the proof page re-checks). */
export const teeMark = <M>(verified: boolean, locale: Locale, h: HtmlBuilder<M>): Html =>
  verified ? h.span([h.Class(teeMarkClassName)], [format(locale, 'proof.tee', {})]) : h.empty
