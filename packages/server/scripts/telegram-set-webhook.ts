// Points @vitaquack_bot at the deployed app's webhook (spec §14). Run by hand after a deploy, never from CI:
//   bun --env-file=.env.main.local packages/server/scripts/telegram-set-webhook.ts [--base-url URL] [--info]
// It reads APP_TELEGRAM_BOT_TOKEN and APP_TELEGRAM_WEBHOOK_SECRET (the same values the Worker has), sets the webhook
// with that secret (Telegram sends it back in X-Telegram-Bot-Api-Secret-Token on every update), the commands menu and
// the bot's descriptions. It prints statuses only, never the token or the secret.
// Note: once a webhook is set Telegram stops serving getUpdates; `--info` only reads the current webhook.
/** Statuses go to stdout and problems to stderr (scripts do not use `console`). */
const say = (line: string) => process.stdout.write(`${line}\n`)
const DEPLOYED = 'https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev'
const flag = (name: string) => {
  const index = Bun.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : Bun.argv[index + 1]
}
const token = process.env.APP_TELEGRAM_BOT_TOKEN ?? ''
const secret = process.env.APP_TELEGRAM_WEBHOOK_SECRET ?? ''
if (!/^\d{5,}:[\w-]{30,}$/.test(token) || !/^[\w-]{16,256}$/.test(secret)) {
  process.stderr.write(
    'APP_TELEGRAM_BOT_TOKEN and APP_TELEGRAM_WEBHOOK_SECRET must be set (bun --env-file=.env.main.local …)\n',
  )
  process.exit(1)
}
const base = new URL(flag('base-url') ?? DEPLOYED).origin

/** One Bot API call; prints the method and Telegram's ok/description, never the URL (it carries the token). */
const call = async (method: string, body: Record<string, unknown> = {}) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const answer: unknown = await response.json()
  const ok = typeof answer === 'object' && answer !== null && 'ok' in answer && answer.ok === true
  const description = typeof answer === 'object' && answer !== null && 'description' in answer ? answer.description : ''
  say(`${method}: ${ok ? 'ok' : `FAILED (${response.status}) ${String(description)}`}`)
  return { ok, answer }
}

if (Bun.argv.includes('--info')) {
  const { answer } = await call('getWebhookInfo')
  const result = typeof answer === 'object' && answer !== null && 'result' in answer ? answer.result : {}
  const info = typeof result === 'object' && result !== null ? result : {}
  say(
    JSON.stringify({
      url: 'url' in info ? info.url : null,
      pending: 'pending_update_count' in info ? info.pending_update_count : null,
      lastError: 'last_error_message' in info ? info.last_error_message : null,
    }),
  )
  process.exit(0)
}

const results = [
  await call('setWebhook', {
    url: `${base}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  }),
  await call('setMyCommands', {
    commands: [
      { command: 'start', description: 'Connect: open the link from your wallet' },
      { command: 'stop', description: 'Disconnect this chat' },
    ],
  }),
  await call('setMyShortDescription', {
    short_description: 'Your Vitaquack robot tells you when it needs your OK or has paid.',
  }),
  await call('setMyDescription', {
    description:
      "I'm your Vitaquack robot. I message you when I want to buy something that needs your OK (you approve with World ID in your wallet, or deny here) and when I've paid. Connect from your wallet: your avatar → Connect Telegram.",
  }),
]
say(`webhook → ${base}/api/telegram/webhook`)
process.exit(results.every((result) => result.ok) ? 0 : 1)
