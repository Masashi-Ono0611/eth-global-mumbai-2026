import { Schema } from 'effect'
import { SessionView } from '@ethmumbai/auth/config'
import { catalogVersion } from '@ethmumbai/i18n'
import { defineTaggedUnion } from 'foldkit/schema'
import { Dialog } from '@foldkit/ui'
import { Locale } from './Locale.ts'
import { AddRobot, Approval, Episode, Episodes, Gate, Merchant, RobotConsole, Wallet } from './pageModules.ts'
import { AppRoute } from './route.ts'
import * as Telegram from './Telegram.ts'

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
  auth: AuthState,
  displayName: Schema.String,
  /** The avatar's bottom sheet: who is signed in, the audit log, sign out. */
  profileSheet: Dialog.Model,
  /** The sheet's Telegram row (spec §14). */
  telegram: Telegram.Model,
  /** The owner pages keep their own state; only the current route's is present. */
  maybeWallet: Schema.Option(Wallet.Model),
  maybeAddRobot: Schema.Option(AddRobot.Model),
  maybeConsole: Schema.Option(RobotConsole.Model),
  maybeApproval: Schema.Option(Approval.Model),
  maybeEpisodes: Schema.Option(Episodes.Model),
  maybeEpisode: Schema.Option(Episode.Model),
  maybeMerchant: Schema.Option(Merchant.Model),
  maybeGate: Schema.Option(Gate.Model),
})
export type Model = typeof Model.Type
