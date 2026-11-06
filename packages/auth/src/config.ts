import { Schema } from 'effect'

/** The public paths of the passkey and session routes; the browser client and the Worker share them. */
export const authPaths = {
  registerOptions: '/api/passkeys/register/options',
  registerVerify: '/api/passkeys/register/verify',
  loginOptions: '/api/passkeys/login/options',
  loginVerify: '/api/passkeys/login/verify',
  session: '/api/auth/session',
  logout: '/api/auth/logout',
} as const

/** ES256 (ECDSA P-256 with SHA-256): the only algorithm the HybridDeleGator verifies on Arc. */
export const es256 = -7

/** A base64url field (no padding) of bounded length; WebAuthn payloads travel in this encoding. */
export const Base64UrlText = (maxLength: number) =>
  Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/), Schema.isMaxLength(maxLength))

export const DisplayName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64))

/** What the signed-in browser may know about its account. */
export const SessionView = Schema.Struct({
  accountId: Schema.String,
  displayName: Schema.String,
  smartAccount: Schema.String,
})
export type SessionView = typeof SessionView.Type

export const SignedIn = Schema.Struct({ accountId: Schema.String, smartAccount: Schema.String })
export type SignedIn = typeof SignedIn.Type

export const RegisterOptionsRequest = Schema.Struct({ displayName: DisplayName })

export const RegistrationOptions = Schema.Struct({
  challenge: Base64UrlText(64),
  rp: Schema.Struct({ id: Schema.String, name: Schema.String }),
  user: Schema.Struct({ id: Base64UrlText(128), name: Schema.String }),
  pubKeyCredParams: Schema.Array(Schema.Struct({ type: Schema.Literal('public-key'), alg: Schema.Literal(es256) })),
  authenticatorSelection: Schema.Struct({
    residentKey: Schema.Literal('required'),
    userVerification: Schema.Literal('required'),
  }),
  attestation: Schema.Literal('none'),
  timeout: Schema.Number,
})
export type RegistrationOptions = typeof RegistrationOptions.Type

/** A new credential as the browser read it from `navigator.credentials.create`; every byte field is base64url. */
export const RegistrationRequest = Schema.Struct({
  credentialId: Base64UrlText(1366),
  clientDataJSON: Base64UrlText(4096),
  attestationObject: Base64UrlText(16384),
  publicKeySpki: Base64UrlText(1024),
  publicKeyAlgorithm: Schema.Number,
  authenticatorData: Base64UrlText(8192),
})
export type RegistrationRequest = typeof RegistrationRequest.Type

export const AssertionOptions = Schema.Struct({
  challenge: Base64UrlText(64),
  rpId: Schema.String,
  userVerification: Schema.Literal('required'),
  timeout: Schema.Number,
})
export type AssertionOptions = typeof AssertionOptions.Type

/** A passkey assertion from `navigator.credentials.get`: a login, or the signature over a grant or revoke hash. */
export const AssertionRequest = Schema.Struct({
  credentialId: Base64UrlText(1366),
  clientDataJSON: Base64UrlText(4096),
  authenticatorData: Base64UrlText(8192),
  signature: Base64UrlText(256),
})
export type AssertionRequest = typeof AssertionRequest.Type
