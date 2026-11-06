import type { HtmlBuilder, TextareaAttribute } from 'foldkit/html'
import type { Html } from 'zyzz/runtime'

/** Foldkit attributes for an applied zyzz style: its classes, inline declarations and recipe `data-*` attributes.
 * Prefer static styles; model state with variants or `data-*` selectors rather than inline declarations.
 * Ported from styldappv2 `apps/web/src/Styled.ts` (zyzz has no Foldkit adapter). */
export const styled = <Message>(
  h: HtmlBuilder<Message>,
  attributes: Html.Attributes,
): Array<TextareaAttribute<Message>> => {
  const result: Array<TextareaAttribute<Message>> = [h.Class(attributes.class)]
  if (attributes.style !== undefined) result.push(h.Attribute('style', attributes.style))
  for (const [name, value] of Object.entries(attributes)) {
    if (name.startsWith('data-') && value !== undefined) result.push(h.DataAttribute(name.slice('data-'.length), value))
  }
  return result
}
