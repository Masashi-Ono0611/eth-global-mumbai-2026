import { Schema } from 'effect'

/** The app is English only (Kris, 6 Nov 2026). The locale stays in the flags so rendering is explicit. */
export const Locale = Schema.Literal('en')
export type Locale = typeof Locale.Type
