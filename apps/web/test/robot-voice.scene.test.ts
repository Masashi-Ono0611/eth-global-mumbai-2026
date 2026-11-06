import { Option } from 'effect'
import { Scene, Story } from 'foldkit'
import { describe, expect as expectValue, test } from 'vitest'
import type { IntentView } from '@ethmumbai/protocol/Intent'
import type { VoiceTurn } from '@ethmumbai/protocol/Voice'
import * as RobotConsole from '../src/pages/RobotConsole.ts'
import * as RobotVoice from '../src/pages/RobotVoice.ts'
import { consoleView, loadedConsole, robotId } from './ConsoleFixtures.ts'

// Vita's voice in the conversation (issue #5): hold to talk, what Vita heard as the owner's bubble, Vita's line in a
// duck-ringed bubble, a spoken buy following the same intent as a Get me chip, and the failures shown, never guessed.

const intentId = '5hh673fl6tqjrbptsyxam5n3oa'
const episodeId = 'rvgrbuk2xpdkpapeqjcobpvcwe'
const intent = (patch: Partial<IntentView> = {}): IntentView => ({
  id: intentId,
  robotId,
  state: 'running',
  instruction: 'Get me a chai',
  item: 'chai',
  episodeId: null,
  episodeState: null,
  reason: null,
  turns: [],
  createdAt: 1,
  ...patch,
})
const SNACKS = 'Budget first, snacks second, QUACK!'
const turn = (patch: Partial<VoiceTurn> = {}): VoiceTurn => ({
  heard: 'Hello duck, buy a chai.',
  intent: 'buy',
  item: 'chai',
  errand: intent(),
  line: {
    text: `Waddle waddle! Off to the counter for a chai; I pay only when 0G says so. ${SNACKS}`,
    opener: 'Waddle waddle!',
    closer: SNACKS,
  },
  speech: { url: `/api/robots/${robotId}/voice/speech/${'a'.repeat(64)}` },
  speechError: null,
  ...patch,
})
const voiceOn = () =>
  RobotConsole.update(
    loadedConsole(),
    RobotConsole.Message.GotVoiceMessage({ message: RobotVoice.Message.CompletedCheckVoice({ available: true }) }),
  ).model
const mic = Scene.role('button', { name: 'Hold to talk to Duck' })
const listening = Scene.role('button', { name: 'Listening, let go to send' })
const voice = (message: RobotVoice.Message) => RobotConsole.Message.GotVoiceMessage({ message })
/** The page after these voice messages (the Commands they return are the story test's concern). */
const after = (...messages: ReadonlyArray<RobotVoice.Message>) =>
  messages.reduce((model, message) => RobotConsole.update(model, voice(message)).model, voiceOn())
const clip = 'data:audio/wav;base64,UklGRg=='
/** A hold: press, the mic opens, release (the clip then goes to the Worker). */
const spoken = [
  RobotVoice.Message.PressedTalk({ at: 0 }),
  RobotVoice.Message.CompletedStartListening(),
  RobotVoice.Message.ReleasedTalk(),
]
const asking = intent({ state: 'scanned', episodeId, episodeState: 'awaiting_approval' })
const askingLine = {
  text: "What the duck?! This one needs your approval in World App. That's a boss decision, QUACK!",
  opener: 'What the duck?!',
  closer: "That's a boss decision, QUACK!",
}

/** Folds voice messages; the last update's Commands come back with the Model. */
const steps = (
  model: RobotVoice.Model,
  ...messages: ReadonlyArray<RobotVoice.Message>
): { readonly model: RobotVoice.Model; readonly commands: ReadonlyArray<unknown> } =>
  messages.reduce<{ readonly model: RobotVoice.Model; readonly commands: ReadonlyArray<unknown> }>(
    (state, message) => {
      const next = RobotVoice.update(state.model, message)
      return { model: next.model, commands: next.commands ?? [] }
    },
    { model, commands: [] },
  )

