import { format, type Locale } from '@ethmumbai/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Message } from './Episode.ts'

/** The audit page's shared pieces: its Tailwind class constants and the card / field markup every card uses. */

// STYLES

/** One errand after the fact: the summary, the timeline, then one card per party. */
export const auditLayoutClassName = 'grid gap-3 pb-12'

const auditCardClassName = 'grid justify-items-start gap-3 border-t border-rule py-6 wrap-anywhere *:max-w-full'
/** Label and value pairs; values are ids, hashes and amounts, so they are monospaced and may break anywhere. */
const fieldListClassName =
  'm-0 grid w-full grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-[0.35rem] max-[560px]:grid-cols-[minmax(0,1fr)] [&_dd]:m-0 [&_dd]:font-mono [&_dd]:text-sm [&_dd]:wrap-anywhere max-[560px]:[&_dd]:mb-2 [&_dt]:text-sm [&_dt]:text-muted'
/** The exact JSON the brain received, folded away until asked for. */
export const inputDetailsClassName =
  'w-full [&_pre]:m-0 [&_pre]:max-h-96 [&_pre]:overflow-auto [&_pre]:rounded-control [&_pre]:border [&_pre]:border-rule [&_pre]:px-4 [&_pre]:py-3 [&_pre]:font-mono [&_pre]:text-sm [&_summary]:min-h-11 [&_summary]:cursor-pointer [&_summary]:py-[0.6rem]'

export const timelineListClassName =
  'm-0 grid list-none gap-2 border-s-2 border-rule ps-4 wrap-anywhere [&_time]:me-3 [&_time]:font-mono [&_time]:text-sm [&_time]:text-muted [&_time]:tabular-nums'
/** A column of related lines (one decision, one verify answer). */
export const stackClassName = 'grid w-full justify-items-start gap-2'
/** A replay's answer, set off from the original decision above it. */
export const replayBoxClassName = 'grid w-full gap-2 border-s-3 border-ink ps-4'
/** Verify's checks: each says whether the stored value matches the EpisodeLog record. */
export const checkListClassName =
  "m-0 grid list-none gap-[0.35rem] p-0 [&_[data-match=no]]:text-error [&_[data-match=no]]:before:content-['✗_'] [&_[data-match=yes]]:text-online [&_[data-match=yes]]:before:content-['✓_']"

export const alertTextClassName = 'text-error'

export const actionRowClassName = 'flex flex-wrap gap-3'
/** Verify and Replay: a secondary action, dimmed while its request runs. */
export const auditButtonClassName =
  'inline-flex min-h-12 cursor-pointer items-center rounded-control border border-rule bg-transparent px-6 py-[0.65rem] text-ink not-disabled:hover:border-ink active:opacity-80 disabled:cursor-progress disabled:opacity-55'

export type Inputs = { readonly locale: Locale; readonly timeZone: string }
type Field =
  | 'requestId'
  | 'brain'
  | 'latency'
  | 'promptHash'
  | 'outcome'
  | 'error'
  | 'leafHash'
  | 'status'
  | 'gas'
  | 'payer'
  | 'reason'
  | 'acr'
  | 'amr'
  | 'rootHash'
  | 'requestIdsHash'
  | 'recorder'
  | 'recordedAt'
  | 'capturedAt'
  | 'sha256'
  | 'signer'
  | 'teeSigner'
  | 'teeFetched'
type Card = 'observation' | 'decision' | 'chip' | 'payment' | 'approval' | 'evidence' | 'timeline'

export const link = (href: string, label: string, h: HtmlBuilder<Message>): Html => h.a([h.Href(href)], [label])

/** A definition list of the fields that have a value. */
export const fields = (
  rows: ReadonlyArray<readonly [Field, string | Html | null]>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.dl(
    [h.Class(fieldListClassName)],
    rows.flatMap(([field, value]) =>
      value === null ? [] : [h.dt([], [format(locale, 'episode.field', { field })]), h.dd([], [value])],
    ),
  )

export const card = (kind: Card, locale: Locale, content: ReadonlyArray<Html>, h: HtmlBuilder<Message>): Html =>
  h.section([h.Class(auditCardClassName)], [h.h2([], [format(locale, 'episode.card', { card: kind })]), ...content])
export const none = (kind: Card, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.p([h.Class('hint')], [format(locale, 'episode.none', { card: kind })])
