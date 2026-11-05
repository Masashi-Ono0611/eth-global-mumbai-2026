import { catalogVersion } from '@styld/i18n'
import { Effect } from 'effect'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'

export const health = Effect.fn('Styld.health')(function* (release: string) {
  return yield* HttpServerResponse.json({ service: 'styldappv2', status: 'ok', catalogVersion, release })
})
