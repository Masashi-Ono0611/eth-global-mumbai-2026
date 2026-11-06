import type { DecideInput } from '@ethmumbai/protocol/Errand'

/** A within-budget chai decision input (allowlisted payee, no approval): the brain should answer `pay`. */
export const chaiDecideInput: DecideInput = {
  requested: 'chai',
  catalogue: { itemId: 'chai', name: 'Chai', amount: '100000', restricted: false },
  invoice: {
    id: 'abcdefghijklmnopqrstuvwxya',
    payTo: '0x000000000000000000000000000000000000c0de',
    amount: '100000',
    expiresAt: 4_000_000_000,
  },
  budget: { dailyCap: '1000000', spentToday: '0', remainingToday: '1000000', perPaymentCap: '300000' },
  policy: { payeeAllowlisted: true, restricted: false, approvalRequired: false },
  merchant: { id: 'duck-cafe', trust: 'known' },
}
