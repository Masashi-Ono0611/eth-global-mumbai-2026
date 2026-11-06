import { Option } from 'effect'
import { Command, Mount, click, expect, given, label, role, scene, text, type, withViewInputs } from 'foldkit/scene'
import { describe, test } from 'vitest'
import type { EpisodeSummary } from '../src/api/Episodes.ts'
import type { ConsoleRobot } from '../src/api/Robot.ts'
import * as RobotConsole from '../src/pages/RobotConsole.ts'
import { robotConsoleView } from '../src/pages/RobotConsoleView.ts'
import { detail, grant, pairedRobot, payee, summary, txHash } from './Fixtures.ts'
import { Dialog } from '@foldkit/ui'
import * as Allowance from '../src/pages/Allowance.ts'

describe('/robot/:id', () => {
  const view = withViewInputs(robotConsoleView, { locale: 'en', timeZone: 'UTC' })()
  const robotId = pairedRobot.id
  const consoleRobot: ConsoleRobot = {
    robot: { id: robotId, name: 'Duck', status: 'paired', chipAddress: pairedRobot.chipAddress },
    lease: { until: 1, online: true },
    grant,
  }
  const catalogue = {
    merchantId: 'duck-cafe',
    name: 'Duck Café',
    payTo: payee,
    items: [
      { itemId: 'chai', name: 'Chai', amount: '100000', restricted: false },
      { itemId: 'samosa', name: 'Samosa', amount: '250000', restricted: false },
      { itemId: 'thali', name: 'Thali', amount: '2000000', restricted: false },
    ],
  }
  const loadedConsole = (history: ReadonlyArray<EpisodeSummary> = [], robot: ConsoleRobot = consoleRobot) =>
    RobotConsole.update(
      RobotConsole.init(robotId).model,
      RobotConsole.Message.SucceededLoadConsole({
        robot,
        catalogue,
        history,
        amounts: { e1: '100000' },
        maybeLatestEpisode: Option.none(),
      }),
    ).model

  test('a tapped item becomes an errand: 0G decides, the chip signs, the receipt links Arc and the proof', () => {
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole()),
      expect(text('Nothing yet. Tap something below and Duck goes to buy it.')).toExist(),
      click(role('button', { name: 'Buy Chai for 0.10 USDC' })),
      Command.expectExact(RobotConsole.StartErrand({ robotId, item: 'chai', invoiceId: null })),
      expect(text('Buy chai')).toExist(),
      Command.resolve(
        RobotConsole.StartErrand,
        RobotConsole.Message.SucceededStartErrand({ episodeId: 'e1', maybeApprovalUrl: Option.none() }),
      ),
      Command.expectExact(RobotConsole.PollErrand({ robotId, episodeId: 'e1', delayMillis: 0 })),
      Command.resolve(
        RobotConsole.PollErrand,
        RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e1', detail: detail('signing', false) }),
      ),
      expect(text('0G decided: buy it')).toExist(),
      expect(text('under the cap')).toExist(),
      expect(text('My chip is signing the payment...')).toExist(),
      expect(role('button', { name: 'Buy Chai for 0.10 USDC' })).toBeDisabled(),
      expect(text('Duck is on an errand. The buttons come back when it ends.')).toExist(),
      Command.expectExact(RobotConsole.PollErrand({ robotId, episodeId: 'e1', delayMillis: 1500 })),
      Command.resolve(
        RobotConsole.PollErrand,
        RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e1', detail: detail('paid', true) }),
      ),
      expect(text('Paid with my chip')).toExist(),
      expect(text('0.10 USDC')).toExist(),
      expect(role('link', { name: 'On Arc' })).toHaveAttr('href', `https://explorer.arc.io/tx/${txHash}`),
      expect(role('link', { name: 'Show proof' })).toHaveAttr('href', '/wallet/episodes/e1'),
      Command.expectExact(RobotConsole.LoadConsole({ robotId })),
      Command.resolve(
        RobotConsole.LoadConsole,
        RobotConsole.Message.FailedLoadConsole({ error: 'offline', signedOut: false }),
      ),
      expect(role('alert')).toHaveText('Something went wrong: offline'),
    )
  })

  test('the history reads as a conversation, and a decision from anything but 0G is labelled the rehearsal brain', () => {
    const rehearsal = {
      ...summary('e5', 'samosa', 'safe_stop', 'no tool call'),
      result: '0G did not answer',
      decision: { action: 'pay', reason: 'cheap', requestId: null, provider: 'litellm.example/deepseek', latencyMs: 1 },
    }
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([summary('e1', 'chai', 'paid', 'within budget'), rehearsal])),
      expect(text('0G decided: buy it')).toExist(),
      expect(text('Paid with my chip')).toExist(),
      expect(text('The rehearsal brain (not 0G) decided: buy it')).toExist(),
      expect(text('I stopped safely and paid nothing: 0G did not answer')).toExist(),
    )
  })

  test('a robot without an allowance cannot be sent out', () => {
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([], { ...consoleRobot, grant: null })),
      expect(text('No allowance')).toExist(),
      expect(text("Duck has no allowance yet, so it can't buy anything.")).toExist(),
      expect(role('button', { name: 'Buy Chai for 0.10 USDC' })).toBeDisabled(),
    )
  })

  test('a stopped allowance still sends the robot out, so Arc can refuse the payment on-chain', () => {
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([], { ...consoleRobot, grant: { ...grant, status: 'revoked' } })),
      expect(text('No allowance')).toExist(),
      expect(text("Duck's allowance is stopped. Send it anyway and Arc refuses the payment on-chain.")).toExist(),
      expect(role('button', { name: 'Buy Chai for 0.10 USDC' })).toBeEnabled(),
    )
  })

  test("a pasted gate payment link pays the gate's invoice; a typo is flagged", () => {
    const invoiceId = 'abcdefghijklmnopqrstuvwxyz'
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole()),
      type(label('Invoice from the gate (optional)'), 'oops'),
      expect(role('alert')).toHaveText('That is not a 26-character invoice id or a payment link.'),
      type(label('Invoice from the gate (optional)'), `https://app.example/api/i/${invoiceId}`),
      expect(role('alert')).toBeAbsent(),
      click(role('button', { name: 'Buy Chai for 0.10 USDC' })),
      Command.expectExact(RobotConsole.StartErrand({ robotId, item: 'chai', invoiceId })),
      Command.resolve(
        RobotConsole.StartErrand,
        RobotConsole.Message.FailedStartErrand({ error: 'invoice already paid' }),
      ),
      expect(role('alert')).toHaveText('I could not start: invoice already paid'),
    )
  })

  test('a payment over the per-payment limit asks in the conversation: Approve goes to World, No declines it there', () => {
    const waiting = {
      ...detail('awaiting_approval', false),
      episode: { id: 'e2', item: 'thali', state: 'awaiting_approval', result: null, invoice_id: 'i2' },
      chipRequest: null,
    }
    const started = RobotConsole.update(
      loadedConsole(),
      RobotConsole.Message.SucceededStartErrand({
        episodeId: 'e2',
        maybeApprovalUrl: Option.some('/wallet/approvals/ap1'),
      }),
    ).model
    const asking = RobotConsole.update(
      started,
      RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e2', detail: waiting }),
    ).model
    scene(
      { update: RobotConsole.update, view },
      given(asking),
      expect(text('I need your OK')).toExist(),
      expect(text('Thali needs your OK before I can pay. Approving pays this once.')).toExist(),
      expect(role('link', { name: 'Approve with World ID' })).toHaveAttr('href', '/api/world/authorize?approval=ap1'),
      click(role('button', { name: 'No' })),
      Command.expectExact(RobotConsole.DeclineInThread({ approvalId: 'ap1' })),
      expect(role('button', { name: 'Saying no...' })).toBeDisabled(),
      Command.resolve(RobotConsole.DeclineInThread, RobotConsole.Message.SucceededDecline()),
      Command.expectExact(RobotConsole.PollErrand({ robotId, episodeId: 'e2', delayMillis: 0 })),
      Command.resolve(
        RobotConsole.PollErrand,
        RobotConsole.Message.SucceededLoadErrand({
          episodeId: 'e2',
          detail: { ...waiting, episode: { ...waiting.episode, state: 'denied' } },
        }),
      ),
      expect(text('You said no. Nothing was paid.')).toExist(),
      Command.resolve(
        RobotConsole.LoadConsole,
        RobotConsole.Message.FailedLoadConsole({ error: 'x', signedOut: false }),
      ),
    )
  })

  test('after a reload while waiting for approval, the conversation finds the approval again', () => {
    const waiting = { ...detail('awaiting_approval', false), chipRequest: null }
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole()),
      click(role('button', { name: 'Buy Thali for 2.00 USDC' })),
      Command.resolve(
        RobotConsole.StartErrand,
        RobotConsole.Message.SucceededStartErrand({ episodeId: 'e3', maybeApprovalUrl: Option.none() }),
      ),
      Command.resolve(
        RobotConsole.PollErrand,
        RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e3', detail: waiting }),
      ),
      expect(text('Waiting for your answer')).toExist(),
      Command.expectHas(RobotConsole.FindApproval({ episodeId: 'e3' })),
      Command.resolve(
        RobotConsole.FindApproval,
        RobotConsole.Message.CompletedFindApproval({
          episodeId: 'e3',
          maybeApprovalUrl: Option.some('/wallet/approvals/ap3'),
        }),
      ),
      expect(role('link', { name: 'Approve with World ID' })).toHaveAttr('href', '/api/world/authorize?approval=ap3'),
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

  test('the allowance pill opens the sheet: Stop revokes with the passkey, then the robot is re-read', () => {
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole()),
      click(role('button', { name: 'Allowance: 1.00 a day' })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      expect(role('heading', { name: "Duck's allowance" })).toExist(),
      expect(text('At most 0.30 for one purchase')).toExist(),
      expect(text('Only at Duck Café')).toExist(),
      click(role('button', { name: "Stop Duck's allowance" })),
      Command.expectExact(Allowance.StopAllowance({ grantId: grant.id })),
      expect(role('button', { name: 'Stopping on Arc...' })).toBeDisabled(),
      Command.resolve(Allowance.StopAllowance, Allowance.Message.SucceededStop()),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
      Command.expectExact(RobotConsole.LoadConsole({ robotId })),
      Command.resolve(
        RobotConsole.LoadConsole,
        RobotConsole.Message.FailedLoadConsole({ error: 'x', signedOut: false }),
      ),
      Mount.expectEnded(Dialog.AcquireResources),
    )
  })

  test('a robot without an allowance gets one from presets, signed with the passkey', () => {
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([], { ...consoleRobot, grant: null })),
      click(role('button', { name: 'No allowance: give one' })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      expect(role('heading', { name: 'Give Duck an allowance' })).toExist(),
      click(role('radio', { name: '5.00' })),
      click(role('radio', { name: '1 week' })),
      expect(
        text(
          'Duck can spend up to 5.00 USDC a day, at most 1.00 at a time, only at Duck Café, for the next week. Anything else asks you first. Arc enforces this, so not even our server can go past it.',
        ),
      ).toExist(),
      click(role('button', { name: 'Confirm with passkey' })),
      Command.expectExact(
        Allowance.GrantAllowance({ robotId, dailyCap: '5.00', perPaymentCap: '1.00', allowlist: [payee], hours: 168 }),
      ),
      Command.resolve(Allowance.GrantAllowance, Allowance.Message.FailedGrant({ failure: { _tag: 'Passkey' } })),
      expect(role('alert')).toHaveText('The passkey step did not finish. Please try again.'),
    )
  })
})
