import * as Domain from '@alchemy.run/domain'
import { NotAuthorized } from '../CurrentActor.context.ts'
import { Fingerprint, OperationId } from '../Identity.ts'
import { Session } from '../Session.middleware.ts'
import { Credits } from './Credits.ts'
import { WalletId } from './Wallet.id.ts'

export class InsufficientCredits extends Domain.Rejection('InsufficientCredits', {
  available: Credits,
  required: Credits,
}) {}
export class ReservationConflict extends Domain.Rejection('ReservationConflict') {}
export class TooManyReservations extends Domain.Rejection('TooManyReservations') {}
export class CreditsReserved extends Domain.Event('CreditsReserved', {
  operationId: OperationId,
  fingerprint: Fingerprint,
  fromSubscription: Credits,
  fromPurchased: Credits,
  subscriptionAfter: Credits,
  purchasedAfter: Credits,
}) {}
export class ReserveCredits extends Domain.Command('ReserveCredits', {
  target: WalletId,
  middleware: [Session],
  input: { operationId: OperationId, fingerprint: Fingerprint, amount: Credits },
  events: [CreditsReserved],
  rejects: [NotAuthorized, InsufficientCredits, ReservationConflict, TooManyReservations],
}) {}
