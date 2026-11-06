import type { Html, HtmlBuilder } from 'foldkit/html'

/** What a wait looks like (DESIGN.md "Motion"): a fast spinner inside a busy button, three dots before a line that
 *  says what is happening. Both are decorative and carry no text, so the label stays the accessible name. */

// STYLES

const spinnerClassName =
  'inline-block size-3.5 shrink-0 animate-spinner rounded-full border-2 border-current border-r-transparent'
const dotsClassName = 'me-1.5 inline-flex gap-[3px] align-middle'
const dotClassName = 'inline-block size-[5px] animate-dot rounded-full bg-current'
const secondDotClassName = 'inline-block size-[5px] animate-dot rounded-full bg-current [animation-delay:150ms]'
const thirdDotClassName = 'inline-block size-[5px] animate-dot rounded-full bg-current [animation-delay:300ms]'

// VIEW

const spinner = <M>(h: HtmlBuilder<M>): Html => h.span([h.Class(spinnerClassName), h.AriaHidden(true)])

/** A button's content: the spinner before the label while its request runs. */
export const busyLabel = <M>(busy: boolean, label: string, h: HtmlBuilder<M>): ReadonlyArray<Html | string> =>
  busy ? [spinner(h), label] : [label]

export const workingDots = <M>(h: HtmlBuilder<M>): Html =>
  h.span(
    [h.Class(dotsClassName), h.AriaHidden(true)],
    [h.span([h.Class(dotClassName)]), h.span([h.Class(secondDotClassName)]), h.span([h.Class(thirdDotClassName)])],
  )
