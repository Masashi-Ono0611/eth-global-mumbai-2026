import type { DecideInput } from '@ethmumbai/protocol/Errand'

/** A within-budget chai decision input on the demo grant (3.00/day, 1.00/payment): the brain should answer `pay`. */
export const chaiDecideInput: DecideInput = {
  requested: 'chai',
  catalogue: { itemId: 'chai', name: 'Chai', amount: '100000', restricted: false },
  invoice: {
    id: 'abcdefghijklmnopqrstuvwxya',
    payTo: '0x000000000000000000000000000000000000c0de',
    amount: '100000',
    expiresAt: 4_000_000_000,
  },
  budget: { dailyCap: '3000000', spentToday: '0', remainingToday: '3000000', perPaymentCap: '1000000' },
  policy: { payeeAllowlisted: true, restricted: false, approvalRequired: false },
  merchant: { id: 'duck-cafe', trust: 'known' },
}
