import { Schema } from 'effect'
import { Fingerprint, OperationId } from '../Identity.ts'
import { Credits } from './Credits.ts'
import { Month } from './GrantMonthlyCredits.command.ts'

export const Reservation = Schema.Struct({
  fingerprint: Fingerprint,
  fromSubscription: Credits,
  fromPurchased: Credits,
})
export const WalletState = Schema.Struct({
  subscription: Credits,
  purchased: Credits,
  period: Schema.NullOr(Month),
  monthly: Credits,
  reservations: Schema.Record(OperationId, Reservation),
})
export type WalletState = typeof WalletState.Type
export const heldCredits = (state: WalletState): { subscription: number; purchased: number } =>
  Object.values(state.reservations).reduce(
    (held, entry) => ({
      subscription: held.subscription + entry.fromSubscription,
      purchased: held.purchased + entry.fromPurchased,
    }),
    { subscription: 0, purchased: 0 },
  )
