import { Option } from 'effect'
import {
  Command,
  Mount,
  click,
  expect,
  given,
  label,
  role,
  scene,
  selector,
  submit,
  text,
  type,
  withViewInputs,
} from 'foldkit/scene'
import { describe, expect as vitestExpect, test } from 'vitest'
import { Dialog } from '@foldkit/ui'
import { ActionFailure } from '../src/api/OwnerAction.ts'
import type { RobotView } from '../src/api/Wallet.ts'
import * as RobotConsole from '../src/pages/RobotConsole.ts'
import { robotConsoleView } from '../src/pages/RobotConsoleView.ts'
import * as Robots from '../src/pages/Robots.ts'
import { robotsView } from '../src/pages/RobotsView.ts'
import * as Wallet from '../src/pages/Wallet.ts'
import { walletView } from '../src/pages/WalletView.ts'

const address = '0x1234567890abcdef1234567890ABCDEF12345678'
const payee = '0x000000000000000000000000000000000000c0de'
const txHash = `0x${'ab'.repeat(32)}`
const grant = {
  id: 'grantgrantgrantgrantgranta',
  status: 'active',
  dailyCap: '1000000',
  perPaymentCap: '300000',
  allowlist: [payee],
  expiresAt: 4_000_000_000,
}
const pairedRobot = {
  id: 'robotrobotrobotrobotrobota',
  name: 'Duck',
  status: 'paired',
  chipAddress: '0x00000000000000000000000000000000000c41f0',
  pairingCode: null,
  pairingExpiresAt: null,
  lease: { until: null, online: true },
  grant: null,
}

const loadedRobots = (robots: ReadonlyArray<RobotView>) =>
  Robots.update(
    Robots.init().model,
    Robots.Message.SucceededLoadRobots({ robots, maybeMerchant: Option.some({ name: 'Duck Café', payTo: payee }) }),
  ).model

const detail = (state: string, paid: boolean) => ({
  episode: { id: 'e1', item: 'chai', state, result: null, invoice_id: 'i1' },
  decisions: [
    {
      id: 'd1',
      step: 1,
      model: 'zg-model',
      request_id: 'req-1',
      chat_id: 'chat-1',
      latency_ms: 812,
      provider: 'router-api.0g.ai/zg-model@0x00000000000000000000000000000000000000f0',
      action: 'pay',
      reason: 'under the cap',
      outcome: null,
      error: null,
    },
  ],
  chipRequest: { id: 'c1', status: paid ? 'signed' : 'delivered', refusal_code: null },
  payment: paid ? { status: 'paid', txHash, invoice: { id: 'i1', amount: '100000', payTo: payee } } : null,
  evidence: null,
})

