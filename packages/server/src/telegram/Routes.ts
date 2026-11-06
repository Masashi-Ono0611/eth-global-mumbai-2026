import { Layer } from 'effect'
import { linkRoutes } from './Link.ts'
import { type WebhookDeps, webhookRoute } from './Webhook.ts'

/** Telegram notifications (spec §14): the wallet's link routes and the bot's webhook. */
export const telegramRoutes = (deps: WebhookDeps) =>
  Layer.mergeAll(linkRoutes(deps.database, deps.config), webhookRoute(deps))
