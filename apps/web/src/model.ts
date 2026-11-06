import { Schema } from 'effect'
import { SessionView } from '@ethmumbai/auth/config'
import { catalogVersion } from '@ethmumbai/i18n'
import { defineTaggedUnion } from 'foldkit/schema'
import { Locale } from './Locale.ts'
import * as Gate from './pages/gate/Gate.ts'
import * as Merchant from './pages/merchant/Merchant.ts'
import * as RobotConsole from './pages/RobotConsole.ts'
import * as Robots from './pages/Robots.ts'
import * as Wallet from './pages/Wallet.ts'
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

/** Why the last passkey ceremony did not sign the owner in: the prompt itself, or the Worker. */
export const AuthFailure = Schema.Literals(['passkey', 'server'])
export type AuthFailure = typeof AuthFailure.Type

export const LocaleSave = defineTaggedUnion({ Saved: {}, Saving: { locale: Locale }, Failed: {} })
export const AuthState = defineTaggedUnion({
  Checking: {},
  SignedOut: {},
  Refused: { failure: AuthFailure },
  CreatingWallet: {},
  SigningIn: {},
  SignedIn: { session: SessionView },
  SigningOut: { session: SessionView },
  Unavailable: {},
})
export type AuthState = typeof AuthState.Type
export const Model = Schema.Struct({
  context: Flags,
  route: AppRoute,
  localeSave: LocaleSave,
  auth: AuthState,
  displayName: Schema.String,
  /** The owner pages keep their own state; only the current route's is present. */
  maybeWallet: Schema.Option(Wallet.Model),
  maybeRobots: Schema.Option(Robots.Model),
  maybeConsole: Schema.Option(RobotConsole.Model),
  maybeMerchant: Schema.Option(Merchant.Model),
  maybeGate: Schema.Option(Gate.Model),
})
export type Model = typeof Model.Type
