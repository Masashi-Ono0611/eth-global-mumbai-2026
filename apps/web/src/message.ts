import { Schema } from 'effect'
import { SessionView } from '@ethmumbai/auth/config'
import { defineMessageUnion } from 'foldkit/message'
import { Dialog } from '@foldkit/ui'
import { AuthFailure } from './model.ts'
import { Approval, Episode, Episodes, Gate, Merchant, RobotConsole, Robots, Wallet } from './pageModules.ts'

export const Message = defineMessageUnion({
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
  ClickedProfile: {},
  GotProfileSheetMessage: { message: Dialog.Message },
  CompletedOpenWallet: {},
  SucceededSignOut: {},
  FailedSignOut: {},
  GotWalletMessage: { message: Wallet.Message },
  GotRobotsMessage: { message: Robots.Message },
  GotConsoleMessage: { message: RobotConsole.Message },
  GotApprovalMessage: { message: Approval.Message },
  GotEpisodesMessage: { message: Episodes.Message },
  GotEpisodeMessage: { message: Episode.Message },
  GotMerchantMessage: { message: Merchant.Message },
  GotGateMessage: { message: Gate.Message },
})
export type Message = typeof Message.Type
