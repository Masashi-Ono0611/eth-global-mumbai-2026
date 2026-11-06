import { catalogVersion } from '@ethmumbai/i18n'
import { Effect } from 'effect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import type { Features } from './Features.ts'

export const health = Effect.fn('EthMumbai.health')(function* (release: string, features: Features) {
  return yield* HttpServerResponse.json({ service: 'ethmumbai', status: 'ok', catalogVersion, release, features })
})
