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
import type { IntentView } from '@ethmumbai/protocol/Intent'
import type { EpisodeSummary } from '../src/api/Episodes.ts'
import type { ConsoleRobot } from '../src/api/Robot.ts'
import * as RobotConsole from '../src/pages/RobotConsole.ts'
import { robotConsoleView } from '../src/pages/RobotConsoleView.ts'
import { detail, grant, pairedRobot, payee, summary, txHash } from './Fixtures.ts'
import { Animation, Dialog } from '@foldkit/ui'
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
      expect(role('link', { name: 'Show proof' })).toHaveAttr('href', '/app/wallet/episodes/e1'),
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

  test('a receipt says where its record is on 0G, and a TEE-verified decision is marked', () => {
    const saved = {
      ...summary('e1', 'chai', 'paid', 'within budget'),
      decision: {
        action: 'pay',
        reason: 'within budget',
        requestId: 'r1',
        provider: 'router-api.0g.ai/m@0x01',
        latencyMs: 900,
        tee: { verified: true },
      },
      payment: { status: 'settled', txHash },
      evidence: { status: 'uploaded', rootHash: '0xroot', logTx: '0xlog' },
    }
    const saving = {
      ...summary('e2', 'chai', 'denied', 'over the limit'),
      evidence: { status: 'pending', rootHash: null, logTx: null },
    }
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([saved, saving])),
      expect(text('TEE-verified')).toExist(),
      expect(text('Saved on 0G')).toExist(),
      expect(role('link', { name: '0G Storage' })).toHaveAttr('href', 'https://storagescan-galileo.0g.ai/file/0xroot'),
      expect(role('link', { name: 'EpisodeLog record' })).toHaveAttr(
        'href',
        'https://chainscan-galileo.0g.ai/tx/0xlog',
      ),
      expect(text('Saving to 0G...')).toExist(),
    )
  })

  test('an errand opens with what the robot saw: the scanned QR crop, the item and price; a sim says whose camera', () => {
    const scanned = {
      ...summary('e1', 'chai', 'paid', 'within budget'),
      observation: { sha256: '0xabc', capturedAt: 1 },
    }
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([scanned])),
      expect(text('What I saw at the counter')).toExist(),
      expect(role('img', { name: 'The QR code Duck read at the counter' })).toHaveAttr(
        'src',
        '/api/wallet/episodes/e1/observations/0xabc',
      ),
      expect(text('Duck Café: Chai, 0.10 USDC')).toExist(),
      expect(text("Seen by the simulator's camera")).not.toExist(),
    )
    const stored = { ...scanned, observation: { sha256: '0xabc', capturedAt: 1, rootHash: '0xframe' } }
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([stored])),
      expect(role('link', { name: 'Frame on 0G Storage' })).toHaveAttr(
        'href',
        'https://storagescan-galileo.0g.ai/file/0xframe',
      ),
    )
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([scanned], { ...consoleRobot, robot: { ...consoleRobot.robot, kind: 'sim' } })),
      expect(text("Seen by the simulator's camera")).toExist(),
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

  test("with the day reported, the pill says what is left and the sheet shows the day's use and its reset", () => {
    const today = {
      ...consoleRobot,
      grant: { ...grant, dailyCap: '3000000', spentToday: '2100000', periodEndsAt: 1793986400 },
    }
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([], today)),
      expect(text('0.90')).toExist(),
      expect(text('of 3.00 today')).toExist(),
      click(role('button', { name: 'Allowance: 0.90 of 3.00 USDC left today' })),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Command.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint({ generation: 1 })),
      Command.resolve(Animation.WaitForAnimationSettled, Animation.Message.EndedAnimation({ generation: 1 })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      expect(text('left of 3.00 today')).toExist(),
      expect(role('meter', { name: 'Spent today: 2.10 of 3.00 USDC' })).toExist(),
      expect(text('Resets at', { exact: false })).toExist(),
    )
  })

  test('the allowance pill opens the sheet: Stop revokes with the passkey, then the robot is re-read', () => {
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole()),
      click(role('button', { name: 'Allowance: 1.00 a day' })),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Command.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint({ generation: 1 })),
      Command.resolve(Animation.WaitForAnimationSettled, Animation.Message.EndedAnimation({ generation: 1 })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      expect(role('heading', { name: "Duck's allowance" })).toExist(),
      expect(text('At most 0.30 for one purchase')).toExist(),
      expect(text('Only at Duck Café')).toExist(),
      click(role('button', { name: "Stop Duck's allowance" })),
      Command.expectExact(Allowance.StopAllowance({ grantId: grant.id })),
      expect(role('button', { name: 'Stopping on Arc...' })).toBeDisabled(),
      Command.resolve(Allowance.StopAllowance, Allowance.Message.SucceededStop()),
      Command.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint({ generation: 2 })),
      Command.resolve(Animation.WaitForAnimationSettled, Animation.Message.EndedAnimation({ generation: 2 })),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
      Command.expectExact(RobotConsole.LoadConsole({ robotId })),
      Command.resolve(
        RobotConsole.LoadConsole,
        RobotConsole.Message.FailedLoadConsole({ error: 'x', signedOut: false }),
      ),
      Mount.expectEnded(Dialog.AcquireResources),
    )
  })

  test("the allowance sheet folds away the robot's details: chip, payee, signed allowance, paired", () => {
    const detailed = {
      ...consoleRobot,
      robot: { ...consoleRobot.robot, pairedAt: 1793900000 },
      grant: { ...grant, delegationHash: '0xfeed' },
    }
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([], detailed)),
      click(role('button', { name: 'Allowance: 1.00 a day' })),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Command.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint({ generation: 1 })),
      Command.resolve(Animation.WaitForAnimationSettled, Animation.Message.EndedAnimation({ generation: 1 })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      expect(text('Robot details')).toExist(),
      expect(text('Chip (signs every payment)')).toExist(),
      expect(text('0x0000 0000 0000 0000 0000 0000 0000 0000 000c 41f0')).toExist(),
      expect(text('0xfeed')).toExist(),
    )
  })

  test('a robot without an allowance gets one from presets, signed with the passkey', () => {
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([], { ...consoleRobot, grant: null })),
      click(role('button', { name: 'No allowance: give one' })),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Command.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint({ generation: 1 })),
      Command.resolve(Animation.WaitForAnimationSettled, Animation.Message.EndedAnimation({ generation: 1 })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),

      expect(role('heading', { name: 'Give Duck an allowance' })).toExist(),
      click(role('radio', { name: '5.00' })),
      click(role('radio', { name: '1 week' })),
      expect(
        text(
          'Duck can spend up to 5.00 USDC a day, only at Duck Café, for the next week. A purchase over 1.00 asks you first in World App; nothing goes past 5.00 a day. Arc enforces this, so not even our server can go past it.',
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

  test("a real robot's Get me chips send an intent that waits for its own scan; Buy still pays the counter now", () => {
    const waiting: IntentView = {
      id: 'intentintentintentintentaa',
      robotId,
      state: 'running',
      instruction: 'Get me a chai',
      item: 'chai',
      episodeId: null,
      episodeState: null,
      reason: null,
      turns: [],
      createdAt: 1,
    }
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole()),
      expect(role('link', { name: 'Open simulator' })).not.toExist(),
      click(role('button', { name: 'Get me a chai' })),
      Command.expectExact(RobotConsole.SendIntent({ robotId, instruction: 'Get me a chai', item: 'chai' })),
      Command.resolve(RobotConsole.SendIntent, RobotConsole.Message.SucceededCreateIntent({ intent: waiting })),
      expect(text('Waiting for Duck to scan the QR code at the counter.')).toExist(),
      expect(role('button', { name: 'Stop Duck' })).toBeEnabled(),
      expect(role('button', { name: 'Buy Chai for 0.10 USDC' })).toBeDisabled(),
      Command.resolve(RobotConsole.PollIntent, RobotConsole.Message.FailedLoadIntent({ intentId: 'other' })),
    )
  })

  describe('a simulator robot', () => {
    const simRobot: ConsoleRobot = { ...consoleRobot, robot: { ...consoleRobot.robot, kind: 'sim' } }
    const intentId = 'intentintentintentintentaa'
    const episodeId = 'episodeepisodeepisodeepisa'
    const intent = (state: IntentView['state'], maybeEpisode: string | null): IntentView => ({
      id: intentId,
      robotId,
      state,
      instruction: 'Get me a chai',
      item: 'chai',
      episodeId: maybeEpisode,
      episodeState: null,
      reason: state === 'stopped' ? '0G brain busy' : null,
      turns: [
        {
          step: 1,
          model: 'glm-5.3',
          chatId: null,
          latencyMs: 900,
          calls: [
            { id: 'c1', name: 'say', args: { text: 'Off to the chai stall!' } },
            { id: 'c2', name: 'go_to', args: { place: 'chai_stall' } },
          ],
          reasoning: null,
          error: null,
          tee: null,
          createdAt: 1,
        },
      ],
      createdAt: 1,
    })

    test('a Buy chip sends the owner an intent; the duck says what it does and walks; Open simulator links it', () => {
      scene(
        { update: RobotConsole.update, view },
        given(loadedConsole([], simRobot)),
        expect(role('link', { name: 'Open simulator' })).toHaveAttr('href', `/sim/?robot=${robotId}`),
        click(role('button', { name: 'Buy Chai for 0.10 USDC' })),
        Command.expectExact(RobotConsole.SendIntent({ robotId, instruction: 'Get me a chai', item: 'chai' })),
        Command.resolve(
          RobotConsole.SendIntent,
          RobotConsole.Message.SucceededCreateIntent({ intent: intent('running', null) }),
        ),
        expect(text('Get me a chai')).toExist(),
        expect(text('Off to the chai stall!')).toExist(),
        expect(text('Walking to the chai stall')).toExist(),
        expect(role('button', { name: 'Stop Duck' })).toBeEnabled(),
        expect(role('button', { name: 'Buy Chai for 0.10 USDC' })).toBeDisabled(),
        Command.expectExact(RobotConsole.PollIntent({ robotId, intentId, delayMillis: 2000 })),
        Command.resolve(RobotConsole.PollIntent, RobotConsole.Message.FailedLoadIntent({ intentId: 'other' })),
      )
    })

    test('typed words go out as the same intent', () => {
      scene(
        { update: RobotConsole.update, view },
        given(loadedConsole([], simRobot)),
        type(label('Tell Duck what to get'), 'a samosa please'),
        submit(selector('form')),
        Command.expectExact(RobotConsole.SendIntent({ robotId, instruction: 'a samosa please', item: null })),
        Command.resolve(
          RobotConsole.SendIntent,
          RobotConsole.Message.FailedCreateIntent({ error: 'not configured: sim' }),
        ),
        expect(role('alert')).toHaveText('I could not set off: not configured: sim'),
      )
    })

    test("the duck's scan becomes an errand, which the conversation then follows; Stop halts it", () => {
      const walking = RobotConsole.update(
        loadedConsole([], simRobot),
        RobotConsole.Message.SucceededCreateIntent({ intent: intent('running', null) }),
      ).model
      const scanned = RobotConsole.update(
        walking,
        RobotConsole.Message.SucceededLoadIntent({ intent: intent('scanned', episodeId) }),
      )
      vitestExpect(scanned.commands?.map((command) => [command.name, command.args])).toEqual([
        ['PollIntent', { robotId, intentId, delayMillis: 2000 }],
        ['PollErrand', { robotId, episodeId, delayMillis: 0 }],
      ])
      scene(
        { update: RobotConsole.update, view },
        given(walking),
        click(role('button', { name: 'Stop Duck' })),
        Command.expectExact(RobotConsole.HaltIntent({ robotId, intentId })),
        expect(role('button', { name: 'Stopping...' })).toBeDisabled(),
        Command.resolve(
          RobotConsole.HaltIntent,
          RobotConsole.Message.SucceededStopIntent({ intent: intent('stopped', null) }),
        ),
        expect(text('I stopped: 0G brain busy')).toExist(),
        expect(role('button', { name: 'Buy Chai for 0.10 USDC' })).toBeEnabled(),
      )
    })
  })
})
