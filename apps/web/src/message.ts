import { Schema } from 'effect'
import { SessionView } from '@ethmumbai/auth/config'
import { defineMessageUnion } from 'foldkit/message'
import { Locale } from './Locale.ts'
import { AuthFailure } from './model.ts'

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
})
export type Message = typeof Message.Type