const activityRow = (id: string, item: string, state: string, amount: string, tx: string | null) => ({
  id,
  robotId: pairedRobot.id,
  robotName: 'Duck',
  item,
  state,
  createdAt: 0,
  amount,
  txHash: tx,
})
const summary = (id: string, item: string, state: string, reason: string) => ({
  id,
  robotId: pairedRobot.id,
  robotName: 'Duck',
  item,
  state,
  result: null,
  createdAt: 0,
  endedAt: null,
  decision: { action: 'pay', reason, requestId: 'req-1', provider: 'router-api.0g.ai/m', latencyMs: 900 },
  payment: null,
  approval: null,
  evidence: null,
})
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
      expect(role('link', { name: 'Add a robot' })).toHaveAttr('href', '/wallet/robots'),
      expect(role('link', { name: /Duck/ })).toHaveAttr('href', `/robot/${pairedRobot.id}`),
      expect(text('Bought chai')).toExist(),
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
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
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
      activity: { episodes: [activityRow('e2', 'cigarettes', 'awaiting_approval', '500000', null)], grants: [] },
      episodes: [summary('e2', 'cigarettes', 'awaiting_approval', 'Restricted item the owner asked for')],
      needsYou: [
        {
          episodeId: 'e2',
          approvalId: 'ap1',
          robotId: pairedRobot.id,
          robotName: 'Duck',
          item: 'cigarettes',
          amount: '500000',
          reason: 'Restricted item the owner asked for',
        },
      ],
    })
    scene(
      { update: Wallet.update, view },
      given(loadedHome(waiting)),
      expect(role('heading', { name: 'Needs you' })).toExist(),
      expect(text('I want to buy cigarettes for 0.50 USDC, and that needs your OK first.')).toExist(),
      expect(text('0G: “Restricted item the owner asked for”')).toExist(),
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

describe('/wallet/robots', () => {
  const view = withViewInputs(robotsView, { locale: 'en' })()

  test('adding a robot shows its single-use pairing code', () => {
    scene(
      { update: Robots.update, view },
      given(loadedRobots([])),
      expect(text('No robots yet. Add one and pair its chip.')).toExist(),
      type(label('Robot name'), 'Duck'),
      submit(selector('form')),
      Command.expectExact(Robots.AddRobot({ name: 'Duck' })),
      Command.resolve(
        Robots.AddRobot,
        Robots.Message.SucceededAddRobot({
          robot: { robotId: pairedRobot.id, name: 'Duck', pairingCode: 'K7Q2M9XZ', pairingExpiresAt: 0 },
        }),
      ),
      expect(text('Pair Duck with this code:')).toExist(),
      expect(text('K7Q2M9XZ')).toExist(),
      Command.resolve(
        Robots.LoadRobots,
        Robots.Message.SucceededLoadRobots({
          robots: [
            {
              ...pairedRobot,
              status: 'unpaired',
              chipAddress: null,
              pairingCode: 'K7Q2M9XZ',
              pairingExpiresAt: 1,
              lease: { until: null, online: false },
            },
          ],
          maybeMerchant: Option.some({ name: 'Duck Café', payTo: payee }),
        }),
      ),
      expect(text('not paired yet · offline')).toExist(),
      Command.expectExact(Robots.LoadRobots({ delayMillis: 3000 })),
      Command.resolve(
        Robots.LoadRobots,
        Robots.Message.SucceededLoadRobots({
          robots: [pairedRobot],
          maybeMerchant: Option.some({ name: 'Duck Café', payTo: payee }),
        }),
      ),
      expect(text('paired · online')).toExist(),
      Command.expectNone(),
    )
  })

  test('granting a budget signs with the passkey using the form terms and the merchant as the payee', () => {
    scene(
      { update: Robots.update, view },
      given(loadedRobots([pairedRobot])),
      expect(text('paired · online')).toExist(),
      click(role('button', { name: 'Grant a budget' })),
      expect(label('Allowed payees (addresses)')).toHaveValue(payee),
      expect(
        text(
          'Vitaquack may spend up to 1.00 USDC a day, at most 0.30 USDC per payment, only at Duck Café, for the next 24 hours. You sign this with your passkey; Arc enforces it.',
        ),
      ).toExist(),
      type(label('Per-payment cap (USDC)'), '0.25'),
      submit(selector('form.grant-form')),
      expect(role('button', { name: 'Signing and activating on Arc...' })).toBeDisabled(),
      Command.expectExact(
        Robots.GrantBudget({
          robotId: pairedRobot.id,
          dailyCap: '1.00',
          perPaymentCap: '0.25',
          allowlist: [payee],
          hours: 24,
        }),
      ),
      Command.resolve(
        Robots.GrantBudget,
        Robots.Message.FailedGrantBudget({
          failure: ActionFailure.Server({ error: 'not configured: ENFORCER_ADDRESS' }),
        }),
      ),
      expect(role('alert')).toHaveText('Something went wrong: not configured: ENFORCER_ADDRESS'),
      submit(selector('form.grant-form')),
      Command.resolve(Robots.GrantBudget, Robots.Message.SucceededGrantBudget()),
      Command.resolve(
        Robots.LoadRobots,
        Robots.Message.SucceededLoadRobots({
          robots: [{ ...pairedRobot, grant }],
          maybeMerchant: Option.some({ name: 'Duck Café', payTo: payee }),
        }),
      ),
      expect(role('button', { name: 'Revoke grant' })).toExist(),
    )
  })

  test('an active grant shows its terms and can be revoked; a dismissed passkey says so', () => {
    scene(
      { update: Robots.update, view },
      given(loadedRobots([{ ...pairedRobot, grant }])),
      expect(text('Budget: 1.00 USDC a day, at most 0.30 USDC per payment (active)')).toExist(),
      expect(role('button', { name: 'Grant a budget' })).toBeAbsent(),
      click(role('button', { name: 'Revoke grant' })),
      expect(role('button', { name: 'Revoking on Arc...' })).toBeDisabled(),
      Command.expectExact(Robots.RevokeGrant({ grantId: grant.id })),
      Command.resolve(Robots.RevokeGrant, Robots.Message.FailedRevokeGrant({ failure: ActionFailure.Passkey() })),
      expect(role('alert')).toHaveText('The passkey step did not finish. Please try again.'),
      expect(role('link', { name: 'Open console' })).toHaveAttr('href', `/robot/${pairedRobot.id}`),
    )
  })
})

describe('/robot/:id', () => {
  const view = withViewInputs(robotConsoleView, { locale: 'en' })()
  const robotId = pairedRobot.id
  const loaded = RobotConsole.update(
    RobotConsole.init(robotId).model,
    RobotConsole.Message.SucceededLoadConsole({
      robot: {
        robot: { id: robotId, name: 'Duck', status: 'paired', chipAddress: pairedRobot.chipAddress },
        lease: { until: 1, online: true },
        grant,
      },
      catalogue: {
        merchantId: 'duck-cafe',
        name: 'Duck Café',
        items: [
          { itemId: 'cigarettes', name: 'Cigarettes', amount: '500000', restricted: true },
          { itemId: 'samosa', name: 'Samosa', amount: '250000', restricted: false },
          { itemId: 'chai', name: 'Chai', amount: '100000', restricted: false },
        ],
      },
      maybeLatestEpisode: Option.none(),
    }),
  ).model

  test('an errand shows the 0G decision with its request id, polls while live and links the payment', () => {
    scene(
      { update: RobotConsole.update, view },
      given(loaded),
      expect(text('Chip online: its lease is current.')).toExist(),
      click(role('button', { name: 'Buy Chai (0.10 USDC)' })),
      Command.expectExact(RobotConsole.StartErrand({ robotId, item: 'chai', invoiceId: null })),
      Command.resolve(
        RobotConsole.StartErrand,
        RobotConsole.Message.SucceededStartErrand({ episodeId: 'e1', maybeApprovalUrl: Option.none() }),
      ),
      Command.expectExact(RobotConsole.PollErrand({ robotId, episodeId: 'e1', delayMillis: 0 })),
      Command.resolve(
        RobotConsole.PollErrand,
        RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e1', detail: detail('signing', false) }),
      ),
      expect(text('chai: chip signing')).toExist(),
      expect(text('0G decided to pay: under the cap')).toExist(),
      expect(text('The chip is checking the invoice and signing')).toExist(),
      expect(
        text('request id req-1 · router-api.0g.ai/zg-model@0x00000000000000000000000000000000000000f0 · 812 ms'),
      ).toExist(),
      expect(role('button', { name: 'Buy Chai (0.10 USDC)' })).toBeDisabled(),
      Command.expectExact(RobotConsole.PollErrand({ robotId, episodeId: 'e1', delayMillis: 1500 })),
      Command.resolve(
        RobotConsole.PollErrand,
        RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e1', detail: detail('paid', true) }),
      ),
      expect(text('chai: paid')).toExist(),
      expect(text('The chip signed the payment')).toExist(),
      expect(role('link', { name: 'Payment on Arc' })).toHaveAttr('href', `https://explorer.arc.io/tx/${txHash}`),
      Command.expectExact(RobotConsole.LoadConsole({ robotId })),
      Command.resolve(
        RobotConsole.LoadConsole,
        RobotConsole.Message.FailedLoadConsole({ error: 'offline', signedOut: false }),
      ),
      expect(role('alert')).toHaveText('Something went wrong: offline'),
    )
  })

  test('a decision from anything but 0G is labelled the rehearsal brain', () => {
    const rehearsal = detail('signing', false)
    const fromLiteLlm = {
      ...rehearsal,
      decisions: rehearsal.decisions.map((decision) => ({ ...decision, provider: 'litellm.example/deepseek-chat' })),
    }
    const started = RobotConsole.update(
      loaded,
      RobotConsole.Message.SucceededStartErrand({ episodeId: 'e9', maybeApprovalUrl: Option.none() }),
    ).model
    const decided = RobotConsole.update(
      started,
      RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e9', detail: fromLiteLlm }),
    ).model
    scene(
      { update: RobotConsole.update, view },
      given(decided),
      expect(text('The rehearsal brain (not 0G) decided to pay: under the cap')).toExist(),
      expect(text('request id req-1 · litellm.example/deepseek-chat · 812 ms')).toExist(),
    )
  })

  test("a pasted gate payment link pays the gate's invoice; a typo is flagged", () => {
    const invoiceId = 'abcdefghijklmnopqrstuvwxyz'
    scene(
      { update: RobotConsole.update, view },
      given(loaded),
      type(label('Invoice from the gate (optional)'), 'oops'),
      expect(role('alert')).toHaveText('That is not a 26-character invoice id or a payment link.'),
      type(label('Invoice from the gate (optional)'), `https://app.example/api/i/${invoiceId}`),
      expect(role('alert')).toBeAbsent(),
      click(role('button', { name: 'Buy Chai (0.10 USDC)' })),
      Command.expectExact(RobotConsole.StartErrand({ robotId, item: 'chai', invoiceId })),
      Command.resolve(
        RobotConsole.StartErrand,
        RobotConsole.Message.FailedStartErrand({ error: 'invoice already paid' }),
      ),
      expect(role('alert')).toHaveText('Something went wrong: invoice already paid'),
    )
  })

  test('after a reload while waiting for approval, the console finds the approval page again', () => {
    const waiting = { ...detail('awaiting_approval', false), chipRequest: null }
    scene(
      { update: RobotConsole.update, view },
      given(loaded),
      click(role('button', { name: 'Buy Cigarettes (0.50 USDC)' })),
      Command.resolve(
        RobotConsole.StartErrand,
        RobotConsole.Message.SucceededStartErrand({ episodeId: 'e3', maybeApprovalUrl: Option.none() }),
      ),
      Command.resolve(
        RobotConsole.PollErrand,
        RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e3', detail: waiting }),
      ),
      Command.expectHas(RobotConsole.FindApproval({ episodeId: 'e3' })),
      Command.resolve(
        RobotConsole.FindApproval,
        RobotConsole.Message.CompletedFindApproval({
          episodeId: 'e3',
          maybeApprovalUrl: Option.some('/wallet/approvals/ap3'),
        }),
      ),
      expect(role('link', { name: 'Approve in World App' })).toHaveAttr('href', '/wallet/approvals/ap3'),
      Command.resolve(RobotConsole.PollErrand, RobotConsole.Message.FailedLoadErrand({ episodeId: 'e3' })),
      Command.resolve(
        RobotConsole.PollErrand,
        RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e3', detail: detail('denied', false) }),
      ),
      Command.resolve(
        RobotConsole.LoadConsole,
        RobotConsole.Message.FailedLoadConsole({ error: 'x', signedOut: false }),
      ),
    )
  })

  test('a restricted item links the World approval page', () => {
    scene(
      { update: RobotConsole.update, view },
      given(loaded),
      click(role('button', { name: 'Buy Cigarettes (0.50 USDC)' })),
      Command.resolve(
        RobotConsole.StartErrand,
        RobotConsole.Message.SucceededStartErrand({
          episodeId: 'e2',
          maybeApprovalUrl: Option.some('/wallet/approvals/ap1'),
        }),
      ),
      expect(role('link', { name: 'Approve in World App' })).toHaveAttr('href', '/wallet/approvals/ap1'),
      Command.resolve(RobotConsole.PollErrand, RobotConsole.Message.FailedLoadErrand({ episodeId: 'e2' })),
      Command.resolve(
        RobotConsole.PollErrand,
        RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e2', detail: detail('denied', false) }),
      ),
      expect(text('chai: denied')).toExist(),
      expect(role('button', { name: 'Buy Cigarettes (0.50 USDC)' })).toBeEnabled(),
      Command.resolve(
        RobotConsole.LoadConsole,
        RobotConsole.Message.FailedLoadConsole({ error: 'offline', signedOut: false }),
      ),
    )
  })
})
