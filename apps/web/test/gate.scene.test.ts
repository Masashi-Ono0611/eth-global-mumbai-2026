import { expect, given, role, scene, text, withViewInputs } from 'foldkit/scene'
import { describe, test, expect as vitestExpect } from 'vitest'
import * as Gate from '../src/pages/gate/Gate.ts'
import * as Merchant from '../src/pages/merchant/Merchant.ts'

const invoice = {
  id: 'abcdefghijklmnopqrstuvwxya',
  url: 'https://app.example/api/i/abcdefghijklmnopqrstuvwxya',
  merchantId: 'duck-cafe',
  payTo: '0x000000000000000000000000000000000000c0de',
  amount: '100000',
  expiresAt: 4_000_000_000,
  invoiceHash: `0x${'12'.repeat(32)}`,
  restricted: false,
}

const waiting = Gate.update(Gate.init('duck-cafe').model, Gate.Message.SucceededStartGate({ invoice, publicKey: 'k' }))
const statusOf = (status: 'pending' | 'paid' | 'used' | 'expired', verified: boolean) =>
  Gate.update(waiting.model, Gate.Message.ReceivedStatus({ invoiceId: invoice.id, status, verified }))

describe('gate (spec §7)', () => {
  const view = withViewInputs(Gate.view, { locale: 'en' })()

  test('/gate/duck-cafe renders CLOSED, then the invoice id and its payment link', () => {
    scene(
      { update: Gate.update, view },
      given(Gate.init('duck-cafe').model),
      expect(role('status')).toHaveText('CLOSED'),
    )
    scene(
      { update: Gate.update, view },
      given(waiting.model),
      expect(role('status')).toHaveText('CLOSED'),
      expect(text(invoice.id)).toExist(),
      expect(text(invoice.url)).toExist(),
      expect(text('0.10 USDC')).toExist(),
    )
  })

  test('opens only on a verified paid, then asks for a fresh invoice', () => {
    const paid = statusOf('paid', true)
    scene({ update: Gate.update, view }, given(paid.model), expect(role('status')).toHaveText('OPEN'))
    vitestExpect(paid.commands?.map((command) => command.name)).toEqual(['NewInvoice'])
    const forged = statusOf('paid', false)
    scene(
      { update: Gate.update, view },
      given(forged.model),
      expect(role('status')).toHaveText('CLOSED'),
      expect(role('alert')).toHaveText('The status signature did not verify; the gate stays closed.'),
    )
    vitestExpect(statusOf('pending', true).commands?.map((command) => command.name)).toEqual(['ReadStatus'])
    vitestExpect(statusOf('used', true).commands?.map((command) => command.name)).toEqual(['NewInvoice'])
  })
})

describe('merchant page', () => {
  const view = withViewInputs(Merchant.view, { locale: 'en' })()
  const catalogue = {
    merchantId: 'duck-cafe',
    name: 'Duck Café',
    items: [
      { itemId: 'chai', name: 'Chai', amount: '100000', restricted: false },
      { itemId: 'cigarettes', name: 'Cigarettes', amount: '500000', restricted: true },
    ],
  }

  test('shows the menu with the restricted item marked for approval, and the gate link', () => {
    const loaded = Merchant.update(Merchant.init().model, Merchant.Message.SucceededLoadCatalogue({ catalogue })).model
    scene(
      { update: Merchant.update, view },
      given(loaded),
      expect(text('Duck Café')).toExist(),
      expect(text('0.50 USDC')).toExist(),
      expect(text("Restricted item: needs the owner's approval")).toExist(),
      expect(role('link', { name: 'Open the gate screen' })).toHaveAttr('href', '/app/gate/duck-cafe'),
    )
  })
})
