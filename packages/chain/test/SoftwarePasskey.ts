import { hexToBytes, sha256, toHex } from 'viem'
import { toWebAuthnAccount } from 'viem/account-abstraction'

// A software WebAuthn authenticator (docs/research/spikes/wallet-accounts-v2-spike.ts.txt) standing in for a phone
// passkey: the kit signs a delegation through it, and our encoder must produce the same bytes from the raw assertion.
const subtle = globalThis.crypto.subtle
type GetFn = NonNullable<Parameters<typeof toWebAuthnAccount>[0]['getFn']>
export const rpId = 'vitaquack.example'
// The kit types keyId as Hex though it hashes it as a string; a 0x-prefixed id satisfies both without a cast.
export const keyId = '0x5a6d397659574679'
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
const derInteger = (value: Uint8Array) => {
  let start = 0
  while (start < value.length - 1 && value[start] === 0) start++
  const trimmed = value.slice(start)
  const body = (trimmed[0] ?? 0) & 0x80 ? Uint8Array.from([0, ...trimmed]) : trimmed
  return Uint8Array.from([0x02, body.length, ...body])
}
export const toDer = (raw: Uint8Array) => {
  const r = derInteger(raw.slice(0, 32))
  const s = derInteger(raw.slice(32))
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s])
}

export const makeAuthenticator = async () => {
  const keyPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const publicKey = new Uint8Array(await subtle.exportKey('raw', keyPair.publicKey))
  const captured: { authenticatorData: Uint8Array; clientDataJSON: string; signature: Uint8Array }[] = []
  const getFn: GetFn = async (options) => {
    const source = options?.publicKey?.challenge
    const challenge = ArrayBuffer.isView(source)
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      : new Uint8Array(source ?? new ArrayBuffer(0))
    const clientDataJSON = `{"type":"webauthn.get","challenge":"${base64url(challenge)}","origin":"https://${rpId}","crossOrigin":false}`
    const clientData = new TextEncoder().encode(clientDataJSON)
    const authenticatorData = Uint8Array.from([...hexToBytes(sha256(new TextEncoder().encode(rpId))), 0x05, 0, 0, 0, 1])
    const message = Uint8Array.from([...authenticatorData, ...hexToBytes(sha256(clientData))])
    const signature = toDer(
      new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, message)),
    )
    captured.push({ authenticatorData, clientDataJSON, signature })
    const credential = {
      id: keyId,
      rawId: new TextEncoder().encode(keyId).buffer,
      type: 'public-key',
      response: {
        authenticatorData: authenticatorData.buffer,
        clientDataJSON: clientData.buffer,
        signature: signature.buffer,
      },
      getClientExtensionResults: () => ({}),
    }
    return credential
  }
  const account = toWebAuthnAccount({
    credential: { id: keyId, publicKey: toHex(publicKey) },
    getFn,
    rpId,
  })
  /** One assertion over raw challenge bytes, as the browser hands it to the server (DER signature). */
  const assert = async (challenge: Uint8Array) => {
    await getFn({ publicKey: { challenge } })
    const assertion = captured.at(-1)
    if (assertion === undefined) throw new Error('authenticator was not called')
    return assertion
  }
  return {
    account,
    publicKey,
    captured,
    assert,
    x: BigInt(toHex(publicKey.slice(1, 33))),
    y: BigInt(toHex(publicKey.slice(33))),
  }
}
