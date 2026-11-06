import { Option } from 'effect'
import { Command, click, expect, given, role, scene, selector, text } from 'foldkit/scene'
import { describe, expect as vitestExpect, test } from 'vitest'
import { usdc } from '../src/api.ts'
import { LoadTill, OpenInvoice, ReadStatus } from '../src/command.ts'
import { Message } from '../src/message.ts'
import { MERCHANT_ID, POLL_MILLIS, Sale, Till } from '../src/model.ts'
import { init, update } from '../src/update.ts'
import { view } from '../src/view.ts'

const chai = { itemId: 'chai', name: 'Chai', amount: '100000', restricted: false }
const catalogue = {
  merchantId: MERCHANT_ID,
  name: 'Duck Café',
  items: [
    chai,
    { itemId: 'samosa', name: 'Samosa', amount: '250000', restricted: false },
    { itemId: 'thali', name: 'Thali', amount: '2000000', restricted: false },
    { itemId: 'cigarettes', name: 'Cigarettes', amount: '500000', restricted: true },
  ],
}
const publicKey = 'key'
const invoice = { id: 'inv1', url: 'https://app.test/api/i/inv1', amount: '100000', expiresAt: 1_800_000_000 }
const ready = { till: Till.Ready({ catalogue, publicKey, sale: Sale.Choosing() }) }
const waiting = {
  till: Till.Ready({ catalogue, publicKey, sale: Sale.Waiting({ item: chai, invoice, hitch: Option.none() }) }),
}
const poll = ReadStatus({ invoiceId: 'inv1', publicKey, delayMillis: POLL_MILLIS })
/** From the menu to a sale waiting on `invoice`, with its first status read pending. */
const startSale = [
  click(role('button', { name: /Chai/ })),
  Command.resolve(OpenInvoice, Message.SucceededOpenInvoice({ invoice })),
] as const

describe('the till', () => {
  test('starts by loading the menu and the gate key', () => {
    vitestExpect(init().commands?.map((command) => command.name)).toEqual([LoadTill.name])
    scene({ update, view }, given(init().model), expect(role('status')).toHaveText('Opening the till…'))
  })

  test('sells only unrestricted items at the counter', () => {
    scene(
      { update, view },
      given(ready),
      expect(role('button', { name: /Chai/ })).toExist(),
      expect(role('button', { name: /Samosa/ })).toExist(),
      expect(text('0.25 USDC')).toExist(),
      expect(role('button', { name: /Cigarettes/ })).not.toExist(),
    )
  })

  test('a sale shows the x402 QR, keeps asking while pending, and shows Paid on a verified paid', () => {
    scene(
      { update, view },
      given(ready),
      click(role('button', { name: /Chai/ })),
      Command.expectExact(OpenInvoice({ merchantId: MERCHANT_ID, itemId: 'chai' })),
      Command.resolve(OpenInvoice, Message.SucceededOpenInvoice({ invoice })),
      expect(role('img', { name: /x402 payment link of invoice inv1/ })).toExist(),
      expect(role('link', { name: invoice.url })).toHaveAttr('href', invoice.url),
      Command.expectExact(poll),
      Command.resolve(poll, Message.ReceivedStatus({ invoiceId: 'inv1', status: 'pending', trusted: true })),
      expect(role('status')).toHaveText('Waiting for payment…'),
      Command.resolve(poll, Message.ReceivedStatus({ invoiceId: 'inv1', status: 'paid', trusted: true })),
      expect(role('heading', { name: 'Paid' })).toExist(),
      click(role('button', { name: 'Next customer' })),
      expect(role('button', { name: /Chai/ })).toExist(),
    )
  })

  test('an unverified paid never counts; a verified used does (another reader saw paid first)', () => {
    scene(
      { update, view },
      given(ready),
      ...startSale,
      Command.resolve(poll, Message.ReceivedStatus({ invoiceId: 'inv1', status: 'paid', trusted: false })),
      expect(role('alert')).toHaveText('A status arrived without a valid signature. Ignoring it and asking again.'),
      expect(role('heading', { name: 'Paid' })).not.toExist(),
      Command.resolve(poll, Message.ReceivedStatus({ invoiceId: 'inv1', status: 'used', trusted: true })),
      expect(role('heading', { name: 'Paid' })).toExist(),
    )
  })

  test('an expired invoice offers a fresh one for the same item', () => {
    scene(
      { update, view },
      given(ready),
      ...startSale,
      Command.resolve(poll, Message.ReceivedStatus({ invoiceId: 'inv1', status: 'expired', trusted: true })),
      expect(role('heading', { name: 'Invoice expired' })).toExist(),
      click(role('button', { name: 'New invoice' })),
      Command.expectExact(OpenInvoice({ merchantId: MERCHANT_ID, itemId: 'chai' })),
      Command.resolve(OpenInvoice, Message.FailedOpenInvoice({ reason: 'unknown item' })),
      expect(selector('.outcome h2')).toHaveText('Could not open an invoice for Chai'),
    )
  })

  test('cancelling drops late answers about the old invoice', () => {
    const cancelled = update(waiting, Message.ClickedNextCustomer()).model
    const late = update(cancelled, Message.ReceivedStatus({ invoiceId: 'inv1', status: 'paid', trusted: true }))
    vitestExpect(Till.guards.Ready(late.model.till) && Sale.guards.Choosing(late.model.till.sale)).toBe(true)
    vitestExpect(late.commands ?? []).toEqual([])
  })

  test('items over 1 USDC are marked for World ID approval, and their sale says so while it waits', () => {
    const thaliInvoice = { id: 'inv2', url: 'https://app.test/api/i/inv2', amount: '2000000', expiresAt: 1_800_000_000 }
    scene(
      { update, view },
      given(ready),
      expect(role('button', { name: /Thali.*Needs owner approval · World ID/ })).toExist(),
      expect(role('button', { name: /Chai.*World ID/ })).not.toExist(),
      click(role('button', { name: /Thali/ })),
      Command.expectExact(OpenInvoice({ merchantId: MERCHANT_ID, itemId: 'thali' })),
      Command.resolve(OpenInvoice, Message.SucceededOpenInvoice({ invoice: thaliInvoice })),
      expect(text(/approve with World ID/)).toExist(),
      Command.resolve(
        ReadStatus({ invoiceId: 'inv2', publicKey, delayMillis: POLL_MILLIS }),
        Message.ReceivedStatus({ invoiceId: 'inv2', status: 'paid', trusted: true }),
      ),
      expect(role('heading', { name: 'Paid' })).toExist(),
    )
  })

  test('formats USDC base units', () => {
    vitestExpect([usdc('100000'), usdc('250000'), usdc('1500000'), usdc('0')]).toEqual(['0.10', '0.25', '1.50', '0.00'])
  })
})
