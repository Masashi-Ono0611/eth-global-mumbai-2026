import { Implementation, toMetaMaskSmartAccount } from '@metamask/smart-accounts-kit'
import { hashDelegation } from '@metamask/smart-accounts-kit/utils'
import {
  createPublicClient,
  custom,
  decodeAbiParameters,
  hexToBytes,
  keccak256,
  parseAbiParameters,
  sha256,
  toHex,
  zeroAddress,
} from 'viem'
import { toWebAuthnAccount } from 'viem/account-abstraction'
import { expect, test } from 'vitest'
import {
  arcChain,
  buildGrant,
  challengeOf,
  encodeDeleGatorSignature,
  lowS,
  parseP256Signature,
  splitClientData,
  toKitDelegation,
} from '../src/index.ts'

// A software WebAuthn authenticator (docs/research/spikes/wallet-accounts-v2-spike.ts.txt) standing in for a phone
// passkey: the kit signs a delegation through it, and our encoder must produce the same bytes from the raw assertion.
const subtle = globalThis.crypto.subtle
type GetFn = NonNullable<Parameters<typeof toWebAuthnAccount>[0]['getFn']>
const rpId = 'vitaquack.example'
// The kit types keyId as Hex though it hashes it as a string; a 0x-prefixed id satisfies both without a cast.
const keyId = '0x5a6d397659574679'
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
const toDer = (raw: Uint8Array) => {
  const r = derInteger(raw.slice(0, 32))
  const s = derInteger(raw.slice(32))
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s])
}

const makeAuthenticator = async () => {
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
  return { account, publicKey, captured }
}

const offlineClient = createPublicClient({
  chain: arcChain,
  transport: custom({
    request: async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return toHex(5042)
      if (method === 'eth_getCode') return '0x'
      throw new Error(`offline test client: ${method}`)
    },
  }),
})

test('encodeDeleGatorSignature equals the kit’s passkey signature for the same assertion', async () => {
  const authenticator = await makeAuthenticator()
  const x = BigInt(toHex(authenticator.publicKey.slice(1, 33)))
  const y = BigInt(toHex(authenticator.publicKey.slice(33)))
  const owner = await toMetaMaskSmartAccount({
    client: offlineClient,
    implementation: Implementation.Hybrid,
    deployParams: [zeroAddress, [keyId], [x], [y]],
    deploySalt: keccak256(toHex('aaaaaaaaaaaaaaaaaaaaaaaaaa')),
    signer: { webAuthnAccount: authenticator.account, keyId },
  })
  const grant = buildGrant({
    grantId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
    owner: owner.address,
    chip: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    dailyCap: 1_000_000n,
    perPaymentCap: 300_000n,
    allowlist: ['0x000000000000000000000000000000000000c0de'],
    startAt: 1_794_000_000,
    expiresAt: 1_794_086_400,
    enforcer: '0x00000000000000000000000000000000000e4f01',
    approver: '0x00000000000000000000000000000000000a9901',
  })
  const kitSignature = await owner.signDelegation({ delegation: toKitDelegation({ ...grant, signature: '0x' }) })
  const assertion = authenticator.captured.at(-1)
  if (assertion === undefined) throw new Error('authenticator was not called')
  expect(encodeDeleGatorSignature({ keyId, ...assertion })).toBe(kitSignature)
  // The passkey signed the EIP-712 digest of the delegation, and the challenge split carries it verbatim.
  const [prefix, suffix] = splitClientData(assertion.clientDataJSON)
  expect(prefix).toBe('{"type":"webauthn.get","challenge":"')
  expect(suffix).toBe(`","origin":"https://${rpId}","crossOrigin":false}`)
  const decoded = decodeAbiParameters(
    parseAbiParameters('bytes32, uint256, uint256, bytes, bool, string, string, uint256'),
    kitSignature,
  )
  expect(decoded[0]).toBe(keccak256(toHex(keyId)))
  expect(decoded[4]).toBe(true)
  expect(decoded[7]).toBe(1n)
  expect(hashDelegation(toKitDelegation({ ...grant, signature: '0x' }))).toMatch(/^0x[0-9a-f]{64}$/)
})

test('DER and raw signatures parse alike; s is normalised low', () => {
  const raw = Uint8Array.from({ length: 64 }, (_, index) => (index === 32 ? 0xff : index + 1))
  const fromRaw = parseP256Signature(raw)
  expect(parseP256Signature(toDer(raw))).toEqual(fromRaw)
  const n = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
  expect(lowS(fromRaw.s)).toBe(n - fromRaw.s)
  expect(lowS(5n)).toBe(5n)
  expect(() => parseP256Signature(Uint8Array.from([0x30, 3, 2, 1]))).toThrow()
  expect(challengeOf('0x00ff')).toBe('AP8')
})
