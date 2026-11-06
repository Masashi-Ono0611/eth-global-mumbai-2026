import {
  type PasskeyRejected,
  relyingPartyFromOrigin,
  type VerifiedPasskey,
  verifyAssertion,
  verifyRegistration,
} from '@ethmumbai/auth'
import { Effect } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import { describe, expect, test } from 'vitest'
import { flags, makeSoftwareAuthenticator, type SoftwareAuthenticator } from './PasskeyFixture.ts'

const origin = 'https://vitaquack.test'
const relyingParty = relyingPartyFromOrigin(`${origin}/`)
const challenge = 'Y2hhbGxlbmdlLWZvci10aGUtdW5pdC10ZXN0LTMyYg'

/** 'accepted', or the reason the verifier refused. */
const outcome = (effect: Effect.Effect<unknown, PasskeyRejected>) =>
  Effect.runPromise(
    Effect.match(effect, { onSuccess: () => 'accepted', onFailure: (error) => `${error.reason}: ${error.detail}` }),
  )

const register = (request: Awaited<ReturnType<SoftwareAuthenticator['register']>>, expectedChallenge = challenge) =>
  outcome(verifyRegistration({ request, expectedChallenge, relyingParty }))

const registered = async (authenticator: SoftwareAuthenticator): Promise<VerifiedPasskey> =>
  Effect.runPromise(
    verifyRegistration({
      request: await authenticator.register(challenge, { origin }),
      expectedChallenge: challenge,
      relyingParty,
    }),
  )

describe('passkey registration (verifyRegistrationResponse)', () => {
  test('accepts an ES256 credential and stores the attested point', async () => {
    const authenticator = await makeSoftwareAuthenticator()
    const passkey = await registered(authenticator)
    expect(passkey.credentialId).toBe(authenticator.credentialId)
    expect(passkey.alg).toBe(-7)
    expect(passkey.signCount).toBe(0)
    expect(passkey.x).toMatch(/^0x[0-9a-f]{64}$/)
    expect(passkey.spki).toBe(Base64.encode(authenticator.spki))
    expect(relyingParty).toEqual({ origin, rpId: 'vitaquack.test' })
  })

  test('rejects a foreign origin, a foreign rp id hash, a missing UV flag, a different challenge and a swapped SPKI', async () => {
    const authenticator = await makeSoftwareAuthenticator()
    const other = await makeSoftwareAuthenticator()
    const refused = async (ceremony: Parameters<SoftwareAuthenticator['register']>[1], expected = challenge) =>
      register(await authenticator.register(challenge, ceremony), expected)
    expect(await refused({ origin: 'https://evil.test' })).toMatch(
      /^verification: Unexpected registration response origin/,
    )
    expect(await refused({ origin, rpId: 'evil.test' })).toMatch(/^verification: .*RP ID/)
    expect(await refused({ origin, flags: flags.userPresent | flags.attestedData })).toMatch(
      /^verification: User verification/,
    )
    expect(await refused({ origin }, 'b3RoZXItY2hhbGxlbmdl')).toMatch(
      /^verification: Unexpected registration response challenge/,
    )
    expect(await refused({ origin, spki: other.spki })).toBe('public-key: SPKI differs from the attested key')
    expect(await refused({ origin })).toBe('accepted')
  })
})

describe('passkey assertion (verifyAuthenticationResponse)', () => {
  test('verifies a login and reports the new counter', async () => {
    const authenticator = await makeSoftwareAuthenticator({ countSignatures: true })
    const passkey = await registered(authenticator)
    const request = await authenticator.assert(challenge, { origin })
    const result = await Effect.runPromise(
      verifyAssertion({ request, expectedChallenge: challenge, relyingParty, passkey }),
    )
    expect(result.signCount).toBe(2)
  })

  test('accepts counters that stay 0 on both sides (synced passkeys)', async () => {
    const authenticator = await makeSoftwareAuthenticator()
    const passkey = await registered(authenticator)
    const request = await authenticator.assert(challenge, { origin })
    expect(await outcome(verifyAssertion({ request, expectedChallenge: challenge, relyingParty, passkey }))).toBe(
      'accepted',
    )
  })

  test('rejects a stale counter, a missing UV flag, a foreign origin, a foreign rp id and another key', async () => {
    const authenticator = await makeSoftwareAuthenticator({ countSignatures: true })
    const passkey = { ...(await registered(authenticator)), signCount: 7 }
    const check = async (request: Awaited<ReturnType<SoftwareAuthenticator['assert']>>, stored = passkey) =>
      outcome(verifyAssertion({ request, expectedChallenge: challenge, relyingParty, passkey: stored }))
    const assert = (ceremony: Parameters<SoftwareAuthenticator['assert']>[1]) =>
      authenticator.assert(challenge, ceremony)
    expect(await check(await assert({ origin, counter: 7 }))).toMatch(/^verification: Response counter value 7/)
    expect(await check(await assert({ origin, counter: 3 }))).toMatch(/^verification: Response counter value 3/)
    expect(await check(await assert({ origin, counter: 8, flags: flags.userPresent }))).toMatch(
      /^verification: User verification/,
    )
    expect(await check(await assert({ origin: 'https://evil.test', counter: 8 }))).toMatch(
      /^verification: Unexpected authentication response origin/,
    )
    expect(await check(await assert({ origin, rpId: 'evil.test', counter: 8 }))).toMatch(/^verification: .*RP ID/)
    const other = await makeSoftwareAuthenticator()
    const otherKey = { ...(await registered(other)), credentialId: authenticator.credentialId, signCount: 7 }
    expect(await check(await assert({ origin, counter: 8 }), otherKey)).toBe('verification: not verified')
    expect(await check(await assert({ origin, counter: 8 }))).toBe('accepted')
  })
})
