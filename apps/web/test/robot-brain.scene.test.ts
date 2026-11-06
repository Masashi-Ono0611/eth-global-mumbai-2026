import { RadioGroup } from '@foldkit/ui'
import { Command, click, expect, given, label, role, scene, selector, submit, type } from 'foldkit/scene'
import { describe, test } from 'vitest'
import type { ConsoleRobot } from '../src/api/Robot.ts'
import * as RobotConsole from '../src/pages/RobotConsole.ts'
import { consoleRobot, consoleView as view, loadedConsole, robotId } from './ConsoleFixtures.ts'

/** The Worker offers its ZG_MODEL (a TEE provider) and qwen3-vl-plus (no TEE), in that order. */
const brains = [
  { model: 'glm-5.3', tee: true },
  { model: 'qwen3-vl-plus', tee: false },
]
const withBrains: ConsoleRobot = { ...consoleRobot, brains }
const focused = Command.resolve(RadioGroup.FocusOption, RadioGroup.Message.CompletedFocusOption())

describe('/robot/:id, the brain for the next message', () => {
  test("the dock offers ZG_MODEL with its TEE and qwen3-vl-plus; the pick goes with the next Buy, the default doesn't", () => {
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([], withBrains)),
      expect(role('radiogroup', { name: '0G brain for your next message' })).toExist(),
      expect(role('radio', { name: 'glm-5.3 · TEE' })).toHaveAttr('aria-checked', 'true'),
      expect(role('radio', { name: 'qwen3-vl-plus' })).toHaveAttr('aria-checked', 'false'),
      expect(role('radio', { name: 'qwen3-vl-plus' })).toHaveAccessibleDescription(
        'Faster, no TEE: its answers are not TEE-verifiable',
      ),
      click(role('radio', { name: 'qwen3-vl-plus' })),
      focused,
      expect(role('radio', { name: 'qwen3-vl-plus' })).toHaveAttr('aria-checked', 'true'),
      expect(role('radio', { name: 'glm-5.3 · TEE' })).toHaveAttr('aria-checked', 'false'),
      click(role('button', { name: 'Buy Chai for 0.10 USDC' })),
      Command.expectExact(RobotConsole.StartErrand({ robotId, item: 'chai', invoiceId: null, model: 'qwen3-vl-plus' })),
      Command.resolve(RobotConsole.StartErrand, RobotConsole.Message.FailedStartErrand({ error: 'busy' })),
      // Back to the TEE brain: the next message names it explicitly.
      click(role('radio', { name: 'glm-5.3 · TEE' })),
      focused,
      click(role('button', { name: 'Get me a samosa, 0.25 USDC' })),
      Command.expectExact(
        RobotConsole.SendIntent({ robotId, instruction: 'Get me a samosa', item: 'samosa', model: 'glm-5.3' }),
      ),
      Command.resolve(RobotConsole.SendIntent, RobotConsole.Message.FailedCreateIntent({ error: 'busy' })),
    )
  })

  test("a simulator's typed words carry the pick too", () => {
    const sim: ConsoleRobot = { ...withBrains, robot: { ...withBrains.robot, kind: 'sim' } }
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([], sim)),
      click(role('radio', { name: 'qwen3-vl-plus' })),
      focused,
      type(label('Tell Duck what to get'), 'a chai, quickly'),
      submit(selector('form')),
      Command.expectExact(
        RobotConsole.SendIntent({ robotId, instruction: 'a chai, quickly', item: null, model: 'qwen3-vl-plus' }),
      ),
      Command.resolve(RobotConsole.SendIntent, RobotConsole.Message.FailedCreateIntent({ error: 'busy' })),
    )
  })

  test('a Worker with one brain (or before 0G is configured) shows no choice', () => {
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([], { ...consoleRobot, brains: [brains[0] ?? { model: 'glm-5.3', tee: true }] })),
      expect(role('radiogroup')).not.toExist(),
      given(loadedConsole()),
      expect(role('radiogroup')).not.toExist(),
    )
  })
})
