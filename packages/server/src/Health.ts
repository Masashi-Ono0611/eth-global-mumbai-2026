import { catalogVersion } from '@ethmumbai/i18n'
import { Effect } from 'effect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'

export const health = Effect.fn('EthMumbai.health')(function* (release: string) {
  return yield* HttpServerResponse.json({ service: 'ethmumbai', status: 'ok', catalogVersion, release })
})
