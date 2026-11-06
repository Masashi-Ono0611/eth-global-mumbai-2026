import { Listbox } from '@foldkit/ui'
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
  RobotVoice.Message.PressedTalk(),
  RobotVoice.Message.CompletedStartListening({ holdId: 1 }),
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
  test('a spoken buy carries the brain picked in the composer, as a typed message does', () => {
    Story.story(
      RobotConsole.update,
      Story.given(voiceOn()),
      Story.message(
        RobotConsole.Message.GotBrainPickerMessage({
          message: Listbox.Message.SelectedItem({ item: 'qwen3-vl-plus' }),
        }),
      ),
      Story.message(voice(RobotVoice.Message.PressedTalk())),
      Story.Command.resolve(RobotVoice.StartListening, RobotVoice.Message.CompletedStartListening({ holdId: 1 })),
      Story.Command.resolve(RobotVoice.LimitListening, RobotVoice.Message.CompletedLimitListening({ holdId: 0 })),
      Story.message(voice(RobotVoice.Message.ReleasedTalk())),
      Story.Command.resolve(
        RobotVoice.StopListening,
        RobotVoice.Message.CompletedStopListening({ maybeAudio: Option.some(clip), closed: false }),
      ),
      Story.Command.expectExact(RobotVoice.SendVoiceTurn({ robotId, audio: clip, model: 'qwen3-vl-plus' })),
      Story.Command.resolve(RobotVoice.SendVoiceTurn, RobotVoice.Message.FailedVoiceTurn({ error: 'busy' })),
    )
  })

  test('hold, speak, let go: the clip goes to the Worker, the speech plays, and the spoken intent is followed', () => {
    Story.story(
      RobotConsole.update,
      Story.given(voiceOn()),
      Story.message(voice(RobotVoice.Message.PressedTalk())),
      Story.Command.expectExact(RobotVoice.StartListening({ holdId: 1 })),
      Story.Command.resolve(RobotVoice.StartListening, RobotVoice.Message.CompletedStartListening({ holdId: 1 })),
      Story.Command.expectExact(RobotVoice.LimitListening({ holdId: 1 })),
      Story.Command.resolve(RobotVoice.LimitListening, RobotVoice.Message.CompletedLimitListening({ holdId: 0 })),
      Story.message(voice(RobotVoice.Message.ReleasedTalk())),
      Story.Command.expectExact(RobotVoice.StopListening()),
      Story.Command.resolve(
        RobotVoice.StopListening,
        RobotVoice.Message.CompletedStopListening({ maybeAudio: Option.some(clip), closed: false }),
      ),
      Story.Command.expectExact(RobotVoice.SendVoiceTurn({ robotId, audio: clip, model: null })),
      Story.Command.resolve(RobotVoice.SendVoiceTurn, RobotVoice.Message.SucceededVoiceTurn({ turn: turn() })),
      Story.Command.expectHas(RobotVoice.PlaySpeech({ url: `/api/robots/${robotId}/voice/speech/${'a'.repeat(64)}` })),
      Story.Command.expectHas(RobotConsole.PollIntent({ robotId, intentId, delayMillis: 2000 })),
      Story.model((model) => {
        expectValue(RobotVoice.Status.guards.Speaking(model.voice.status)).toBe(true)
        expectValue(RobotConsole.Intent.guards.Open(model.intent)).toBe(true)
      }),
      Story.Command.resolve(RobotVoice.PlaySpeech, RobotVoice.Message.CompletedPlaySpeech({ played: true })),
      Story.Command.resolve(RobotVoice.ShowNewest, RobotVoice.Message.CompletedShowNewest()),
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
      Story.Command.resolve(RobotVoice.ShowNewest, RobotVoice.Message.CompletedShowNewest()),
      Story.model((model) => {
        expectValue(model.voice.entries.map((entry) => entry.speaker)).toEqual(['owner', 'vita', 'vita'])
        expectValue(model.voice.entries.map((entry) => entry.kind)).toEqual(['turn', 'turn', 'narration'])
        expectValue(Option.isNone(model.voice.maybeFollowing)).toBe(true)
      }),
    )
  })

  test('a release before the mic opened records nothing, and the late mic is closed again', () => {
    const pressed = RobotVoice.update(
      RobotVoice.update(RobotVoice.init(robotId), RobotVoice.Message.CompletedCheckVoice({ available: true })).model,
      RobotVoice.Message.PressedTalk(),
    )
    const released = RobotVoice.update(pressed.model, RobotVoice.Message.ReleasedTalk())
    expectValue(RobotVoice.Status.guards.Idle(released.model.status)).toBe(true)
    const late = RobotVoice.update(released.model, RobotVoice.Message.CompletedStartListening({ holdId: 1 }))
    expectValue(late.commands).toEqual([RobotVoice.StopListening()])
    const closed = RobotVoice.update(
      late.model,
      RobotVoice.Message.CompletedStopListening({ maybeAudio: Option.some(clip), closed: false }),
    )
    expectValue(closed.commands ?? []).toEqual([])
    expectValue(closed.model.entries).toEqual([])
  })

  test('a hold past 14 s after the mic opened sends what was said; a limit from another hold is ignored; a hidden page gets no mic', () => {
    const on = RobotVoice.update(
      RobotVoice.init(robotId),
      RobotVoice.Message.CompletedCheckVoice({ available: true }),
    ).model
    const holding = steps(
      on,
      RobotVoice.Message.PressedTalk(),
      RobotVoice.Message.CompletedStartListening({ holdId: 1 }),
    )
    expectValue(holding.model.status).toEqual(RobotVoice.Status.Listening({ holdId: 1 }))
    expectValue(steps(holding.model, RobotVoice.Message.CompletedLimitListening({ holdId: 7 })).commands).toEqual([])
    const limited = steps(holding.model, RobotVoice.Message.CompletedLimitListening({ holdId: 1 }))
    expectValue(RobotVoice.Status.guards.Thinking(limited.model.status)).toBe(true)
    expectValue(limited.commands).toEqual([RobotVoice.StopListening()])
    expectValue(steps(limited.model, RobotVoice.Message.ReleasedTalk()).model.status).toEqual(limited.model.status)
    expectValue(steps(on, RobotVoice.Message.PressedTalk()).commands).toMatchObject([
      { name: 'StartListening', args: { holdId: 1 } },
    ])
    const hidden = steps(
      on,
      RobotVoice.Message.PressedTalk(),
      RobotVoice.Message.FailedStartListening({ holdId: 1, reason: 'hidden' }),
    )
    expectValue(RobotVoice.Status.guards.Idle(hidden.model.status)).toBe(true)
    const guarded = steps(
      on,
      ...spoken,
      RobotVoice.Message.CompletedStopListening({ maybeAudio: Option.none(), closed: true }),
    )
    expectValue(RobotVoice.Status.guards.Idle(guarded.model.status)).toBe(true)
  })

  test('a late mic for an earlier press never touches the current hold; a stale failure is ignored', () => {
    const on = RobotVoice.update(
      RobotVoice.init(robotId),
      RobotVoice.Message.CompletedCheckVoice({ available: true }),
    ).model
    const second = steps(
      on,
      RobotVoice.Message.PressedTalk(),
      RobotVoice.Message.ReleasedTalk(),
      RobotVoice.Message.PressedTalk(),
    )
    expectValue(second.model.status).toEqual(RobotVoice.Status.Starting({ holdId: 2 }))
    const stale = steps(
      second.model,
      RobotVoice.Message.FailedStartListening({ holdId: 1, reason: 'superseded' }),
      RobotVoice.Message.CompletedStartListening({ holdId: 1 }),
    )
    expectValue(stale.model.status).toEqual(second.model.status)
    expectValue(stale.commands).toEqual([])
    const opened = steps(stale.model, RobotVoice.Message.CompletedStartListening({ holdId: 2 }))
    expectValue(opened.model.status).toEqual(RobotVoice.Status.Listening({ holdId: 2 }))
  })

  test('narration mid-turn joins the thread silently; a speech that does not play is said', () => {
    const on = RobotVoice.update(
      RobotVoice.init(robotId),
      RobotVoice.Message.CompletedCheckVoice({ available: true }),
    ).model
    const thinking = steps(on, ...spoken)
    const narrated = steps(
      thinking.model,
      RobotVoice.Message.SucceededSayIntent({
        say: { errand: asking, line: askingLine, decisionReason: null, speech: { url: '/s' }, speechError: null },
      }),
    )
    expectValue(RobotVoice.Status.guards.Thinking(narrated.model.status)).toBe(true)
    expectValue(narrated.commands).toMatchObject([{ name: 'ShowNewest' }])
    expectValue(narrated.model.entries).toHaveLength(1)
    const sent = steps(
      narrated.model,
      RobotVoice.Message.CompletedStopListening({ maybeAudio: Option.some(clip), closed: false }),
    )
    expectValue(sent.commands).toMatchObject([{ name: 'SendVoiceTurn', args: { robotId, audio: clip } }])
    const answered = steps(sent.model, RobotVoice.Message.SucceededVoiceTurn({ turn: turn() }))
    const overlapping = steps(
      answered.model,
      RobotVoice.Message.SucceededSayIntent({
        say: { errand: asking, line: askingLine, decisionReason: null, speech: { url: '/s2' }, speechError: null },
      }),
    )
    expectValue(overlapping.commands).toMatchObject([{ name: 'ShowNewest' }])
    const cutIn = steps(answered.model, RobotVoice.Message.PressedTalk())
    expectValue(cutIn.model.status).toEqual(RobotVoice.Status.Starting({ holdId: 2 }))
    expectValue(RobotVoice.Status.guards.Speaking(overlapping.model.status)).toBe(true)
    const unplayed = steps(answered.model, RobotVoice.Message.CompletedPlaySpeech({ played: false }))
    expectValue(unplayed.model.status).toEqual(
      RobotVoice.Status.Failed({ reason: 'speech', detail: 'the speech did not play' }),
    )
  })

  test('without the voice routes there is no mic, and the dock is unchanged', () => {
    Scene.scene(
      { update: RobotConsole.update, view: consoleView },
      Scene.given(loadedConsole()),
      Scene.expect(mic).not.toExist(),
      Scene.expect(Scene.text('Hold to talk')).not.toExist(),
    )
  })

  test("the mic says when it listens, Vita's line keeps its catchphrases, and 0G's reason is a quote", () => {
    Scene.scene(
      { update: RobotConsole.update, view: consoleView },
      Scene.given(voiceOn()),
      Scene.expect(mic).toHaveAttr('aria-pressed', 'false'),
      // At rest the mic sits in the composer and the line under it says nothing.
      Scene.expect(Scene.text('Hold to talk')).not.toExist(),
    )
    Scene.scene(
      { update: RobotConsole.update, view: consoleView },
      Scene.given(after(RobotVoice.Message.PressedTalk(), RobotVoice.Message.CompletedStartListening({ holdId: 1 }))),
      Scene.expect(listening).toHaveAttr('aria-pressed', 'true'),
      Scene.expect(Scene.text('let go to send')).toExist(),
      Scene.expect(Scene.text('Listening…')).toExist(),
      Scene.expect(Scene.text('listening')).toExist(),
      Scene.expect(Scene.role('button', { name: 'Get me a chai, 0.10 USDC' })).toBeDisabled(),
      Scene.expect(Scene.label('Tell Duck what to get')).toBeDisabled(),
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
        [RobotVoice.Message.PressedTalk(), RobotVoice.Message.FailedStartListening({ holdId: 1, reason: 'blocked' })],
        'Microphone blocked. Allow it in the address bar, or tap an item.',
      ],
      [
        [...spoken, RobotVoice.Message.CompletedStopListening({ maybeAudio: Option.none(), closed: false })],
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
    Scene.scene(
      { update: RobotConsole.update, view: consoleView },
      Scene.given(
        after(
          ...spoken,
          RobotVoice.Message.SucceededVoiceTurn({
            turn: turn({ speech: null, speechError: 'Vita could not speak this line; showing it as text' }),
          }),
        ),
      ),
      Scene.expect(Scene.role('alert')).toHaveText(
        'Vita could not speak (Vita could not speak this line; showing it as text); the line is shown as text.',
      ),
      Scene.expect(Scene.text('Waddle waddle!')).toExist(),
    )
  })
})
