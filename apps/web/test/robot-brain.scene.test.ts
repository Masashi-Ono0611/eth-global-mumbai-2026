import { Listbox } from '@foldkit/ui'
import { Command, Mount, click, expect, given, label, role, scene, selector, submit, type } from 'foldkit/scene'
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

/** Opens the composer's brain menu from its button, as the Listbox asks: focus the items, anchor the panel. */
const openMenu = (name: string) => [
  click(role('button', { name })),
  Command.resolve(Listbox.FocusItems, Listbox.Message.CompletedFocusItems()),
  Mount.resolve(Listbox.AnchorListbox, Listbox.Message.CompletedAnchorListbox()),
  Mount.resolve(Listbox.PortalListboxBackdrop, Listbox.Message.CompletedPortalListboxBackdrop()),
]
/** Picks a brain in the open menu: the panel closes and the focus returns to the button. */
const pick = (model: RegExp) => [
  click(role('option', { name: model })),
  Mount.expectEnded(Listbox.PortalListboxBackdrop),
  Mount.expectEnded(Listbox.AnchorListbox),
  Command.resolve(Listbox.FocusButton, Listbox.Message.CompletedFocusButton()),
]

describe('/robot/:id, the brain for the next message', () => {
  test("the composer's menu offers ZG_MODEL with its TEE and qwen3-vl-plus; the pick goes with the next message", () => {
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([], withBrains)),
      expect(role('button', { name: '0G brain for your next message: glm-5.3, in a TEE' })).toExist(),
      ...openMenu('0G brain for your next message: glm-5.3, in a TEE'),
      expect(role('listbox')).toHaveAttr('aria-label', '0G brain for your next message'),
      expect(role('option', { name: /^glm-5\.3/ })).toHaveAttr('aria-selected', 'true'),
      expect(role('option', { name: /^qwen3-vl-plus/ })).toContainText('Faster, without a TEE proof'),
      ...pick(/^qwen3-vl-plus/),
      expect(role('listbox')).not.toExist(),
      expect(role('button', { name: '0G brain for your next message: qwen3-vl-plus' })).toExist(),
      click(role('button', { name: 'Get me a chai' })),
      Command.expectExact(
        RobotConsole.SendIntent({ robotId, instruction: 'Get me a chai', item: 'chai', model: 'qwen3-vl-plus' }),
      ),
      Command.resolve(RobotConsole.SendIntent, RobotConsole.Message.FailedCreateIntent({ error: 'busy' })),
      // Back to the TEE brain: the next message names it explicitly.
      ...openMenu('0G brain for your next message: qwen3-vl-plus'),
      ...pick(/^glm-5\.3/),
      click(role('button', { name: 'Get me a samosa' })),
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
      ...openMenu('0G brain for your next message: glm-5.3, in a TEE'),
      ...pick(/^qwen3-vl-plus/),
      expect(role('button', { name: 'Send' })).toBeDisabled(),
      type(label('Tell Duck what to get'), 'a chai, quickly'),
      expect(role('button', { name: 'Send' })).toBeEnabled(),
      submit(selector('form')),
      Command.expectExact(
        RobotConsole.SendIntent({ robotId, instruction: 'a chai, quickly', item: null, model: 'qwen3-vl-plus' }),
      ),
      Command.resolve(RobotConsole.SendIntent, RobotConsole.Message.FailedCreateIntent({ error: 'busy' })),
    )
  })

  test('a Worker with one brain (or before 0G is configured) shows no menu', () => {
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([], { ...consoleRobot, brains: [brains[0] ?? { model: 'glm-5.3', tee: true }] })),
      expect(role('button', { name: /0G brain/ })).not.toExist(),
      expect(role('button', { name: 'Send' })).toExist(),
    )
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole()),
      expect(role('button', { name: /0G brain/ })).not.toExist(),
    )
  })
})
