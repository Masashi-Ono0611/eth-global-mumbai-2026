import { readFileSync } from 'node:fs'
import { Console, Effect, Option, Redacted, Result } from 'effect'
import { findMerchant } from '../src/merchant/Catalogue.ts'
import { MERCHANT_ID } from '../src/robot/Start.ts'
import { hear } from '../src/robot/Voice.ts'

// One real 0G hearing, exactly as a voice turn makes it: the clip to whisper, its transcript to 0GM, the reply parsed.
// Usage: APP_ZG_BASE_URL=… APP_ZG_API_KEY=… bun packages/server/scripts/voice-probe.ts <clip.wav> [<intent>[:<item or topic>]]
// e.g. `clip.wav buy:chai`, `clip.wav question:limits`, `clip.wav stop`. Prints the transcript, the turn, both request
// ids, the providers (for a TEE check with 0G's SDK) and the latencies; never the key. The transcript goes to the
// operator's own terminal for the operator's own clip (the Worker still never logs one). Exit 0 on the expected turn
// (or any turn without an expectation), 3 on another, 1 when the hearing failed, 2 when not configured.

const [clipPath, expectation] = process.argv.slice(2)
const baseUrl = process.env['APP_ZG_BASE_URL']
const apiKey = process.env['APP_ZG_API_KEY']

const probe = Effect.gen(function* () {
  if (baseUrl === undefined || apiKey === undefined || clipPath === undefined) {
    yield* Console.error('needs APP_ZG_BASE_URL, APP_ZG_API_KEY and a WAV clip path')
    return 2
  }
  const merchant = Option.getOrUndefined(findMerchant(MERCHANT_ID))
  if (merchant === undefined) return 2
  const audio = `data:audio/wav;base64,${readFileSync(clipPath).toString('base64')}`
  const config = { baseUrl, apiKey: Redacted.make(apiKey), model: 'unused-by-the-hearing' }
  const result = yield* hear(config, audio, merchant.items).pipe(Effect.result)
  if (Result.isFailure(result)) {
    yield* Console.error(`failed  ${result.failure.status} ${result.failure.error}`)
    return 1
  }
  const turn = result.success
  const detail = turn.intent === 'buy' ? (turn.item ?? 'off the menu') : turn.intent === 'question' ? turn.topic : ''
  yield* Console.log(`heard   ${turn.heard}`)
  yield* Console.log(`turn    ${turn.intent}${detail === '' ? '' : `:${detail}`}`)
  yield* Console.log(
    `whisper ${turn.transcribeMs} ms  request ${turn.transcribeRequestId ?? '-'}  provider ${turn.transcribeProvider ?? '-'}`,
  )
  yield* Console.log(`0gm     ${turn.latencyMs} ms  request ${turn.requestId ?? '-'}  brain ${turn.provider}`)
  if (expectation === undefined) return 0
  return expectation === `${turn.intent}${detail === '' ? '' : `:${detail}`}` ? 0 : 3
})

process.exit(await Effect.runPromise(probe))
