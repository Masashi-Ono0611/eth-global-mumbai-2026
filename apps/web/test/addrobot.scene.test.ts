import { Option } from 'effect'
import {
  Command,
  click,
  expect,
  given,
  label,
  role,
  scene,
  submit,
  selector,
  text,
  type,
  withViewInputs,
} from 'foldkit/scene'
import { describe, test } from 'vitest'
import * as AddRobot from '../src/pages/AddRobot.ts'
import { addRobotView } from '../src/pages/AddRobotView.ts'
import * as Allowance from '../src/pages/Allowance.ts'
import { payee } from './Fixtures.ts'

const view = withViewInputs(addRobotView, { locale: 'en' })()
const added = { robotId: 'robotrobotrobotrobotrobota', name: 'Duck', pairingCode: 'K7Q2M9XZ', pairingExpiresAt: 600 }
const loaded = (maybeWaiting: Option.Option<typeof added>) =>
  AddRobot.update(
    AddRobot.init().model,
    AddRobot.Message.SucceededLoad({ merchantName: 'Duck Café', maybePayTo: Option.some(payee), maybeWaiting }),
  )

describe('/wallet/robots (add a robot)', () => {
  test('name, code, connected, then the allowance the passkey signs; granted opens the robot', () => {
    scene(
      { update: AddRobot.update, view },
      given(loaded(Option.none()).model),
      expect(text("Is it a real robot or the simulator, and what's it called?")).toExist(),
      click(role('radio', { name: 'Real robot' })),
      type(label('Robot name'), 'Duck'),
      submit(selector('form')),
      Command.expectExact(AddRobot.AddNamedRobot({ name: 'Duck', kind: 'chip' })),
      Command.resolve(AddRobot.AddNamedRobot, AddRobot.Message.SucceededAddRobot({ robot: added })),
      expect(text('K7Q2 M9XZ')).toExist(),
      expect(text('./vitaquack-chip --pair K7Q2M9XZ')).toExist(),
      expect(role('status')).toHaveText('Waiting for Duck to connect...'),
      Command.expectExact(AddRobot.WatchPairing({ robotId: added.robotId, delayMillis: 3000 })),
      Command.resolve(
        AddRobot.WatchPairing,
        AddRobot.Message.SucceededWatch({ robotId: added.robotId, paired: true, nowMillis: 1000 }),
      ),
      expect(text('Duck connected')).toExist(),
      expect(text('Hello! My chip made its own key, and it stays on me. How much can I spend?')).toExist(),
      click(role('button', { name: 'Confirm with passkey' })),
      Command.expectExact(
        Allowance.GrantAllowance({
          robotId: added.robotId,
          dailyCap: '3.00',
          perPaymentCap: '1.00',
          allowlist: [payee],
          hours: 24,
        }),
      ),
      Command.resolve(Allowance.GrantAllowance, Allowance.Message.SucceededGrant()),
      Command.expectExact(AddRobot.OpenRobot({ robotId: added.robotId })),
      Command.resolve(AddRobot.OpenRobot, AddRobot.Message.CompletedOpenRobot()),
    )
  })

  test('the simulator is the default kind', () => {
    scene(
      { update: AddRobot.update, view },
      given(loaded(Option.none()).model),
      expect(role('radio', { name: 'Simulator' })).toBeChecked(),
      type(label('Robot name'), 'Sim Duck'),
      submit(selector('form')),
      Command.expectExact(AddRobot.AddNamedRobot({ name: 'Sim Duck', kind: 'sim' })),
      Command.resolve(AddRobot.AddNamedRobot, AddRobot.Message.FailedAddRobot({ error: 'offline' })),
    )
  })

  test('a resumed pairing can be cancelled: the robot is dropped and the name is asked again', () => {
    scene(
      { update: AddRobot.update, view },
      given(loaded(Option.some(added)).model),
      expect(text('K7Q2 M9XZ')).toExist(),
      click(role('button', { name: 'Cancel and start again' })),
      Command.expectExact(AddRobot.CancelPairing({ robotId: added.robotId })),
      Command.resolve(AddRobot.CancelPairing, AddRobot.Message.CompletedCancelPairing()),
      expect(text("Is it a real robot or the simulator, and what's it called?")).toExist(),
      expect(role('radio', { name: 'Simulator' })).toBeChecked(),
      expect(text('K7Q2 M9XZ')).not.toExist(),
    )
  })

  test('a robot still waiting for its chip is picked up again; an expired code offers to start again', () => {
    const resumed = loaded(Option.some(added))
    scene({ update: AddRobot.update, view }, given(resumed.model), expect(text('K7Q2 M9XZ')).toExist())
    const expired = AddRobot.update(
      resumed.model,
      AddRobot.Message.SucceededWatch({ robotId: added.robotId, paired: false, nowMillis: 700_000 }),
    ).model
    scene(
      { update: AddRobot.update, view },
      given(expired),
      expect(role('alert')).toHaveText('The code expired before the robot connected. Start again for a new one.'),
      click(role('button', { name: 'Start again' })),
      expect(text("Is it a real robot or the simulator, and what's it called?")).toExist(),
    )
  })

  test('a simulator duck gets an Open simulator button that carries its pairing code', () => {
    scene(
      { update: AddRobot.update, view },
      given(loaded(Option.none()).model),
      click(role('radio', { name: 'Simulator' })),
      type(label('Robot name'), 'Sim duck'),
      submit(selector('form')),
      Command.expectExact(AddRobot.AddNamedRobot({ name: 'Sim duck', kind: 'sim' })),
      Command.resolve(
        AddRobot.AddNamedRobot,
        AddRobot.Message.SucceededAddRobot({ robot: { ...added, name: 'Sim duck', kind: 'sim' } }),
      ),
      expect(role('link', { name: 'Open simulator' })).toHaveAttr('href', `/sim/?robot=${added.robotId}#pair=K7Q2M9XZ`),
      expect(text('./vitaquack-chip --pair K7Q2M9XZ')).not.toExist(),
      Command.resolve(AddRobot.WatchPairing, AddRobot.Message.FailedWatch({ robotId: 'other' })),
    )
  })
})
