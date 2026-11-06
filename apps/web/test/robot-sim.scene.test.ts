import { Command, click, expect, given, label, role, scene, selector, submit, text, type } from 'foldkit/scene'
import { describe, expect as vitestExpect, test } from 'vitest'
import { Option } from 'effect'
import type { IntentView } from '@ethmumbai/protocol/Intent'
import type { ConsoleRobot } from '../src/api/Robot.ts'
import * as RobotConsole from '../src/pages/RobotConsole.ts'
import { consoleRobot, consoleView as view, loadedConsole, robotId } from './ConsoleFixtures.ts'
import { detail } from './Fixtures.ts'

/** One navigation turn of 0G's: a walk to `place`, answered at `at` (unix ms). */
const turn = (step: number, at: number, place: string): IntentView['turns'][number] => ({
  step,
  model: 'glm-5.3',
  chatId: null,
  latencyMs: 900,
  calls: [{ id: `c${step}`, name: 'go_to', args: { place } }],
  reasoning: null,
  error: null,
  tee: null,
  createdAt: at,
})

/** A frame digest made of one repeated hex digit. */
const sha = (digit: string): `0x${string}` => `0x${digit.repeat(64)}`
/** The owner's live frame URL for that digest. */
const liveSrc = (digit: string) => `/api/robots/${robotId}/live/frame?v=${sha(digit)}`

describe('/robot/:id, a simulator robot', () => {
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

  test('a Get me pill sends the owner an intent; the duck says what it does and walks; Open simulator links it', () => {
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([], simRobot)),
      expect(role('link', { name: 'Open simulator' })).toHaveAttr('href', `/sim/?robot=${robotId}`),
      click(role('button', { name: 'Get me a chai, 0.10 USDC' })),
      Command.expectExact(
        RobotConsole.SendIntent({ robotId, instruction: 'Get me a chai', item: 'chai', model: null }),
      ),
      Command.resolve(
        RobotConsole.SendIntent,
        RobotConsole.Message.SucceededCreateIntent({ intent: intent('running', null) }),
      ),
      expect(text('Get me a chai')).toExist(),
      expect(text('Off to the chai stall!')).toExist(),
      expect(text('Walking to the chai stall')).toExist(),
      expect(role('button', { name: 'Stop Duck' })).toBeEnabled(),
      expect(role('button', { name: 'Get me a chai, 0.10 USDC' })).toBeDisabled(),
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
      Command.expectExact(
        RobotConsole.SendIntent({ robotId, instruction: 'a samosa please', item: null, model: null }),
      ),
      Command.resolve(
        RobotConsole.SendIntent,
        RobotConsole.Message.FailedCreateIntent({ error: 'not configured: sim' }),
      ),
      expect(role('alert')).toHaveText('I could not set off: not configured: sim'),
    )
  })

  test('the walk interleaves with the errand by time: to the stall, the decision, then to the gate after Paid', () => {
    const walked: IntentView = {
      ...intent('scanned', episodeId),
      turns: [turn(1, 1000, 'chai_stall'), turn(2, 5000, 'thali_stall'), turn(3, 9000, 'gate')],
    }
    const paid = detail('paid', true)
    const timed = { ...paid, episode: { ...paid.episode, id: episodeId, created_at: 2000, state_changed_at: 8 } }
    const following = [
      RobotConsole.Message.SucceededCreateIntent({ intent: walked }),
      RobotConsole.Message.SucceededLoadIntent({ intent: walked }),
      RobotConsole.Message.SucceededLoadErrand({ episodeId, detail: timed }),
    ].reduce((model, message) => RobotConsole.update(model, message).model, loadedConsole([], simRobot))
    scene(
      { update: RobotConsole.update, view },
      given(following),
      expect(role('region', { name: 'Conversation with Duck' })).toContainText(
        /Walking to the chai stall.*0G decided.*Walking to the thali stall.*Paid with my chip.*Walking to the gate/s,
      ),
    )
  })

  test("while the duck is out, the intent poll's live frame shows as a picture that changes with each new frame", () => {
    const withLive = (digit: string, ageMs: number): IntentView => ({
      ...intent('running', null),
      live: { sha256: sha(digit), bytes: 12_000, capturedAt: 1, ageMs },
    })
    scene(
      { update: RobotConsole.update, view },
      given(loadedConsole([], simRobot)),
      click(role('button', { name: 'Get me a chai, 0.10 USDC' })),
      Command.resolve(
        RobotConsole.SendIntent,
        RobotConsole.Message.SucceededCreateIntent({ intent: intent('running', null) }),
      ),
      expect(role('img', { name: 'What Duck sees right now' })).not.toExist(),
      Command.resolve(
        RobotConsole.PollIntent,
        RobotConsole.Message.SucceededLoadIntent({ intent: withLive('a', 1400) }),
      ),
      expect(role('img', { name: 'What Duck sees right now' })).toHaveAttr('src', liveSrc('a')),
      expect(text("Live from Duck's camera · 1 second ago")).toExist(),
      // The intent's first live frame starts the faster live loop, which swaps the picture between intent polls.
      Command.resolve(
        RobotConsole.PollLive,
        RobotConsole.Message.SucceededLoadLive({
          intentId,
          maybeLive: Option.some({ sha256: sha('c'), bytes: 30_000, capturedAt: 2, ageMs: 600 }),
        }),
      ),
      expect(role('img', { name: 'What Duck sees right now' })).toHaveAttr('src', liveSrc('c')),
      expect(text("Live from Duck's camera · just now")).toExist(),
      Command.resolve(
        RobotConsole.PollIntent,
        RobotConsole.Message.SucceededLoadIntent({ intent: withLive('b', 300) }),
      ),
      expect(role('img', { name: 'What Duck sees right now' })).toHaveAttr('src', liveSrc('b')),
      expect(text("Live from Duck's camera · just now")).toExist(),
      Command.resolve(
        RobotConsole.PollIntent,
        RobotConsole.Message.SucceededLoadIntent({ intent: intent('stopped', null) }),
      ),
      expect(role('img', { name: 'What Duck sees right now' })).not.toExist(),
      // The live loop's next read finds the intent closed and stops: no further command.
      Command.resolve(RobotConsole.PollLive, RobotConsole.Message.FailedLoadLive({ intentId })),
      Command.expectNone(),
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
      expect(role('button', { name: 'Get me a chai, 0.10 USDC' })).toBeEnabled(),
    )
  })
})
