import * as Domain from '@alchemy.run/domain'
import { Schema } from 'effect'
import { NotAuthorized } from '../CurrentActor.context.ts'
import { OperationId } from '../Identity.ts'
import { Session } from '../Session.middleware.ts'
import { Credits } from './Credits.ts'
import { WalletId } from './Wallet.id.ts'

export const Settlement = Schema.Literals(['consumed', 'refunded'])
export class CreditsSettled extends Domain.Event('CreditsSettled', {
  operationId: OperationId,
  outcome: Settlement,
  fromSubscription: Credits,
  fromPurchased: Credits,
  subscriptionAfter: Credits,
  purchasedAfter: Credits,
}) {}
// Sent after a definitive request outcome. Unknown provider outcomes retain their hold.
export class SettleCredits extends Domain.Command('SettleCredits', {
  target: WalletId,
  middleware: [Session],
  input: { operationId: OperationId, outcome: Settlement },
  events: [CreditsSettled],
  rejects: [NotAuthorized],
}) {}
