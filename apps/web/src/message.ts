import { Schema } from 'effect'
import { AccountClaims } from '@ethmumbai/auth/config'
import { defineMessageUnion } from 'foldkit/message'
import { Locale } from './Locale.ts'

export const Message = defineMessageUnion({
  SelectedLocale: { value: Schema.String },
  SucceededSaveLocale: { locale: Locale },
  FailedSaveLocale: {},
  SubmittedSignIn: {},
  SucceededSignIn: { claims: AccountClaims },
  FailedSignIn: {},
  ReceivedSession: { claims: Schema.NullOr(AccountClaims) },
  FailedReadSession: {},
  RequestedSession: {},
  RequestedSignOut: {},
  SucceededSignOut: {},
  FailedSignOut: {},
})
export type Message = typeof Message.Type