describe('/robot/:id voice', () => {
  test('hold, speak, let go: the clip goes to the Worker, the speech plays, and the spoken intent is followed', () => {
    Story.story(
      RobotConsole.update,
      Story.given(voiceOn()),
      Story.message(voice(RobotVoice.Message.PressedTalk({ at: 0 }))),
      Story.Command.expectHas(RobotVoice.StartListening(), RobotVoice.LimitListening({ pressedAt: 0 })),
      Story.Command.resolve(RobotVoice.StartListening, RobotVoice.Message.CompletedStartListening()),
      Story.Command.resolve(RobotVoice.LimitListening, RobotVoice.Message.CompletedLimitListening({ pressedAt: -1 })),
      Story.message(voice(RobotVoice.Message.ReleasedTalk())),
      Story.Command.expectExact(RobotVoice.StopListening()),
      Story.Command.resolve(
        RobotVoice.StopListening,
        RobotVoice.Message.CompletedStopListening({ maybeAudio: Option.some(clip) }),
      ),
      Story.Command.expectExact(RobotVoice.SendVoiceTurn({ robotId, audio: clip })),
      Story.Command.resolve(RobotVoice.SendVoiceTurn, RobotVoice.Message.SucceededVoiceTurn({ turn: turn() })),
      Story.Command.expectHas(RobotVoice.PlaySpeech({ url: `/api/robots/${robotId}/voice/speech/${'a'.repeat(64)}` })),
      Story.Command.expectHas(RobotConsole.PollIntent({ robotId, intentId, delayMillis: 2000 })),
      Story.model((model) => {
        expectValue(RobotVoice.Status.guards.Speaking(model.voice.status)).toBe(true)
        expectValue(RobotConsole.Intent.guards.Open(model.intent)).toBe(true)
      }),
      Story.Command.resolve(RobotVoice.PlaySpeech, RobotVoice.Message.CompletedPlaySpeech()),
      Story.Command.resolve(
        RobotConsole.PollIntent,
        RobotConsole.Message.SucceededLoadIntent({
          intent: intent({ state: 'expired', reason: 'no scan within 10 minutes' }),
        }),
      ),
      Story.Command.expectExact(RobotVoice.SayIntent({ robotId, intentId })),
      Story.Command.resolve(
        RobotVoice.SayIntent,
        RobotVoice.Message.SucceededSayIntent({
          say: { errand: asking, line: askingLine, decisionReason: null, speech: null, speechError: null },
        }),
      ),
      Story.model((model) => {
        expectValue(model.voice.entries.map((entry) => entry.speaker)).toEqual(['owner', 'vita', 'vita'])
        expectValue(Option.isNone(model.voice.maybeFollowing)).toBe(true)
      }),
    )
  })

  test('a release before the mic opened records nothing, and the late mic is closed again', () => {
    const pressed = RobotVoice.update(
      RobotVoice.update(RobotVoice.init(robotId), RobotVoice.Message.CompletedCheckVoice({ available: true })).model,
      RobotVoice.Message.PressedTalk({ at: 0 }),
    )
    const released = RobotVoice.update(pressed.model, RobotVoice.Message.ReleasedTalk())
    expectValue(RobotVoice.Status.guards.Idle(released.model.status)).toBe(true)
    const late = RobotVoice.update(released.model, RobotVoice.Message.CompletedStartListening())
    expectValue(late.commands).toEqual([RobotVoice.StopListening()])
    const closed = RobotVoice.update(
      late.model,
      RobotVoice.Message.CompletedStopListening({ maybeAudio: Option.some(clip) }),
    )
    expectValue(closed.commands ?? []).toEqual([])
    expectValue(closed.model.entries).toEqual([])
  })

  test('a hold past 14 s sends what was said; a limit from an earlier hold is ignored', () => {
    const on = RobotVoice.update(
      RobotVoice.init(robotId),
      RobotVoice.Message.CompletedCheckVoice({ available: true }),
    ).model
    const holding = steps(on, RobotVoice.Message.PressedTalk({ at: 100 }), RobotVoice.Message.CompletedStartListening())
    expectValue(holding.model.status).toEqual(RobotVoice.Status.Listening({ pressedAt: 100 }))
    expectValue(steps(holding.model, RobotVoice.Message.CompletedLimitListening({ pressedAt: 7 })).commands).toEqual([])
    const limited = steps(holding.model, RobotVoice.Message.CompletedLimitListening({ pressedAt: 100 }))
    expectValue(RobotVoice.Status.guards.Thinking(limited.model.status)).toBe(true)
    expectValue(limited.commands).toEqual([RobotVoice.StopListening()])
    expectValue(steps(limited.model, RobotVoice.Message.ReleasedTalk()).model.status).toEqual(limited.model.status)
  })

  test('without the voice routes there is no mic, and the dock is unchanged', () => {
    Scene.scene(
      { update: RobotConsole.update, view: consoleView },
      Scene.given(loadedConsole()),
      Scene.expect(mic).not.toExist(),
      Scene.expect(Scene.text('Hold to talk · or tap an item')).not.toExist(),
    )
  })

  test("the mic says when it listens, Vita's line keeps its catchphrases, and 0G's reason is a quote", () => {
    Scene.scene(
      { update: RobotConsole.update, view: consoleView },
      Scene.given(voiceOn()),
      Scene.expect(mic).toHaveAttr('aria-pressed', 'false'),
      Scene.expect(Scene.text('Hold to talk · or tap an item')).toExist(),
    )
    Scene.scene(
      { update: RobotConsole.update, view: consoleView },
      Scene.given(after(RobotVoice.Message.PressedTalk({ at: 0 }), RobotVoice.Message.CompletedStartListening())),
      Scene.expect(listening).toHaveAttr('aria-pressed', 'true'),
      Scene.expect(Scene.text('let go to send')).toExist(),
      Scene.expect(Scene.text('Listening…')).toExist(),
      Scene.expect(Scene.text('listening')).toExist(),
      Scene.expect(Scene.role('button', { name: 'Buy Chai for 0.10 USDC' })).toBeDisabled(),
    )
    Scene.scene(
      { update: RobotConsole.update, view: consoleView },
      Scene.given(after(...spoken)),
      Scene.expect(Scene.text('Duck is listening to you…')).toExist(),
      Scene.expect(mic).toBeDisabled(),
    )
    Scene.scene(
      { update: RobotConsole.update, view: consoleView },
      Scene.given(
        after(
          ...spoken,
          RobotVoice.Message.SucceededVoiceTurn({ turn: turn() }),
          RobotVoice.Message.SucceededSayIntent({
            say: {
              errand: asking,
              line: askingLine,
              decisionReason: 'Over the per-payment limit; the owner approves it in World App.',
              speech: null,
              speechError: null,
            },
          }),
        ),
      ),
      Scene.expect(Scene.text('Hello duck, buy a chai.')).toExist(),
      Scene.expect(Scene.text('you said')).toExist(),
      Scene.expect(Scene.text('Waddle waddle!')).toExist(),
      Scene.expect(Scene.text(SNACKS)).toExist(),
      Scene.expect(Scene.text('Duck said')).toExist(),
      Scene.expect(Scene.text('This one needs your approval in World App.')).toExist(),
      Scene.expect(Scene.text("0G's reason")).toExist(),
      Scene.expect(Scene.text('Over the per-payment limit; the owner approves it in World App.')).toExist(),
    )
  })

  test('a blocked mic, a tap and a 0G failure are said plainly; nothing is guessed', () => {
    const scenes: ReadonlyArray<readonly [ReadonlyArray<RobotVoice.Message>, string]> = [
      [
        [RobotVoice.Message.PressedTalk({ at: 0 }), RobotVoice.Message.FailedStartListening({ reason: 'blocked' })],
        'Microphone blocked. Allow it in the address bar, or tap an item.',
      ],
      [
        [...spoken, RobotVoice.Message.CompletedStopListening({ maybeAudio: Option.none() })],
        'Hold the button while you speak.',
      ],
      [
        [...spoken, RobotVoice.Message.FailedVoiceTurn({ error: '0G did not answer: 0G answered 502' })],
        '0G did not answer: 0G answered 502. Try again, or tap an item.',
      ],
    ]
    scenes.forEach(([messages, alert]) =>
      Scene.scene(
        { update: RobotConsole.update, view: consoleView },
        Scene.given(after(...messages)),
        Scene.expect(Scene.role('alert')).toHaveText(alert),
        Scene.expect(Scene.text('you said')).not.toExist(),
      ),
    )
  })
})
