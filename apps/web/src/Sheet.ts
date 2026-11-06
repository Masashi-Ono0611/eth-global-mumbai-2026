import type { Dialog } from '@foldkit/ui'
import type { Html, HtmlBuilder } from 'foldkit/html'

// STYLES

const sheetDialogClassName =
  'm-0 h-full max-h-none w-full max-w-none bg-transparent p-0 open:flex items-end justify-center backdrop:bg-transparent'

const sheetBackdropClassName =
  'fixed inset-0 bg-ink/45 transition-opacity duration-200 ease-out data-[closed]:opacity-0 motion-reduce:transition-none'

const sheetPanelClassName =
  'relative grid w-full max-w-[30rem] gap-4 rounded-t-sheet bg-surface px-5 pt-3 pb-[calc(2rem+env(safe-area-inset-bottom))] text-ink shadow-[0_-12px_40px_-20px_rgb(0_0_0/0.35)] transition-[translate,opacity] duration-200 ease-out data-[closed]:translate-y-6 data-[closed]:opacity-0 motion-reduce:transition-none'

const sheetHandleClassName = 'h-[5px] w-10 justify-self-center rounded-full bg-rule'

export const sheetTitleClassName = 'font-display text-2xl leading-tight font-bold'

// VIEW

/** A bottom sheet (Foldkit UI Dialog, DESIGN.md "Sheets"): the backdrop, a handle and the content, rendered only while
 *  the dialog is open or animating. */
export const sheetView = <M>(
  { dialog, backdrop, panel, isVisible }: Dialog.RenderInfo,
  content: ReadonlyArray<Html>,
  h: HtmlBuilder<M>,
): Html =>
  h.dialog(
    [...dialog, h.Class(sheetDialogClassName)],
    isVisible
      ? [
          h.div([...backdrop, h.Class(sheetBackdropClassName)]),
          h.div([...panel, h.Class(sheetPanelClassName)], [h.span([h.Class(sheetHandleClassName)]), ...content]),
        ]
      : [],
  )
