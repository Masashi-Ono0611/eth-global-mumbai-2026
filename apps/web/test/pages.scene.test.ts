import { Command, Mount, click, expect, given, role, scene, text, withViewInputs } from 'foldkit/scene'
import { describe, expect as vitestExpect, test } from 'vitest'
import { Animation, Dialog } from '@foldkit/ui'
import * as Wallet from '../src/pages/Wallet.ts'
import { walletView } from '../src/pages/WalletView.ts'
import { activityRow, address, grant, pairedRobot, summary, txHash } from './Fixtures.ts'

const loadedHome = (value: Wallet.Home) =>
  Wallet.update(Wallet.init().model, Wallet.Message.SucceededLoadWallet({ home: value })).model

const home = (overrides: Partial<Wallet.Home> = {}): Wallet.Home => ({
  wallet: {
    account: {
      accountId: 'a',
      displayName: 'Ana',
      smartAccount: address,
      deployStatus: 'deployed',
      deployTx: txHash,
    },
    balance: { units: '1400000', usdc: '1.40' },
    fund: { network: 'eip155:5042', asset: '0x3600000000000000000000000000000000000000', address },
  },
  activity: { episodes: [activityRow('e1', 'chai', 'paid', '100000', txHash)], grants: [] },
  robots: [{ ...pairedRobot, grant }],
  episodes: [summary('e1', 'chai', 'paid', 'within budget')],
  needsYou: [],
  spentLastDay: '100000',
  ...overrides,
})
describe('/wallet', () => {
  const view = withViewInputs(walletView, { locale: 'en' })()

  test('shows the balance, what the robots spent, the robots as conversations and the payments', () => {
    scene({ update: Wallet.update, view }, given(Wallet.init().model), expect(role('status')).toHaveText('Loading...'))
    scene(
      { update: Wallet.update, view },
      given(loadedHome(home())),
      expect(text('1.40')).toExist(),
      expect(text('Your robots spent 0.10 USDC in the last 24 hours')).toExist(),
      expect(role('button', { name: 'Send, coming soon' })).toBeDisabled(),
      expect(role('link', { name: 'Add a robot' })).toHaveAttr('href', '/app/wallet/robots'),
      expect(role('link', { name: /Duck/ })).toHaveAttr('href', `/app/robot/${pairedRobot.id}`),
      expect(text('Bought chai')).toExist(),
    )
  })

  test("a ready robot's row says what is left of today's allowance", () => {
    scene(
      { update: Wallet.update, view },
      given(
        loadedHome(home({ episodes: [], robots: [{ ...pairedRobot, grant: { ...grant, spentToday: '400000' } }] })),
      ),
      expect(text('0.60 USDC left today')).toExist(),
      expect(text('Chai')).toExist(),
      expect(text('−0.10')).toExist(),
      expect(text('Paid')).toExist(),
    )
  })

  test('Receive opens a sheet with the address as a QR code, in groups, and a copy button', () => {
    scene(
      { update: Wallet.update, view },
      given(loadedHome(home())),
      click(role('button', { name: 'Receive' })),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Command.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint({ generation: 1 })),
      Command.resolve(Animation.WaitForAnimationSettled, Animation.Message.EndedAnimation({ generation: 1 })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),

      expect(role('heading', { name: 'Receive USDC' })).toExist(),
      expect(role('img', { name: 'QR code of your wallet address' })).toExist(),
      expect(text('0x1234 5678 90ab cdef 1234 5678 90AB CDEF 1234 5678')).toExist(),
      click(role('button', { name: 'Copy address' })),
      Command.expectExact(Wallet.CopyAddress({ address })),
      Command.resolve(Wallet.CopyAddress, Wallet.Message.CompletedCopyAddress({ copied: true })),
      expect(text('Address copied')).toExist(),
    )
  })

  test('a waiting approval is answered on the home: Approve goes to World, No declines it', () => {
    const waiting = home({
      activity: { episodes: [activityRow('e2', 'thali', 'awaiting_approval', '2000000', null)], grants: [] },
      episodes: [summary('e2', 'thali', 'awaiting_approval', 'Over the per-payment cap; the owner asked for it')],
      needsYou: [
        {
          episodeId: 'e2',
          approvalId: 'ap1',
          robotId: pairedRobot.id,
          robotName: 'Duck',
          item: 'thali',
          amount: '2000000',
          reason: 'Over the per-payment cap; the owner asked for it',
        },
      ],
    })
    scene(
      { update: Wallet.update, view },
      given(loadedHome(waiting)),
      expect(role('heading', { name: 'Needs you' })).toExist(),
      expect(text('I want to buy thali for 2.00 USDC, and that needs your OK first.')).toExist(),
      expect(text('0G: “Over the per-payment cap; the owner asked for it”')).toExist(),
      expect(text('Waiting for your answer')).toExist(),
      expect(role('link', { name: 'Approve with World ID' })).toHaveAttr('href', '/api/world/authorize?approval=ap1'),
      click(role('button', { name: 'No' })),
      Command.expectExact(Wallet.DeclineApproval({ approvalId: 'ap1' })),
      expect(role('button', { name: 'Saying no...' })).toBeDisabled(),
      Command.resolve(Wallet.DeclineApproval, Wallet.Message.SucceededDecline()),
      Command.expectExact(Wallet.LoadWallet({ delayMillis: 0 })),
      Command.resolve(Wallet.LoadWallet, Wallet.Message.SucceededLoadWallet({ home: home() })),
      expect(role('heading', { name: 'Needs you' })).not.toExist(),
    )
  })

  test('re-reads every 3 s while an errand runs, and not once everything has ended', () => {
    const running = Wallet.update(
      Wallet.init().model,
      Wallet.Message.SucceededLoadWallet({
        home: home({ episodes: [summary('e3', 'samosa', 'signing', 'within budget')] }),
      }),
    )
    vitestExpect(running.commands?.map((command) => [command.name, command.args])).toEqual([
      ['LoadWallet', { delayMillis: Wallet.POLL_MILLIS }],
    ])
    vitestExpect(
      Wallet.update(Wallet.init().model, Wallet.Message.SucceededLoadWallet({ home: home() })).commands,
    ).toEqual([])
  })

  test('without a session it says to sign in', () => {
    scene(
      { update: Wallet.update, view },
      given(
        Wallet.update(Wallet.init().model, Wallet.Message.FailedLoadWallet({ error: 'not signed in', signedOut: true }))
          .model,
      ),
      expect(role('alert')).toHaveText('Sign in with your passkey to see this page.'),
    )
  })
})
