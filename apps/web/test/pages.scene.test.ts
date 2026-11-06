import { Option } from 'effect'
import {
  Command,
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
import { describe, test } from 'vitest'
import { ActionFailure } from '../src/api/OwnerAction.ts'
import type { RobotView } from '../src/api/Wallet.ts'
import * as Approval from '../src/pages/Approval.ts'
import * as RobotConsole from '../src/pages/RobotConsole.ts'
import { robotConsoleView } from '../src/pages/RobotConsoleView.ts'
import * as Robots from '../src/pages/Robots.ts'
import { robotsView } from '../src/pages/RobotsView.ts'
import * as Wallet from '../src/pages/Wallet.ts'

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
  Robots.update(Robots.init().model, Robots.Message.SucceededLoadRobots({ robots, maybePayee: Option.some(payee) }))
    .model

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

describe('/wallet', () => {
  const view = withViewInputs(Wallet.view, { locale: 'en' })()
  const loadedWallet = Wallet.update(
    Wallet.init().model,
    Wallet.Message.SucceededLoadWallet({
      wallet: {
        account: {
          accountId: 'a',
          displayName: 'Ana',
          smartAccount: address,
          deployStatus: 'deployed',
          deployTx: txHash,
        },
        balance: { units: '1230000', usdc: '1.23' },
        fund: { network: 'eip155:5042', asset: '0x3600000000000000000000000000000000000000', address },
      },
      activity: {
        episodes: [
          {
            id: 'e1',
            robotId: pairedRobot.id,
            robotName: 'Duck',
            item: 'chai',
            state: 'paid',
            createdAt: 0,
            amount: '100000',
            txHash,
          },
        ],
        grants: [],
      },
    }),
  ).model

  test('loads on start and shows the balance, the smart account, fund instructions and the activity', () => {
    scene({ update: Wallet.update, view }, given(Wallet.init().model), expect(role('status')).toHaveText('Loading...'))
    scene(
      { update: Wallet.update, view },
      given(loadedWallet),
      expect(text('1.23 USDC')).toExist(),
      expect(role('link', { name: address })).toHaveAttr('href', `https://explorer.arc.io/address/${address}`),
      expect(text('Your smart account is deployed on Arc.')).toExist(),
      expect(text('Duck · chai')).toExist(),
      expect(text('paid')).toExist(),
      expect(role('link', { name: 'View transaction' })).toHaveAttr('href', `https://explorer.arc.io/tx/${txHash}`),
      expect(role('link', { name: 'Robots' })).toHaveAttr('href', '/wallet/robots'),
      click(role('button', { name: 'Refresh' })),
      Command.expectExact(Wallet.LoadWallet()),
      Command.resolve(Wallet.LoadWallet, Wallet.Message.FailedLoadWallet({ error: 'not signed in', signedOut: true })),
      expect(role('alert')).toHaveText('Sign in with your passkey to see this page.'),
      expect(role('link', { name: 'Sign in with passkey' })).toHaveAttr('href', '/'),
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
        Robots.Message.SucceededLoadRobots({ robots: [], maybePayee: Option.some(payee) }),
      ),
    )
  })

  test('granting a budget signs with the passkey using the form terms and the merchant as the payee', () => {
    scene(
      { update: Robots.update, view },
      given(loadedRobots([pairedRobot])),
      expect(text('paired · online')).toExist(),
      click(role('button', { name: 'Grant a budget' })),
      expect(label('Allowed payees (addresses)')).toHaveValue(payee),
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
        Robots.Message.SucceededLoadRobots({ robots: [{ ...pairedRobot, grant }], maybePayee: Option.some(payee) }),
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
        items: [
          { itemId: 'chai', name: 'Chai', amount: '100000', restricted: false },
          { itemId: 'cigarettes', name: 'Cigarettes', amount: '500000', restricted: true },
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
      Command.expectExact(RobotConsole.StartErrand({ robotId, item: 'chai' })),
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
      expect(text('0G decided pay: under the cap')).toExist(),
      expect(text('request id req-1 · zg-model · 812 ms')).toExist(),
      expect(role('button', { name: 'Buy Chai (0.10 USDC)' })).toBeDisabled(),
      Command.expectExact(RobotConsole.PollErrand({ robotId, episodeId: 'e1', delayMillis: 1500 })),
      Command.resolve(
        RobotConsole.PollErrand,
        RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e1', detail: detail('paid', true) }),
      ),
      expect(text('chai: paid')).toExist(),
      expect(role('link', { name: 'Payment on Arc' })).toHaveAttr('href', `https://explorer.arc.io/tx/${txHash}`),
      Command.expectExact(RobotConsole.LoadConsole({ robotId })),
      Command.resolve(
        RobotConsole.LoadConsole,
        RobotConsole.Message.FailedLoadConsole({ error: 'offline', signedOut: false }),
      ),
      expect(role('alert')).toHaveText('Something went wrong: offline'),
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

const approval = (status: string, error: string | null = null) => ({
  id: 'ap1',
  status,
  error,
  item: 'cigarettes',
  robotName: 'Duck',
  robotId: pairedRobot.id,
  invoiceId: 'inv1',
  payee: '0x000000000000000000000000000000000000dead',
  amount: '500000',
  closesAt: 0,
  worldConfigured: true,
})

describe('/wallet/approvals/:id', () => {
  const view = withViewInputs(Approval.view, { locale: 'en' })()

  test('a restricted item asks for World approval; the owner can deny it and nothing is paid', () => {
    scene(
      { update: Approval.update, view },
      given(Approval.init('ap1').model),
      expect(role('status')).toHaveText('Loading...'),
    )
    scene(
      { update: Approval.update, view },
      given(
        Approval.update(
          Approval.init('ap1').model,
          Approval.Message.SucceededLoadApproval({ approval: approval('requested') }),
        ).model,
      ),
      expect(role('heading', { name: 'Approval for a restricted item' })).toExist(),
      expect(text('cigarettes · Duck')).toExist(),
      expect(text('0.50 USDC')).toExist(),
      expect(role('status')).toHaveText('Waiting for your answer'),
      expect(role('link', { name: 'Approve with World' })).toHaveAttr('href', '/api/world/authorize?approval=ap1'),
      click(role('button', { name: 'Deny' })),
      Command.expectExact(Approval.DenyApproval({ approvalId: 'ap1' })),
      Command.resolve(Approval.DenyApproval, Approval.Message.SucceededDenyApproval()),
      Command.expectExact(Approval.LoadApproval({ approvalId: 'ap1', delayMillis: 0 })),
      Command.resolve(
        Approval.LoadApproval,
        Approval.Message.SucceededLoadApproval({ approval: approval('denied', 'denied by the owner') }),
      ),
      expect(role('status')).toHaveText('Denied: nothing is paid'),
      expect(text('denied by the owner')).toExist(),
      expect(role('link', { name: 'Approve with World' })).toBeAbsent(),
    )
  })

  test('after World approves, the page says the chip signs now', () => {
    scene(
      { update: Approval.update, view },
      given(
        Approval.update(
          Approval.init('ap1').model,
          Approval.Message.SucceededLoadApproval({ approval: approval('approved') }),
        ).model,
      ),
      expect(role('status')).toHaveText('Approved: the chip signs the payment now'),
      expect(role('button', { name: 'Deny' })).toBeAbsent(),
      expect(role('link', { name: 'Open console' })).toHaveAttr('href', `/robot/${pairedRobot.id}`),
    )
  })
})
