import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { Catalogue, CounterInvoice } from './api.ts'

/** The demo merchant (packages/server/src/merchant/Catalogue.ts). */
export const MERCHANT_ID = 'duck-cafe'

/**
 * Above this (USDC base units) the buyer's owner must approve with World ID: the demo grants cap each payment at
 * 1 USDC, and the robot routes anything over its grant's per-payment cap through a World approval (robot/Budget.ts).
 * The real threshold is the buyer's own cap; the till only predicts it for the demo grant.
 */
export const APPROVAL_ABOVE = 1_000_000n

/** How often the till reads what the counter screen shows. */
export const POLL_MILLIS = 2000

/** With less than this left the screen drops the invoice: the chip and scans refuse it (CLAIM_MARGIN_SECONDS). */
export const CLOSING_MILLIS = 60_000

/** What the till last read of the counter screen. `readAt` is when that read began (or when the tap's invoice was
 *  stored): a read that began earlier than what is shown is older news and changes nothing. */
export const Screen = defineTaggedUnion({
  Reading: {},
  Blank: { readAt: Schema.Finite },
  Showing: { invoice: CounterInvoice, readAt: Schema.Finite },
})
export type Screen = typeof Screen.Type

/** The tap on the menu: nothing in flight, an item going up, or the app's refusal for it. */
export const Tap = defineTaggedUnion({
  Idle: {},
  Placing: { itemId: Schema.String },
  Refused: { itemId: Schema.String, reason: Schema.String },
})
export type Tap = typeof Tap.Type

/** The screen reads: one at a time (`asking` while one is in flight), and whether the last one got an answer. */
export const Read = Schema.Literals(['idle', 'asking'])
export type Read = typeof Read.Type
export const Link = Schema.Literals(['answering', 'silent'])
export type Link = typeof Link.Type

export const Till = defineTaggedUnion({
  Loading: {},
  Ready: { catalogue: Catalogue, screen: Screen, tap: Tap, read: Read, link: Link },
  Broken: { reason: Schema.String },
})
export type Till = typeof Till.Type

export const Model = Schema.Struct({ till: Till })
export type Model = typeof Model.Type
