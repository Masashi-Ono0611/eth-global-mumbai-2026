import { Option } from 'effect'
import { Command, Mount, click, expect, given, label, role, scene, text } from 'foldkit/scene'
import { describe, expect as vitestExpect, test } from 'vitest'
import type { IntentView } from '@ethmumbai/protocol/Intent'
import * as RobotConsole from '../src/pages/RobotConsole.ts'
import { consoleRobot, consoleView, loadedConsole, resumedConsole, robotId } from './ConsoleFixtures.ts'
import { detail, grant, payee, summary, txHash } from './Fixtures.ts'
import { Animation, Dialog } from '@foldkit/ui'
import * as Allowance from '../src/pages/Allowance.ts'

describe('/robot/:id', () => {
  const view = consoleView
  test("the robot's errand runs in the conversation: 0G decides, the chip signs, the receipt links the proof and Arc", () => {
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole()),
      expect(text('Nothing yet. Ask Duck for something below.')).toExist(),
      // The ready dock says nothing: the pills and the composer speak for themselves.
      expect(role('button', { name: 'Get me a chai, 0.10 USDC' })).toBeEnabled(),
      expect(role('button', { name: 'Get me a chai, 0.10 USDC' })).not.toHaveAttr('aria-describedby'),
    )
    // The errand the robot's scan started (or a reload found) is followed in the thread.
    const resumed = resumedConsole('e1')
    const signing = RobotConsole.update(
      resumed,
      RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e1', detail: detail('signing', false) }),
    )
    vitestExpect(signing.commands?.map((command) => command.name)).toContain('PollErrand')
    scene(
      { update: RobotConsole.update, view },
      given(signing.model),
      expect(text('Buy chai')).toExist(),
      expect(text('0G decided: buy it')).toExist(),
      expect(text('under the cap')).toExist(),
      expect(text('My chip is signing the payment...')).toExist(),
      expect(role('button', { name: 'Get me a chai, 0.10 USDC' })).toBeDisabled(),
      expect(label('Tell Duck what to get')).toBeDisabled(),
      expect(text('Duck is on an errand. You can send the next one when it ends.')).toExist(),
    )
    const paid = RobotConsole.update(
      signing.model,
      RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e1', detail: detail('paid', true) }),
    )
    vitestExpect(paid.commands?.map((command) => [command.name, command.args])).toEqual([['LoadConsole', { robotId }]])
    scene(
      { update: RobotConsole.update, view },
      given(paid.model),
      expect(text('Paid with my chip')).toExist(),
      expect(text('0.10 USDC')).toExist(),
      expect(role('link', { name: 'On Arc' })).toHaveAttr('href', `https://explorer.arc.io/tx/${txHash}`),
      expect(role('link', { name: 'Show proof' })).toHaveAttr('href', '/app/wallet/episodes/e1'),
    )
  })

  test('the history reads as a conversation, and a decision from anything but 0G is labelled the rehearsal brain', () => {
    const rehearsal = {
      ...summary('e5', 'samosa', 'safe_stop', 'no tool call'),
      result: '0G did not answer',
      decision: { action: 'pay', reason: 'cheap', requestId: null, provider: 'litellm.example/deepseek', latencyMs: 1 },
    }
    // A 0G call that failed is stored as safe_stop without a reason: 0G decided nothing, so no decision is shown.
    const busy = {
      ...summary('e6', 'chai', 'safe_stop', 'unused'),
      result: '0G answered 429',
      decision: { action: 'safe_stop', reason: null, requestId: null, provider: 'router-api.0g.ai/m', latencyMs: 1 },
    }
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([summary('e1', 'chai', 'paid', 'within budget'), rehearsal, busy])),
      expect(text('0G decided: buy it')).toExist(),
      expect(text('Paid with my chip')).toExist(),
      expect(text('The rehearsal brain (not 0G) decided: buy it')).toExist(),
      expect(text('I stopped safely and paid nothing: 0G did not answer')).toExist(),
      expect(text('I stopped safely and paid nothing: 0G answered 429')).toExist(),
      expect(text('0G decided: stop')).not.toExist(),
    )
  })

  test('a receipt says whether its record is saved on 0G (the links are behind Show proof), and a TEE-verified decision is marked', () => {
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
      // The thread only says where the record is; its 0G links are on the errand's page, behind Show proof.
      expect(role('link', { name: '0G Storage' })).not.toExist(),
      expect(role('link', { name: 'EpisodeLog record' })).not.toExist(),
      expect(role('link', { name: 'Show proof' })).toHaveAttr('href', '/app/wallet/episodes/e1'),
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
      expect(text('Duck Café: Chai, 0.10 USDC')).toExist(),
      // The frame's copy on 0G Storage is linked from the errand's page, not from the thread.
      expect(role('link', { name: 'Frame on 0G Storage' })).not.toExist(),
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
      expect(role('button', { name: 'Get me a chai, 0.10 USDC' })).toBeDisabled(),
      expect(label('Tell Duck what to get')).toBeDisabled(),
    )
  })

  test('a stopped allowance still sends the robot out, so Arc can refuse the payment on-chain', () => {
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([], { ...consoleRobot, grant: { ...grant, status: 'revoked' } })),
      expect(text('No allowance')).toExist(),
      expect(text("Duck's allowance is stopped. Send it anyway and Arc refuses the payment on-chain.")).toExist(),
      expect(role('button', { name: 'Get me a chai, 0.10 USDC' })).toBeEnabled(),
      expect(role('button', { name: 'Get me a chai, 0.10 USDC' })).toHaveAccessibleDescription(
        "Duck's allowance is stopped. Send it anyway and Arc refuses the payment on-chain.",
      ),
    )
  })

  test('a payment over the per-payment limit asks in the conversation: Approve goes to World, No declines it there', () => {
    const waiting = {
      ...detail('awaiting_approval', false),
      episode: { id: 'e2', item: 'thali', state: 'awaiting_approval', result: null, invoice_id: 'i2' },
      chipRequest: null,
    }
    const asking = [
      RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e2', detail: waiting }),
      RobotConsole.Message.CompletedFindApproval({
        episodeId: 'e2',
        maybeApprovalUrl: Option.some('/wallet/approvals/ap1'),
      }),
    ].reduce((model, message) => RobotConsole.update(model, message).model, resumedConsole('e2'))
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
    const read = RobotConsole.update(
      resumedConsole('e3'),
      RobotConsole.Message.SucceededLoadErrand({ episodeId: 'e3', detail: waiting }),
    )
    vitestExpect(read.commands?.map((command) => [command.name, command.args])).toContainEqual([
      'FindApproval',
      { episodeId: 'e3' },
    ])
    scene({ update: RobotConsole.update, view }, given(read.model), expect(text('Waiting for your answer')).toExist())
    const found = RobotConsole.update(
      read.model,
      RobotConsole.Message.CompletedFindApproval({
        episodeId: 'e3',
        maybeApprovalUrl: Option.some('/wallet/approvals/ap3'),
      }),
    ).model
    scene(
      { update: RobotConsole.update, view },
      given(found),
      expect(role('link', { name: 'Approve with World ID' })).toHaveAttr('href', '/api/world/authorize?approval=ap3'),
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
      expect(text('USDC left of 3.00 today')).toExist(),
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
      expect(text('0.30 USDC max per purchase')).toExist(),
      expect(text('Duck Café only')).toExist(),
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
      expect(text('0x00000000000000000000000000000000000c41f0')).toExist(),
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
          'Duck can spend up to 5.00 USDC a day at Duck Café, for the next week. Over 1.00 asks you in World App. Arc enforces it; not even our server can go past.',
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

  test("a real robot's Get me pills send an intent that waits for its own scan", () => {
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
      click(role('button', { name: 'Get me a chai, 0.10 USDC' })),
      Command.expectExact(
        RobotConsole.SendIntent({ robotId, instruction: 'Get me a chai', item: 'chai', model: null }),
      ),
      Command.resolve(RobotConsole.SendIntent, RobotConsole.Message.SucceededCreateIntent({ intent: waiting })),
      expect(text('Waiting for Duck to scan the QR code at the counter.')).toExist(),
      expect(role('button', { name: 'Stop Duck' })).toBeEnabled(),
      expect(role('button', { name: 'Get me a samosa, 0.25 USDC' })).toBeDisabled(),
      Command.resolve(RobotConsole.PollIntent, RobotConsole.Message.FailedLoadIntent({ intentId: 'other' })),
    )
  })
})
