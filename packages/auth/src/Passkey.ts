import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server'
import { decodeClientDataJSON, isoCBOR } from '@simplewebauthn/server/helpers'
import { Effect, Result, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as Base64Url from 'effect/encoding/Base64Url'
import { es256, type AssertionRequest, type RegistrationRequest } from './config.ts'
import { fromHex, pointFromSpki, type P256Point, toHex } from './Spki.ts'

/** Why a ceremony was refused. `detail` is the verifier's message (origins, rp ids, flags); it never holds key material. */
export class PasskeyRejected extends Schema.TaggedError<PasskeyRejected>()('PasskeyRejected', {
  reason: Schema.Literals(['malformed', 'algorithm', 'public-key', 'verification']),
  detail: Schema.String,
}) {}

/** Where a ceremony must have happened: derived at runtime from `AUTH_ORIGIN`. */
export type RelyingParty = { readonly origin: string; readonly rpId: string }

export const relyingPartyFromOrigin = (authOrigin: string): RelyingParty => {
  const url = new URL(authOrigin)
  return { origin: url.origin, rpId: url.hostname }
}

/** A verified new credential, ready to store: the SPKI as base64, the point as hex. */
export type VerifiedPasskey = P256Point & {
  readonly credentialId: string
  readonly alg: number
  readonly spki: string
  readonly signCount: number
}

/** A stored credential as the assertion verifier needs it. */
export type StoredPasskey = P256Point & { readonly credentialId: string; readonly signCount: number }

const rejected = (reason: PasskeyRejected['reason']) => (cause: unknown) =>
  PasskeyRejected.make({ reason, detail: cause instanceof Error ? cause.message : 'unknown' })

const bytes = (text: string) =>
  Result.match(Base64Url.decode(text), {
    onFailure: () => Effect.fail(PasskeyRejected.make({ reason: 'malformed', detail: 'base64url' })),
    onSuccess: (value) => Effect.succeed(value),
  })

/** The challenge the client signed, read from its clientDataJSON before the stored challenge is consumed. */
export const clientChallenge = (clientDataJSON: string) =>
  Effect.try({ try: () => decodeClientDataJSON(clientDataJSON).challenge, catch: rejected('malformed') }).pipe(
    Effect.filterOrFail(
      (challenge) => /^[A-Za-z0-9_-]{16,128}$/.test(challenge),
      () => PasskeyRejected.make({ reason: 'malformed', detail: 'challenge' }),
    ),
  )

/** The COSE_Key (EC2, ES256, P-256) of a stored point, the form `verifyAuthenticationResponse` checks against. */
const coseKey = (point: P256Point) =>
  isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, es256],
      [-1, 1],
      [-2, fromHex(point.x)],
      [-3, fromHex(point.y)],
    ]),
  )

const coseCoordinates = (cose: Uint8Array<ArrayBuffer>) =>
  Effect.try({
    try: () => isoCBOR.decodeFirst<Map<number, unknown>>(cose),
    catch: rejected('public-key'),
  }).pipe(
    Effect.flatMap((key) => {
      const x = key.get(-2)
      const y = key.get(-3)
      return key.get(1) === 2 &&
        key.get(3) === es256 &&
        key.get(-1) === 1 &&
        x instanceof Uint8Array &&
        y instanceof Uint8Array
        ? Effect.succeed({ x: toHex(x), y: toHex(y) })
        : Effect.fail(PasskeyRejected.make({ reason: 'algorithm', detail: 'not an ES256 P-256 key' }))
    }),
  )

/** Verifies `navigator.credentials.create` output: challenge, origin, rp id hash, UV, ES256, and that the
 * browser's SPKI is the same key the authenticator attested. */
export const verifyRegistration = Effect.fn('EthMumbai.Auth.verifyRegistration')(function* (input: {
  readonly request: RegistrationRequest
  readonly expectedChallenge: string
  readonly relyingParty: RelyingParty
}) {
  const { request, relyingParty } = input
  if (request.publicKeyAlgorithm !== es256)
    return yield* PasskeyRejected.make({ reason: 'algorithm', detail: `alg ${request.publicKeyAlgorithm}` })
  const verified = yield* Effect.tryPromise({
    try: () =>
      verifyRegistrationResponse({
        response: {
          id: request.credentialId,
          rawId: request.credentialId,
          type: 'public-key',
          clientExtensionResults: {},
          response: {
            clientDataJSON: request.clientDataJSON,
            attestationObject: request.attestationObject,
            authenticatorData: request.authenticatorData,
            publicKey: request.publicKeySpki,
            publicKeyAlgorithm: request.publicKeyAlgorithm,
          },
        },
        expectedChallenge: input.expectedChallenge,
        expectedOrigin: relyingParty.origin,
        expectedRPID: relyingParty.rpId,
        requireUserVerification: true,
        supportedAlgorithmIDs: [es256],
      }),
    catch: rejected('verification'),
  })
  if (!verified.verified) return yield* PasskeyRejected.make({ reason: 'verification', detail: 'not verified' })
  const { credential } = verified.registrationInfo
  const attested = yield* coseCoordinates(credential.publicKey)
  const spki = yield* bytes(request.publicKeySpki)
  const claimed = yield* pointFromSpki(spki).pipe(Effect.mapError(rejected('public-key')))
  if (claimed.x !== attested.x || claimed.y !== attested.y)
    return yield* PasskeyRejected.make({ reason: 'public-key', detail: 'SPKI differs from the attested key' })
  return {
    credentialId: credential.id,
    alg: es256,
    spki: Base64.encode(spki),
    signCount: credential.counter,
    ...attested,
  } satisfies VerifiedPasskey
})

/** Verifies a `navigator.credentials.get` assertion over `expectedChallenge` (a login challenge or a grant hash):
 * origin, rp id hash, UV, the signature, and a counter that moved forward unless both are 0. */
export const verifyAssertion = Effect.fn('EthMumbai.Auth.verifyAssertion')(function* (input: {
  readonly request: AssertionRequest
  readonly expectedChallenge: string
  readonly relyingParty: RelyingParty
  readonly passkey: StoredPasskey
}) {
  const { request, relyingParty, passkey } = input
  if (request.credentialId !== passkey.credentialId)
    return yield* PasskeyRejected.make({ reason: 'verification', detail: 'credential' })
  const verified = yield* Effect.tryPromise({
    try: () =>
      verifyAuthenticationResponse({
        response: {
          id: request.credentialId,
          rawId: request.credentialId,
          type: 'public-key',
          clientExtensionResults: {},
          response: {
            clientDataJSON: request.clientDataJSON,
            authenticatorData: request.authenticatorData,
            signature: request.signature,
          },
        },
        expectedChallenge: input.expectedChallenge,
        expectedOrigin: relyingParty.origin,
        expectedRPID: relyingParty.rpId,
        credential: { id: passkey.credentialId, publicKey: coseKey(passkey), counter: passkey.signCount },
        requireUserVerification: true,
      }),
    catch: rejected('verification'),
  })
  if (!verified.verified) return yield* PasskeyRejected.make({ reason: 'verification', detail: 'not verified' })
  return { signCount: verified.authenticationInfo.newCounter }
})
