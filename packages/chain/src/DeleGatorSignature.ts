import { bytesToHex, encodeAbiParameters, type Hex, hexToBytes, keccak256, parseAbiParameters, stringToHex } from 'viem'

// The HybridDeleGator's WebAuthn signature (MetaMask kit `encodeDeleGatorSignature`):
// abi.encode(bytes32 keccak256(keyId), uint256 r, uint256 lowS, bytes authenticatorData, bool userVerified,
//            string clientDataJSON before the challenge, string clientDataJSON after it, uint256 index of '"type":').
const SIGNATURE_PARAMS = parseAbiParameters('bytes32, uint256, uint256, bytes, bool, string, string, uint256')
const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
const UV_FLAG = 0x04

const readInteger = (der: Uint8Array, offset: number): { value: bigint; next: number } => {
  if (der[offset] !== 0x02) throw new Error('DER: expected INTEGER')
  const length = der[offset + 1] ?? 0
  const bytes = der.slice(offset + 2, offset + 2 + length)
  if (bytes.length !== length || length === 0 || length > 33) throw new Error('DER: bad INTEGER length')
  return { value: BigInt(bytesToHex(bytes)), next: offset + 2 + length }
}

/** WebAuthn ES256 signatures are ASN.1 DER `SEQUENCE { INTEGER r, INTEGER s }`; 64-byte raw `r‖s` is accepted too. */
export const parseP256Signature = (signature: Uint8Array): { r: bigint; s: bigint } => {
  if (signature.length === 64)
    return { r: BigInt(bytesToHex(signature.slice(0, 32))), s: BigInt(bytesToHex(signature.slice(32))) }
  if (signature[0] !== 0x30 || (signature[1] ?? 0) + 2 !== signature.length) throw new Error('DER: expected SEQUENCE')
  const r = readInteger(signature, 2)
  const s = readInteger(signature, r.next)
  if (s.next !== signature.length) throw new Error('DER: trailing bytes')
  return { r: r.value, s: s.value }
}

export const lowS = (s: bigint) => (s > P256_N / 2n ? P256_N - s : s)

export type WebAuthnAssertion = {
  /** The credential id as registered on the account (base64url), the Hybrid's `keyId`. */
  readonly keyId: string
  readonly authenticatorData: Uint8Array
  /** The exact UTF-8 clientDataJSON the authenticator signed. */
  readonly clientDataJSON: string
  /** DER or raw `r‖s`. */
  readonly signature: Uint8Array
}

/** Splits clientDataJSON around its `challenge` value (the kit's `splitOnChallenge`). */
export const splitClientData = (clientDataJSON: string): readonly [string, string] => {
  const match = /"challenge":"([^"]+)"/.exec(clientDataJSON)
  const challenge = match?.[1]
  if (challenge === undefined) throw new Error('clientDataJSON has no challenge')
  const index = clientDataJSON.indexOf(challenge)
  return [clientDataJSON.slice(0, index), clientDataJSON.slice(index + challenge.length)]
}

/** The DeleGator signature bytes the DelegationManager hands to the account's `isValidSignature`. */
export const encodeDeleGatorSignature = (assertion: WebAuthnAssertion): Hex => {
  const { r, s } = parseP256Signature(assertion.signature)
  const flags = assertion.authenticatorData[32]
  if (flags === undefined) throw new Error('authenticatorData shorter than 33 bytes')
  const typeIndex = assertion.clientDataJSON.indexOf('"type":')
  if (typeIndex < 0) throw new Error('clientDataJSON has no type')
  const [prefix, suffix] = splitClientData(assertion.clientDataJSON)
  return encodeAbiParameters(SIGNATURE_PARAMS, [
    keccak256(stringToHex(assertion.keyId)),
    r,
    lowS(s),
    bytesToHex(assertion.authenticatorData),
    (flags & UV_FLAG) !== 0,
    prefix,
    suffix,
    BigInt(typeIndex),
  ])
}

/** The base64url (no padding) challenge a passkey must sign for a 32-byte hash (a delegation hash). */
export const challengeOf = (hash: Hex): string => {
  let binary = ''
  for (const byte of hexToBytes(hash)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
