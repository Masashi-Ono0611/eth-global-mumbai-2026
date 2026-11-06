import { Option } from 'effect'
import { Command, click, expect, given, role, scene, Subscription, text } from 'foldkit/scene'
import { describe, expect as vitestExpect, test } from 'vitest'
import { type CounterInvoice, usdc } from '../src/api.ts'
import { LoadTill, PlaceOnCounter, ReadCounter } from '../src/command.ts'
import { Message } from '../src/message.ts'
import { MERCHANT_ID, Screen, Tap, Till } from '../src/model.ts'
import { init, update } from '../src/update.ts'
import { view } from '../src/view.ts'

const chai = { itemId: 'chai', name: 'Chai', amount: '100000', restricted: false }
const thali = { itemId: 'thali', name: 'Thali', amount: '2000000', restricted: false }
const catalogue = {
  merchantId: MERCHANT_ID,
  name: 'Duck Café',
  items: [
    chai,
    { itemId: 'samosa', name: 'Samosa', amount: '250000', restricted: false },
    thali,
    { itemId: 'cigarettes', name: 'Cigarettes', amount: '500000', restricted: true },
  ],
}
/** 6 Nov 2026, 23:00 IST, in ms; invoices are payable for 600 s. */
const NOW = 1_794_000_000_000
const expiresAt = NOW / 1000 + 600
const chaiBill: CounterInvoice = { id: 'inv1', ...chai, expiresAt, status: 'pending' }
const thaliBill: CounterInvoice = { id: 'inv2', ...thali, expiresAt, status: 'pending' }
const blank = {
  till: Till.Ready({
    catalogue,
    screen: Screen.Blank({ readAt: NOW }),
    tap: Tap.Idle(),
    read: 'idle',
    link: 'answering',
  }),
}
const showingChai = {
  till: Till.Ready({
    catalogue,
    screen: Screen.Showing({ invoice: chaiBill, readAt: NOW }),
    tap: Tap.Idle(),
    read: 'idle',
    link: 'answering',
  }),
}
const read = ReadCounter({ merchantId: MERCHANT_ID })
/** The next 2 s tick reads the screen again; the app answers with `invoice` (read at `askedAt`). */
const tickAndRead = (invoice: CounterInvoice | undefined, askedAt: number) =>
  [
    Subscription.emit(Message.Ticked()),
    Command.resolve(read, Message.SucceededReadCounter({ maybeInvoice: Option.fromNullishOr(invoice), askedAt })),
  ] as const

