import { Implementation, toMetaMaskSmartAccount } from '@metamask/smart-accounts-kit'
import { hashDelegation } from '@metamask/smart-accounts-kit/utils'
import { decodeAbiParameters, keccak256, parseAbiParameters, toHex, zeroAddress } from 'viem'
import { expect, test } from 'vitest'
import { delegationDigest } from '@ethmumbai/protocol/Delegation'
import {
  buildGrant,
  challengeOf,
  encodeDeleGatorSignature,
  lowS,
  parseP256Signature,
  splitClientData,
  toKitDelegation,
} from '../src/index.ts'
import { keyId, makeAuthenticator, rpId, toDer } from './SoftwarePasskey.ts'
import { offlineClient } from './OfflineClient.ts'

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
  // The WebAuthn challenge is the EIP-712 digest (0x1901 ‖ domain ‖ struct hash), not the struct hash.
  const challenge = assertion.clientDataJSON.slice(prefix.length, assertion.clientDataJSON.length - suffix.length)
  expect(challenge).toBe(challengeOf(delegationDigest(grant)))
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
