import { Context, Effect, Layer, Schema } from 'effect'

export class ClipboardFailed extends Schema.TaggedError<ClipboardFailed>()('ClipboardFailed', {}) {}

/** The browser clipboard, for "copy address". Commands call it; views never do. */
export class Clipboard extends Context.Service<
  Clipboard,
  { readonly copy: (text: string) => Effect.Effect<void, ClipboardFailed> }
>()('@ethmumbai/web/Clipboard') {}

export const clipboardLayer = (navigator: Navigator) =>
  Layer.succeed(
    Clipboard,
    Clipboard.of({
      copy: (text) =>
        Effect.tryPromise({ try: () => navigator.clipboard.writeText(text), catch: () => ClipboardFailed.make({}) }),
    }),
  )
