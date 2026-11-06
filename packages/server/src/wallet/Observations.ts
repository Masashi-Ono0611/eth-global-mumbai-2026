import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Effect, Option, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { CurrentSession, requireSession } from '../auth/Session.ts'
import { jsonError, notConfigured } from '../Respond.ts'
import { evidenceObservation, observationsOf } from '../robot/Observations.ts'
import { firstRow } from '../Sql.ts'
import type { WalletDeps } from './Deps.ts'

/**
 * What the robot saw: the chip-signed JPEG crop of the QR it scanned to start an errand (`observations`, written by the
 * chip's scan route in `robot/Observations.ts`). The image is owner-private in R2; only its hash and the chip's
 * signature go into the episode evidence.
 */
export const observationsOfEpisode = (database: QueryDatabaseClient, episodeId: string) =>
  Effect.map(observationsOf(database, episodeId), (rows) =>
    rows.map((row) => ({ kind: 'qr_crop' as const, ...evidenceObservation(row) })),
  )

export type ObservationView = Effect.Success<ReturnType<typeof observationsOfEpisode>>[number]

const ImagePath = Schema.Struct({
  id: Schema.String.check(Schema.isMaxLength(64)),
  sha256: Schema.String.check(Schema.isPattern(/^0x[0-9a-f]{64}$/)),
})

/**
 * `GET /api/wallet/episodes/:id/observations/:sha256` → the JPEG, streamed from R2 to the errand's owner only (another
 * owner, an unknown hash and a missing object are all 404), never cached by anything between.
 */
const observationImage = (deps: WalletDeps) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    const path = yield* HttpRouter.schemaPathParams(ImagePath).pipe(Effect.option)
    if (Option.isNone(path)) return yield* jsonError(404, 'unknown observation')
    const owned = yield* firstRow(
      deps.database
        .prepare('SELECT id FROM episodes WHERE id = ? AND account_id = ?')
        .bind(path.value.id, session.accountId),
      Schema.Struct({ id: Schema.String }),
    )
    const row = Option.isNone(owned)
      ? Option.none()
      : Option.fromNullishOr(
          (yield* observationsOf(deps.database, path.value.id)).find(
            (entry) => entry.frame_sha256 === path.value.sha256,
          ),
        )
    if (Option.isNone(row)) return yield* jsonError(404, 'unknown observation')
    if (Option.isNone(deps.media)) return yield* notConfigured('MEDIA')
    const object = yield* deps.media.value.get(row.value.r2_key).pipe(Effect.option)
    if (Option.isNone(object)) return yield* jsonError(502, 'R2 did not answer')
    if (object.value === null) return yield* jsonError(404, 'unknown observation')
    return HttpServerResponse.stream(object.value.body, {
      contentType: 'image/jpeg',
      headers: {
        'cache-control': 'private, no-store',
        'content-length': String(object.value.size),
        'x-content-type-options': 'nosniff',
      },
    })
  })

export const observationRoutes = (deps: WalletDeps) =>
  HttpRouter.add('GET', '/api/wallet/episodes/:id/observations/:sha256', requireSession(observationImage(deps)))