describe('the till', () => {
  test('opens by loading the menu', () => {
    vitestExpect(init().commands?.map((command) => command.name)).toEqual([LoadTill.name])
    scene({ update, view }, given(init().model), expect(role('status')).toHaveText('Opening the till…'))
  })

  test('sells the catalogue it read, never restricted items, and marks items over 1 USDC for World ID', () => {
    scene(
      { update, view },
      given(blank),
      expect(role('button', { name: /Chai.*0\.10 USDC/ })).toExist(),
      expect(role('button', { name: /Samosa.*0\.25 USDC/ })).toExist(),
      expect(role('button', { name: /Thali.*2\.00 USDC.*Needs owner approval · World ID/ })).toExist(),
      expect(role('button', { name: /Chai.*World ID/ })).not.toExist(),
      expect(role('button', { name: /Cigarettes/ })).not.toExist(),
    )
  })

  test('a tap puts the bill on the counter screen, and the 2 s reads turn it to PAID', () => {
    scene(
      { update, view },
      given(blank),
      click(role('button', { name: /Chai/ })),
      Command.expectExact(PlaceOnCounter({ merchantId: MERCHANT_ID, item: chai })),
      expect(text('Putting Chai on the screen…')).toExist(),
      expect(role('button', { name: /Samosa/ })).toBeDisabled(),
      Command.resolve(PlaceOnCounter, Message.SucceededPlaceOnCounter({ invoice: chaiBill, placedAt: NOW })),
      expect(role('heading', { name: 'Chai · 0.10 USDC' })).toExist(),
      expect(role('status')).toHaveText('Waiting for payment'),
      expect(text('The duck pays by scanning the QR code on the counter screen.')).toExist(),
      expect(role('button', { name: /Samosa/ })).not.toBeDisabled(),
      ...tickAndRead(chaiBill, NOW + 2000),
      expect(role('status')).toHaveText('Waiting for payment'),
      ...tickAndRead({ ...chaiBill, status: 'paid' }, NOW + 4000),
      expect(role('status')).toHaveText('Paid'),
      expect(text('Settled in USDC on Arc. Tap an item for the next bill.')).toExist(),
      ...tickAndRead({ ...chaiBill, status: 'used' }, NOW + 6000),
      expect(role('status')).toHaveText('Paid'),
    )
  })

  test('a read that began before the tap was stored does not bring the previous bill back', () => {
    scene(
      { update, view },
      given(showingChai),
      Subscription.emit(Message.Ticked()),
      click(role('button', { name: /Thali/ })),
      Command.resolve(PlaceOnCounter, Message.SucceededPlaceOnCounter({ invoice: thaliBill, placedAt: NOW + 900 })),
      expect(text(/approve with World ID/)).toExist(),
      Command.resolve(read, Message.SucceededReadCounter({ maybeInvoice: Option.some(chaiBill), askedAt: NOW + 500 })),
      expect(role('heading', { name: 'Thali · 2.00 USDC' })).toExist(),
      ...tickAndRead(thaliBill, NOW + 2500),
      expect(role('heading', { name: 'Thali · 2.00 USDC' })).toExist(),
    )
  })

  test('under a minute left the screen drops it; past its expiry the till says expired', () => {
    scene(
      { update, view },
      given(showingChai),
      ...tickAndRead(chaiBill, (expiresAt - 59) * 1000),
      expect(role('status')).toHaveText('Off the screen'),
      expect(text(/Under a minute left, so the duck will not take it/)).toExist(),
      ...tickAndRead({ ...chaiBill, status: 'expired' }, (expiresAt + 1) * 1000),
      expect(role('status')).toHaveText('Expired'),
    )
  })

  test('one read at a time, a silent app is said, and a refused tap names the item and the reason', () => {
    scene(
      { update, view },
      given(showingChai),
      Subscription.emit(Message.Ticked()),
      Subscription.emit(Message.Ticked()),
      Command.expectExact(read),
      Command.resolve(read, Message.FailedReadCounter()),
      expect(role('alert')).toHaveText('The app did not answer. Asking again.'),
      ...tickAndRead(chaiBill, NOW + 4000),
      expect(role('alert')).not.toExist(),
      click(role('button', { name: /Thali/ })),
      Command.resolve(
        PlaceOnCounter,
        Message.FailedPlaceOnCounter({ itemId: 'thali', reason: 'not configured: MERCHANT_PAY_TO' }),
      ),
      expect(role('alert')).toHaveText('Could not put Thali on the screen: not configured: MERCHANT_PAY_TO'),
      expect(role('heading', { name: 'Chai · 0.10 USDC' })).toExist(),
    )
  })

  test('a till that could not start tries again, then reads what the counter screen shows', () => {
    scene(
      { update, view },
      given({ till: Till.Broken({ reason: 'The app did not answer.' }) }),
      expect(role('heading', { name: 'The till could not start' })).toExist(),
      click(role('button', { name: 'Try again' })),
      Command.expectExact(LoadTill({ merchantId: MERCHANT_ID })),
      expect(role('status')).toHaveText('Opening the till…'),
      Command.resolve(LoadTill, Message.SucceededLoadTill({ catalogue })),
      Command.expectExact(read),
      expect(role('status')).toHaveText('Reading the counter screen…'),
      Command.resolve(read, Message.SucceededReadCounter({ maybeInvoice: Option.none(), askedAt: NOW })),
      expect(role('status')).toHaveText('Nothing on the screen yet. Tap an item to show its bill.'),
    )
  })

  test('formats USDC base units', () => {
    vitestExpect([usdc('100000'), usdc('250000'), usdc('1500000'), usdc('0')]).toEqual(['0.10', '0.25', '1.50', '0.00'])
  })
})
