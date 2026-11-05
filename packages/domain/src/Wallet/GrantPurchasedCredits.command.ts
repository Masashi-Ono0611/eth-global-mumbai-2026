import * as Domain from '@alchemy.run/domain'
import { NotAuthorized } from '../CurrentActor.context.ts'
import { Identifier } from '../Identity.ts'
import { Session } from '../Session.middleware.ts'
import { Credits, PositiveCredits } from './Credits.ts'
import { WalletId } from './Wallet.id.ts'

export class CreditLimitExceeded extends Domain.Rejection('CreditLimitExceeded') {}
export class PurchasedCreditsGranted extends Domain.Event('PurchasedCreditsGranted', {
  paymentId: Identifier,
  amount: PositiveCredits,
  purchasedAfter: Credits,
}) {}
export class GrantPurchasedCredits extends Domain.Command('GrantPurchasedCredits', {
  target: WalletId,
  middleware: [Session],
  input: { paymentId: Identifier, amount: PositiveCredits },
  events: [PurchasedCreditsGranted],
  rejects: [NotAuthorized, CreditLimitExceeded],
}) {}
