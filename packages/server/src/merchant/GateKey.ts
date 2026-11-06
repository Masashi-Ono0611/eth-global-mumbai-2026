import { Effect, Option, Result, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as Base64Url from 'effect/encoding/Base64Url'
import * as Hex from 'effect/encoding/Hex'
import * as HttpRouter from 'effect/http/HttpRouter'
import { findMerchant } from './Catalogue.ts'
import { json, jsonError, notConfigured } from '../Respond.ts'

/** `APP_GATE_ED25519_SEED`: 32 bytes as hex (an optional `0x` prefix is accepted). */
export const GateSeed = Schema.String.check(Schema.isPattern(/^(0x)?[0-9a-fA-F]{64}$/))

/** PKCS#8 wrapper for a raw Ed25519 seed (RFC 8410). */
const pkcs8Prefix = '302e020100300506032b657004220420'

export interface GateSigner {
  /** Raw 32-byte public key, base64. */
  readonly publicKey: string
  /** Ed25519 signature over the UTF-8 message, base64. */
  readonly sign: (message: string) => Effect.Effect<string>
}

const JwkPublic = Schema.Struct({ x: Schema.String })

/** Import the gate's signing key once per isolate; the seed never leaves this function. */
export const makeGateSigner = Effect.fnUntraced(function* (seed: string) {
  const der = Uint8Array.from(Result.getOrThrow(Hex.decode(`${pkcs8Prefix}${seed.replace(/^0x/, '').toLowerCase()}`)))
  const key = yield* Effect.promise(() => crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, true, ['sign']))
  const jwk = yield* Effect.promise(() => crypto.subtle.exportKey('jwk', key))
  const { x } = yield* Schema.decodeUnknownEffect(JwkPublic)(jwk).pipe(Effect.orDie)
  const publicKey = Base64.encode(Result.getOrThrow(Base64Url.decode(x)))
  const sign = (message: string) =>
    Effect.promise(() => crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(message))).pipe(
      Effect.map((signature) => Base64.encode(new Uint8Array(signature))),
    )
  return { publicKey, sign } satisfies GateSigner
})

/** `GET /api/merchants/:id/gate-key` → `{"alg":"ed25519","publicKey":"<base64>"}`. */
export const gateKeyRoute = (signer: Option.Option<GateSigner>) =>
  HttpRouter.add(
    'GET',
    '/api/merchants/:merchantId/gate-key',
    Effect.gen(function* () {
      const { merchantId } = yield* HttpRouter.params
      if (Option.isNone(findMerchant(merchantId ?? ''))) return yield* jsonError(404, 'unknown merchant')
      if (Option.isNone(signer)) return yield* notConfigured('GATE_ED25519_SEED')
      return yield* json({ alg: 'ed25519', publicKey: signer.value.publicKey })
    }),
  )
