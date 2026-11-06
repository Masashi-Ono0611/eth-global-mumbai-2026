import { Schema } from 'effect'
import { SessionView } from '@ethmumbai/auth/config'
import { defineMessageUnion } from 'foldkit/message'
import { Dialog } from '@foldkit/ui'
import { AuthFailure } from './model.ts'
import * as Telegram from './Telegram.ts'
import {
  AddRobot,
  Approval,
  Episode,
  Episodes,
  Gate,
  Merchant,
  Proof,
  Proofs,
  RobotConsole,
  Wallet,
  Welcome,
} from './pageModules.ts'

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
  GotTelegramMessage: { message: Telegram.Message },
  CompletedOpenWallet: {},
  CompletedOpenWelcome: {},
  SucceededSignOut: {},
  FailedSignOut: {},
  GotWalletMessage: { message: Wallet.Message },
  GotWelcomeMessage: { message: Welcome.Message },
  GotAddRobotMessage: { message: AddRobot.Message },
  GotConsoleMessage: { message: RobotConsole.Message },
  GotApprovalMessage: { message: Approval.Message },
  GotEpisodesMessage: { message: Episodes.Message },
  GotEpisodeMessage: { message: Episode.Message },
  GotMerchantMessage: { message: Merchant.Message },
  GotGateMessage: { message: Gate.Message },
  GotProofsMessage: { message: Proofs.Message },
  GotProofMessage: { message: Proof.Message },
})
export type Message = typeof Message.Type
