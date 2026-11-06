import { format, type Locale } from '@ethmumbai/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { Message } from './Episode.ts'

/** The audit page's shared pieces: its Tailwind class constants and the card / field markup every card uses. */

// STYLES

/** One errand after the fact, in the conversation's column: the summary, the timeline, then one card per party. */
export const auditLayoutClassName = 'grid gap-3 px-1 pt-4 pb-12'
export const backClassName =
  'inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-full bg-surface px-3.5 font-semibold no-underline transition-transform active:scale-[0.96]'
export const titleClassName = 'font-display text-[1.7rem] leading-tight font-bold text-balance'
export const mutedClassName = 'text-[0.92rem] text-muted text-pretty'

const auditCardClassName =
  'grid justify-items-start gap-3 rounded-card bg-surface p-4 wrap-anywhere *:max-w-full [&_a]:font-semibold [&_a]:text-paid [&_a]:decoration-paid/40 [&>h2]:font-display [&>h2]:text-lg [&>h2]:font-bold'
/** Label over value, one column: the card is phone-width. */
const fieldListClassName =
  'm-0 grid w-full gap-y-0.5 [&_dd]:m-0 [&_dd]:mb-2 [&_dd]:wrap-anywhere [&_dt]:text-[0.85rem] [&_dt]:text-muted'
/** Ids and hashes are compared character by character, so only they are monospaced. */
const monoValueClassName = 'font-mono text-[0.85rem]'
/** The exact JSON the brain received, folded away until asked for. */
export const inputDetailsClassName =
  'w-full [&_pre]:m-0 [&_pre]:max-h-96 [&_pre]:overflow-auto [&_pre]:rounded-control [&_pre]:bg-paper [&_pre]:px-4 [&_pre]:py-3 [&_pre]:font-mono [&_pre]:text-sm [&_summary]:min-h-11 [&_summary]:cursor-pointer [&_summary]:py-[0.6rem] [&_summary]:font-semibold'

export const timelineListClassName =
  'm-0 grid list-none gap-2 border-s-2 border-duck-deep/40 ps-4 wrap-anywhere [&_time]:me-2 [&_time]:block [&_time]:text-[0.8rem] [&_time]:text-muted [&_time]:tabular-nums'
/** A column of related lines (one decision, one verify answer). */
export const stackClassName = 'grid w-full justify-items-start gap-2'
/** A replay's answer, set off from the original decision above it. */
export const replayBoxClassName = 'grid w-full gap-2 rounded-control bg-paper p-3'
/** Verify's checks: each says whether the stored value matches the EpisodeLog record. */
export const checkListClassName =
  "m-0 grid list-none gap-[0.35rem] p-0 [&_[data-match=no]]:text-error [&_[data-match=no]]:before:content-['✗_'] [&_[data-match=yes]]:text-paid [&_[data-match=yes]]:before:content-['✓_']"

export const alertTextClassName = 'text-error'

/** Verify and Replay: the app's dark button, dimmed while its request runs. */
export const auditButtonClassName =
  'inline-flex min-h-12 cursor-pointer items-center rounded-control bg-ink px-5 font-semibold text-surface transition-transform active:scale-[0.96] disabled:cursor-progress disabled:opacity-60'

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

const MONO: ReadonlySet<Field> = new Set<Field>([
  'requestId',
  'promptHash',
  'leafHash',
  'payer',
  'rootHash',
  'requestIdsHash',
  'recorder',
  'sha256',
  'signer',
  'teeSigner',
])

/** A definition list of the fields that have a value. */
export const fields = (
  rows: ReadonlyArray<readonly [Field, string | Html | null]>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  h.dl(
    [h.Class(fieldListClassName)],
    rows.flatMap(([field, value]) =>
      value === null
        ? []
        : [
            h.dt([], [format(locale, 'episode.field', { field })]),
            h.dd(MONO.has(field) ? [h.Class(monoValueClassName)] : [], [value]),
          ],
    ),
  )

export const card = (kind: Card, locale: Locale, content: ReadonlyArray<Html>, h: HtmlBuilder<Message>): Html =>
  h.section([h.Class(auditCardClassName)], [h.h2([], [format(locale, 'episode.card', { card: kind })]), ...content])
export const none = (kind: Card, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.p([h.Class(mutedClassName)], [format(locale, 'episode.none', { card: kind })])
