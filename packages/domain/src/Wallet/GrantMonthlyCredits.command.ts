import * as Domain from '@alchemy.run/domain'
import { Schema } from 'effect'
import { NotAuthorized } from '../CurrentActor.context.ts'
import { Session } from '../Session.middleware.ts'
import { Credits, PositiveCredits } from './Credits.ts'
import { CreditLimitExceeded } from './GrantPurchasedCredits.command.ts'
import { WalletId } from './Wallet.id.ts'

export const Month = Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/))
export class StaleCreditGrant extends Domain.Rejection('StaleCreditGrant', { current: Month }) {}
export class MonthlyGrantConflict extends Domain.Rejection('MonthlyGrantConflict') {}
export class MonthlyCreditsGranted extends Domain.Event('MonthlyCreditsGranted', {
  period: Month,
  monthly: PositiveCredits,
  subscriptionAfter: Credits,
}) {}
export class GrantMonthlyCredits extends Domain.Command('GrantMonthlyCredits', {
  target: WalletId,
  middleware: [Session],
  input: { period: Month, monthly: PositiveCredits },
  events: [MonthlyCreditsGranted],
  rejects: [NotAuthorized, StaleCreditGrant, MonthlyGrantConflict, CreditLimitExceeded],
}) {}
