import { Effect, Option, Redacted, Schema } from 'effect'
import { type Bindings, optionalBinding } from '../Respond.ts'

/** The bot Kris created on 6 Nov (spec §14); deep links are `https://t.me/<username>?start=<code>`. */
export const BOT_USERNAME = 'vitaquack_bot'
const DEFAULT_API_BASE = 'https://api.telegram.org'

/** A bot token as BotFather issues it (`<digits>:<key>`); `pending` and anything else is unset. */
const BotToken = Schema.String.check(Schema.isPattern(/^\d{5,}:[A-Za-z0-9_-]{30,}$/))
/** Telegram's `secret_token`: 1-256 of `[A-Za-z0-9_-]`; we require at least 16. */
const WebhookSecret = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{16,256}$/))
const BaseUrl = Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/))

export interface TelegramConfig {
  readonly token: Redacted.Redacted
  readonly webhookSecret: Redacted.Redacted
  /** `https://api.telegram.org`, or a local stub in the native tests (`TELEGRAM_API_BASE_URL`). */
  readonly apiBase: string
}

/** Both secrets decoded optionally: without them notifications are off (routes answer 503), never a failed Worker. */
export const makeTelegramConfig = Effect.fn('EthMumbai.Telegram.config')(function* (env: Bindings) {
  const token = yield* optionalBinding(env, 'TELEGRAM_BOT_TOKEN', BotToken)
  const webhookSecret = yield* optionalBinding(env, 'TELEGRAM_WEBHOOK_SECRET', WebhookSecret)
  const apiBase = Option.getOrElse(
    Schema.decodeUnknownOption(BaseUrl)(env.TELEGRAM_API_BASE_URL),
    () => DEFAULT_API_BASE,
  )
  if (Option.isNone(token) || Option.isNone(webhookSecret)) return Option.none<TelegramConfig>()
  return Option.some<TelegramConfig>({
    token: Redacted.make(token.value),
    webhookSecret: Redacted.make(webhookSecret.value),
    apiBase: apiBase.replace(/\/+$/, ''),
  })
})
