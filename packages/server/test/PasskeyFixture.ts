import type { AssertionRequest, RegistrationRequest } from '@ethmumbai/auth'
import { Effect, Schema } from 'effect'
import * as Base64Url from 'effect/encoding/Base64Url'
import * as HttpBody from 'effect/http/HttpBody'
import * as HttpClient from 'effect/http/HttpClient'
import type * as HttpClientResponse from 'effect/http/HttpClientResponse'

/** A software WebAuthn authenticator (P-256, attestation "none") for tests: it produces exactly the bytes a platform
 * authenticator returns, and lets a test break one property at a time (origin, rp id, UV flag, counter, key). */

type CborValue = number | string | Uint8Array | ReadonlyMap<number | string, CborValue>

const header = (major: number, length: number): number[] => {
  if (length < 24) return [(major << 5) | length]
  if (length < 0x100) return [(major << 5) | 24, length]
  return [(major << 5) | 25, length >> 8, length & 0xff]
}

/** The CBOR subset WebAuthn uses: small ints, byte and text strings, maps. */
const cbor = (value: CborValue): Uint8Array => {
  if (typeof value === 'number') return Uint8Array.from(value >= 0 ? header(0, value) : header(1, -1 - value))
  if (typeof value === 'string') {
    const text = new TextEncoder().encode(value)
    return Uint8Array.from([...header(3, text.length), ...text])
  }
  if (value instanceof Uint8Array) return Uint8Array.from([...header(2, value.length), ...value])
  const entries = [...value.entries()].flatMap(([key, item]) => [...cbor(key), ...cbor(item)])
  return Uint8Array.from([...header(5, value.size), ...entries])
}

const sha256 = async (bytes: Uint8Array) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))

const uint32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]

/** WebCrypto signs P-256 as r ‖ s; WebAuthn carries an ASN.1 DER `SEQUENCE { INTEGER r, INTEGER s }`. */
const derInteger = (bytes: Uint8Array) => {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1
  const trimmed = bytes.subarray(start)
  const padded = (trimmed[0] ?? 0) & 0x80 ? [0, ...trimmed] : [...trimmed]
  return [0x02, padded.length, ...padded]
}

const derSignature = (raw: Uint8Array): Uint8Array => {
  const body = [...derInteger(raw.subarray(0, 32)), ...derInteger(raw.subarray(32))]
  return Uint8Array.from([0x30, body.length, ...body])
}

export const flags = { userPresent: 0x01, userVerified: 0x04, attestedData: 0x40 } as const

export type Ceremony = {
  readonly origin: string
  readonly rpId?: string
  /** Authenticator data flags; defaults to UP | UV (plus AT on registration). */
  readonly flags?: number
  /** Forces the signature counter instead of incrementing it. */
  readonly counter?: number
}

const rpIdHash = (ceremony: Ceremony) =>
  sha256(new TextEncoder().encode(ceremony.rpId ?? new URL(ceremony.origin).hostname))

const clientData = (type: string, challenge: string, origin: string) =>
  new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }))

export const makeSoftwareAuthenticator = async (options: { readonly countSignatures?: boolean } = {}) => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey))
  const rawId = crypto.getRandomValues(new Uint8Array(16))
  const credentialId = Base64Url.encode(rawId)
  let counter = 0
  const nextCounter = (forced: number | undefined) => {
    if (forced !== undefined) return forced
    if (options.countSignatures === true) counter += 1
    return counter
  }
  const coseKey = () => {
    const point = spki.subarray(27)
    return cbor(
      new Map<number, CborValue>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, point.subarray(0, 32)],
        [-3, point.subarray(32, 64)],
      ]),
    )
  }
  return {
    credentialId,
    spki,
    register: async (
      challenge: string,
      ceremony: Ceremony & { readonly spki?: Uint8Array },
    ): Promise<RegistrationRequest> => {
      const authenticatorData = Uint8Array.from([
        ...(await rpIdHash(ceremony)),
        ceremony.flags ?? flags.userPresent | flags.userVerified | flags.attestedData,
        ...uint32(nextCounter(ceremony.counter)),
        ...new Uint8Array(16),
        rawId.length >> 8,
        rawId.length & 0xff,
        ...rawId,
        ...coseKey(),
      ])
      const attestationObject = cbor(
        new Map<string, CborValue>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authenticatorData],
        ]),
      )
      return {
        credentialId,
        clientDataJSON: Base64Url.encode(clientData('webauthn.create', challenge, ceremony.origin)),
        attestationObject: Base64Url.encode(attestationObject),
        publicKeySpki: Base64Url.encode(ceremony.spki ?? spki),
        publicKeyAlgorithm: -7,
        authenticatorData: Base64Url.encode(authenticatorData),
      }
    },
    assert: async (challenge: string, ceremony: Ceremony): Promise<AssertionRequest> => {
      const authenticatorData = Uint8Array.from([
        ...(await rpIdHash(ceremony)),
        ceremony.flags ?? flags.userPresent | flags.userVerified,
        ...uint32(nextCounter(ceremony.counter)),
      ])
      const clientDataJSON = clientData('webauthn.get', challenge, ceremony.origin)
      const signed = Uint8Array.from([...authenticatorData, ...(await sha256(clientDataJSON))])
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, signed))
      return {
        credentialId,
        clientDataJSON: Base64Url.encode(clientDataJSON),
        authenticatorData: Base64Url.encode(authenticatorData),
        signature: Base64Url.encode(derSignature(raw)),
      }
    },
  }
}
export type SoftwareAuthenticator = Awaited<ReturnType<typeof makeSoftwareAuthenticator>>

/** A same-origin JSON POST, as the app's own pages send it. */
export const passkeyCall =
  (appUrl: string) =>
  (path: string, body: unknown, cookie = '') =>
    HttpClient.post(`${appUrl}${path}`, {
      headers: { origin: new URL(appUrl).origin, 'content-type': 'application/json', cookie },
      body: HttpBody.text(JSON.stringify(body), 'application/json'),
    })

/** The `name=value` pair of the session cookie a response set. */
export const sessionCookie = (response: HttpClientResponse.HttpClientResponse) => {
  const cookie = response.cookies.cookies['vq_session']
  if (cookie === undefined) throw new Error('response set no vq_session cookie')
  return `vq_session=${cookie.value}`
}

/** Runs the whole registration ceremony against the Worker with a software authenticator. */
export const registerPasskey = (appUrl: string, authenticator: SoftwareAuthenticator, displayName: string) =>
  Effect.gen(function* () {
    const call = passkeyCall(appUrl)
    const options = yield* call('/api/passkeys/register/options', { displayName })
    const { challenge, rp } = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ challenge: Schema.String, rp: Schema.Struct({ id: Schema.String }) }),
    )(yield* options.json)
    const request = yield* Effect.promise(() =>
      authenticator.register(challenge, { origin: new URL(appUrl).origin, rpId: rp.id }),
    )
    return { response: yield* call('/api/passkeys/register/verify', request), request }
  })
