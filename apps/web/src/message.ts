import { Schema } from 'effect'
import { SessionView } from '@ethmumbai/auth/config'
import { defineMessageUnion } from 'foldkit/message'
import { Locale } from './Locale.ts'
import { AuthFailure } from './model.ts'
import * as Gate from './pages/gate/Gate.ts'
import * as Merchant from './pages/merchant/Merchant.ts'
import * as RobotConsole from './pages/RobotConsole.ts'
import * as Robots from './pages/Robots.ts'
import * as Wallet from './pages/Wallet.ts'

export const Message = defineMessageUnion({
  SelectedLocale: { value: Schema.String },
  SucceededSaveLocale: { locale: Locale },
  FailedSaveLocale: {},
  UpdatedDisplayName: { value: Schema.String },
  SubmittedCreateWallet: {},
  SucceededCreatePasskeyWallet: { session: SessionView },
  FailedCreatePasskeyWallet: { failure: AuthFailure },
  ClickedSignIn: {},
  SucceededSignInWithPasskey: { session: SessionView },
  FailedSignInWithPasskey: { failure: AuthFailure },
  SucceededReadSession: { maybeSession: Schema.Option(SessionView) },
  FailedReadSession: {},
  ClickedRetrySession: {},
  ClickedSignOut: {},
  SucceededSignOut: {},
  FailedSignOut: {},
  GotWalletMessage: { message: Wallet.Message },
  GotRobotsMessage: { message: Robots.Message },
  GotConsoleMessage: { message: RobotConsole.Message },
  GotMerchantMessage: { message: Merchant.Message },
  GotGateMessage: { message: Gate.Message },
})
export type Message = typeof Message.Type
