import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { Catalogue, Invoice, Item } from './api.ts'

/** The demo merchant (packages/server/src/merchant/Catalogue.ts). */
export const MERCHANT_ID = 'duck-cafe'

/**
 * Above this (USDC base units) the buyer's owner must approve with World ID: the demo grants cap each payment at
 * 1 USDC, and the robot routes anything over its grant's per-payment cap through a World approval (robot/Budget.ts).
 * The real threshold is the buyer's own cap; the till only predicts it for the demo grant.
 */
export const APPROVAL_ABOVE = 1_000_000n

/** How often the till asks whether the invoice on screen was paid. */
export const POLL_MILLIS = 1000

/** Why the till is still waiting although it read something: a status whose signature failed, or no answer. */
export const Hitch = Schema.Literals(['unverified', 'offline'])
export type Hitch = typeof Hitch.Type

/** One sale at the counter: pick an item, show its x402 QR, wait for a signed "paid". */
export const Sale = defineTaggedUnion({
  Choosing: {},
  Opening: { item: Item },
  Waiting: { item: Item, invoice: Invoice, hitch: Schema.Option(Hitch) },
  Paid: { item: Item, invoice: Invoice },
  Expired: { item: Item, invoice: Invoice },
  Refused: { item: Item, reason: Schema.String },
})
export type Sale = typeof Sale.Type

export const Till = defineTaggedUnion({
  Loading: {},
  Ready: { catalogue: Catalogue, publicKey: Schema.String, sale: Sale },
  Broken: { reason: Schema.String },
})
export type Till = typeof Till.Type

export const Model = Schema.Struct({ till: Till })
export type Model = typeof Model.Type
