import { Schema } from 'effect'
import { AccountClaims } from '@ethmumbai/auth/config'
import { catalogVersion } from '@ethmumbai/i18n'
import { defineTaggedUnion } from 'foldkit/schema'
import { Locale } from './Locale.ts'
import { AppRoute } from './route.ts'

/** What the server rendered with; serialized into the page and read back unchanged when the browser hydrates. */
export const Flags = Schema.Struct({
  locale: Locale,
  catalogVersion: Schema.Literal(catalogVersion),
  timeZone: Schema.String,
  referenceTime: Schema.Number,
  pathname: Schema.String,
})
export type Flags = typeof Flags.Type

export const LocaleSave = defineTaggedUnion({ Saved: {}, Saving: { locale: Locale }, Failed: {} })
export const AuthState = defineTaggedUnion({
  Checking: {},
  SignedOut: { failed: Schema.Boolean },
  SigningIn: {},
  SignedIn: { claims: AccountClaims },
  SigningOut: { claims: AccountClaims },
  Unavailable: {},
})
export const Model = Schema.Struct({
  context: Flags,
  route: AppRoute,
  localeSave: LocaleSave,
  auth: AuthState,
})
export type Model = typeof Model.Type
