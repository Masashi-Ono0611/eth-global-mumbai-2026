import {
  type AssertionOptions,
  type AssertionRequest,
  type RegistrationOptions,
  type RegistrationRequest,
} from '@ethmumbai/auth/config'
import { Context, Effect, Layer, Result, Schema } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'

/** The passkey prompt was dismissed, timed out, or this device cannot make an ES256 passkey. */
export class PasskeyFailed extends Schema.TaggedError<PasskeyFailed>()('PasskeyFailed', {
  reason: Schema.Literals(['dismissed', 'unsupported', 'malformed']),
}) {}

/** A passkey assertion request: a login (any discoverable credential) or a signature by one known credential. */
export type AssertionPrompt = AssertionOptions & { readonly allowCredentials?: ReadonlyArray<string> }

/** The browser's WebAuthn ceremonies. Commands call it; views never do. The private key never leaves the authenticator. */
export class Passkeys extends Context.Service<
  Passkeys,
  {
    readonly create: (options: RegistrationOptions) => Effect.Effect<RegistrationRequest, PasskeyFailed>
    readonly get: (options: AssertionPrompt) => Effect.Effect<AssertionRequest, PasskeyFailed>
  }
>()('@ethmumbai/web/Passkeys') {}

const encode = (buffer: ArrayBuffer): string => Base64Url.encode(new Uint8Array(buffer))

const decode = (text: string) =>
  Result.match(Base64Url.decode(text), {
    onFailure: () => Effect.fail(PasskeyFailed.make({ reason: 'malformed' })),
    onSuccess: (bytes) => Effect.succeed(Uint8Array.from(bytes)),
  })

const dismissed = (cause: unknown) =>
  PasskeyFailed.make({
    reason: cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'dismissed' : 'unsupported',
  })

/** `navigator.credentials` as the wallet uses it: ES256 only, resident keys, user verification required. */
export const passkeysLayer = (navigator: Navigator) =>
  Layer.succeed(
    Passkeys,
    Passkeys.of({
      create: (options) =>
        Effect.gen(function* () {
          const challenge = yield* decode(options.challenge)
          const userId = yield* decode(options.user.id)
          const credential = yield* Effect.tryPromise({
            try: () =>
              navigator.credentials.create({
                publicKey: {
                  challenge,
                  rp: options.rp,
                  user: { id: userId, name: options.user.name, displayName: options.user.name },
                  pubKeyCredParams: options.pubKeyCredParams.map((parameter) => ({ ...parameter })),
                  authenticatorSelection: { ...options.authenticatorSelection },
                  attestation: options.attestation,
                  timeout: options.timeout,
                },
              }),
            catch: dismissed,
          })
          if (
            !(credential instanceof PublicKeyCredential) ||
            !(credential.response instanceof AuthenticatorAttestationResponse)
          ) {
            return yield* PasskeyFailed.make({ reason: 'unsupported' })
          }
          const { response } = credential
          const spki = response.getPublicKey()
          if (spki === null) return yield* PasskeyFailed.make({ reason: 'unsupported' })
          return {
            credentialId: encode(credential.rawId),
            clientDataJSON: encode(response.clientDataJSON),
            attestationObject: encode(response.attestationObject),
            publicKeySpki: encode(spki),
            publicKeyAlgorithm: response.getPublicKeyAlgorithm(),
            authenticatorData: encode(response.getAuthenticatorData()),
          }
        }),
      get: (options) =>
        Effect.gen(function* () {
          const challenge = yield* decode(options.challenge)
          const allowCredentials = yield* Effect.forEach(options.allowCredentials ?? [], (id) =>
            Effect.map(decode(id), (bytes): PublicKeyCredentialDescriptor => ({ type: 'public-key', id: bytes })),
          )
          const credential = yield* Effect.tryPromise({
            try: () =>
              navigator.credentials.get({
                publicKey: {
                  challenge,
                  rpId: options.rpId,
                  userVerification: options.userVerification,
                  timeout: options.timeout,
                  allowCredentials,
                },
              }),
            catch: dismissed,
          })
          if (
            !(credential instanceof PublicKeyCredential) ||
            !(credential.response instanceof AuthenticatorAssertionResponse)
          ) {
            return yield* PasskeyFailed.make({ reason: 'unsupported' })
          }
          return {
            credentialId: encode(credential.rawId),
            clientDataJSON: encode(credential.response.clientDataJSON),
            authenticatorData: encode(credential.response.authenticatorData),
            signature: encode(credential.response.signature),
          }
        }),
    }),
  )

/** For scene tests and headless screenshots, where no authenticator exists: fixed, well-formed answers. */
export const fixturePasskeysLayer = Layer.succeed(
  Passkeys,
  Passkeys.of({
    create: () =>
      Effect.succeed({
        credentialId: 'Zml4dHVyZS1jcmVkZW50aWFs',
        clientDataJSON: 'e30',
        attestationObject: 'oA',
        publicKeySpki: 'AA',
        publicKeyAlgorithm: -7,
        authenticatorData: 'AA',
      }),
    get: () =>
      Effect.succeed({
        credentialId: 'Zml4dHVyZS1jcmVkZW50aWFs',
        clientDataJSON: 'e30',
        authenticatorData: 'AA',
        signature: 'AA',
      }),
  }),
)
