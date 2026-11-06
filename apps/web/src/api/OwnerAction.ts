import { Effect, Predicate, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { Passkeys } from '../Passkey.ts'

/** Why an owner action (grant, revoke) did not complete: the passkey prompt, or the Worker / Arc with its reason. */
export const ActionFailure = defineTaggedUnion({
  Passkey: {},
  Server: { error: Schema.String },
})
export type ActionFailure = typeof ActionFailure.Type

export const actionFailureOf = (error: unknown): ActionFailure => {
  if (Predicate.isTagged(error, 'PasskeyFailed')) return ActionFailure.Passkey()
  if (
    Predicate.isTagged(error, 'ApiFailure') &&
    Predicate.hasProperty(error, 'error') &&
    Predicate.isString(error.error)
  )
    return ActionFailure.Server({ error: error.error })
  return ActionFailure.Server({ error: 'unexpected failure' })
}

/** The account's passkey signs the challenge the Worker issued (the delegation's EIP-712 digest). */
export const signWithPasskey = (prompt: {
  readonly challenge: string
  readonly rpId: string
  readonly userVerification: 'required'
  readonly timeout: number
  readonly allowCredentials: ReadonlyArray<string>
}) =>
  Effect.gen(function* () {
    const passkeys = yield* Passkeys
    return yield* passkeys.get(prompt)
  })
