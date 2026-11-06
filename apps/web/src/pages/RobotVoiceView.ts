import { format, type Locale } from '@ethmumbai/i18n'
import { clsx } from 'clsx'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import * as RobotVoice from './RobotVoice.ts'
import { workingDots } from '../Busy.ts'

// Vita's voice in the conversation (Kris's voice mock, DESIGN.md "Quack chat"): a hold-to-talk mic beside the buy
// chips, the owner's spoken words as their own bubble ("you said"), and Vita's line in a duck-ringed bubble with its
// catchphrases in duck yellow. Duck yellow keeps its one meaning on the mic: it lights up only while the mic is open.

// STYLES

const micClassName =
  'grid size-16 cursor-pointer touch-none place-items-center rounded-full bg-ink text-surface shadow-[0_6px_16px_-6px_rgb(31_45_54/0.5)] transition-[transform,background-color,box-shadow] duration-150 select-none [-webkit-touch-callout:none] active:scale-[0.96] disabled:cursor-wait'
const micListeningClassName =
  'bg-duck text-ink shadow-[0_0_0_8px_rgb(255_224_122/0.45),0_0_0_18px_rgb(255_224_122/0.2)] motion-reduce:shadow-[0_0_0_6px_rgb(255_224_122/0.6)]'
const micBusyClassName = 'bg-surface text-muted shadow-[0_1px_2px_rgb(31_45_54/0.08)]'
const statusClassName = 'flex min-h-6 items-center justify-end gap-1.5 pr-1 text-[0.85rem] text-muted'
const listeningClassName = 'flex items-center gap-2.5 rounded-[18px] bg-surface px-3.5 py-2.5 font-semibold'
const waveClassName = 'inline-flex h-[18px] items-center gap-[3px]'
const waveBarClassName =
  'w-[3px] rounded-sm bg-ink motion-safe:animate-voice-wave motion-safe:[animation-delay:var(--delay)]'
const failedClassName = 'pr-1 text-right text-[0.85rem] text-error'
const ownerClassName = 'max-w-[82%] self-end rounded-[20px_20px_6px_20px] bg-ink px-3.5 pt-2 pb-1.5 text-surface'
const vitaClassName =
  'max-w-[86%] self-start rounded-[20px_20px_20px_6px] bg-surface px-3.5 pt-2 pb-2 shadow-[inset_0_0_0_2px_var(--color-duck)]'
const catchClassName = 'rounded-md bg-duck px-1 font-semibold'
const saidClassName = 'mt-1 flex items-center gap-1.5 text-[0.78rem] text-muted'
const ownerSaidClassName = 'mt-1 flex items-center justify-end gap-1.5 text-[0.78rem] text-surface/70'
const quoteClassName = 'mt-1.5 block border-l-[2.5px] border-ink/25 pl-2.5 text-[0.9rem] text-ink/80'
const quoteLabelClassName = 'block text-[0.75rem] text-muted'
const iconClassName = 'size-3.5 shrink-0'

// VIEW

const { Message } = RobotVoice
type Message = RobotVoice.Message

const isSpace = (key: string) => key === ' ' || key === 'Spacebar'

const micIcon = (className: string, h: HtmlBuilder<Message>): Html =>
  h.svg(
    [
      h.ViewBox('0 0 24 24'),
      h.Class(className),
      h.Fill('none'),
      h.Stroke('currentColor'),
      h.StrokeWidth('2'),
      h.StrokeLinecap('round'),
      h.StrokeLinejoin('round'),
      h.AriaHidden(true),
    ],
    [
      h.rect([h.X('9'), h.Y('3'), h.Width('6'), h.Height('11'), h.Rx('3')]),
      h.path([h.D('M5 11a7 7 0 0 0 14 0M12 18v3')]),
    ],
  )

const speakerIcon = (h: HtmlBuilder<Message>): Html =>
  h.svg(
    [
      h.ViewBox('0 0 24 24'),
      h.Class(iconClassName),
      h.Fill('none'),
      h.Stroke('currentColor'),
      h.StrokeWidth('2'),
      h.StrokeLinecap('round'),
      h.StrokeLinejoin('round'),
      h.AriaHidden(true),
    ],
    [h.path([h.D('M4 9v6h4l5 4V5L8 9z')]), h.path([h.D('M16.5 8.5a5 5 0 0 1 0 7')])],
  )

const WAVE = [6, 14, 18, 10, 16, 7, 13, 18, 9].map((height, index) => ({
  id: `bar-${index}`,
  height,
  delay: index * 90,
}))

const wave = (h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class(waveClassName), h.AriaHidden(true)],
    WAVE.map((bar) =>
      h.keyed('span')(bar.id, [
        h.Class(waveBarClassName),
        h.Style({ height: `${bar.height}px`, '--delay': `${bar.delay}ms` }),
      ]),
    ),
  )

/** The hold-to-talk button (pointer, or Space while focused). Hidden when this release has no voice routes. */
const micButton = (voice: RobotVoice.Model, name: string, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const { status } = voice
  if (RobotVoice.Status.guards.Unavailable(status)) return h.empty
  const listening = RobotVoice.Status.guards.Listening(status) || RobotVoice.Status.guards.Starting(status)
  const busy = RobotVoice.Status.guards.Thinking(status)
  return h.button(
    [
      h.Type('button'),
      h.Class(clsx(micClassName, { [micListeningClassName]: listening, [micBusyClassName]: busy })),
      h.Disabled(busy),
      h.AriaPressed(listening ? 'true' : 'false'),
      h.AriaLabel(format(locale, listening ? 'voice.listeningLabel' : 'voice.hold', { name })),
      h.OnPointerDown(() => Option.some(Message.PressedTalk())),
      h.OnPointerUp(() => Option.some(Message.ReleasedTalk())),
      h.OnPointerLeave(() => (listening ? Option.some(Message.ReleasedTalk()) : Option.none())),
      h.OnBlur(Message.ReleasedTalk()),
      h.OnKeyDownPreventDefault((key) => (isSpace(key) ? Option.some(Message.PressedTalk()) : Option.none())),
      h.OnKeyUpPreventDefault((key) => (isSpace(key) ? Option.some(Message.ReleasedTalk()) : Option.none())),
    ],
    [micIcon('size-7', h)],
  )
}

/** The line under the dock: listening, thinking, speaking, a failure, or the hint. */
const voiceStatus = (voice: RobotVoice.Model, name: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  RobotVoice.Status.match(voice.status, {
    Unavailable: () => h.empty,
    Idle: () => h.p([h.Class(statusClassName)], [format(locale, 'voice.hint', {})]),
    Starting: () => h.p([h.Class(statusClassName)], [format(locale, 'voice.micOnlyWhileHeld', {})]),
    Listening: () =>
      h.p(
        [h.Class(listeningClassName), h.Role('status')],
        [
          wave(h),
          format(locale, 'voice.listening', {}),
          h.small([h.Class('ml-auto font-medium text-muted')], [format(locale, 'voice.letGo', {})]),
        ],
      ),
    Thinking: () => h.p([h.Class(statusClassName), h.Role('status')], [format(locale, 'voice.thinking', { name })]),
    Speaking: () =>
      h.p([h.Class(statusClassName), h.Role('status')], [speakerIcon(h), format(locale, 'voice.speaking', { name })]),
    Failed: ({ reason, detail }) =>
      h.p([h.Class(failedClassName), h.Role('alert')], [format(locale, 'voice.failed', { reason, detail })]),
  })

/** Vita's line with its opener and closer in duck yellow (the line is the Worker's text, never HTML). */
const lineText = (entry: RobotVoice.Entry, h: HtmlBuilder<Message>): ReadonlyArray<Html | string> =>
  Option.match(entry.line, {
    onNone: () => [entry.text],
    onSome: ({ text, opener, closer }) => {
      const middle = text.slice(opener.length, text.length - closer.length).trim()
      return [
        h.em([h.Class(catchClassName)], [opener]),
        ' ',
        h.span([], [middle]),
        ' ',
        h.em([h.Class(catchClassName)], [closer]),
      ]
    },
  })

const entryView = (entry: RobotVoice.Entry, name: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  entry.speaker === 'owner'
    ? h.keyed('p')(
        `voice-${entry.id}`,
        [h.Class(ownerClassName)],
        [
          entry.text,
          h.span([h.Class(ownerSaidClassName)], [micIcon(iconClassName, h), format(locale, 'voice.youSaid', {})]),
        ],
      )
    : h.keyed('div')(
        `voice-${entry.id}`,
        [h.Class(vitaClassName)],
        [
          h.p([h.Class('not-italic [&_em]:not-italic')], lineText(entry, h)),
          Option.match(entry.maybeReason, {
            onNone: () => h.empty,
            onSome: (reason) =>
              h.p(
                [h.Class(quoteClassName)],
                [h.span([h.Class(quoteLabelClassName)], [format(locale, 'voice.reason', {})]), reason],
              ),
          }),
          h.span([h.Class(saidClassName)], [speakerIcon(h), format(locale, 'voice.vitaSaid', { name })]),
        ],
      )

type ViewInputs = { readonly name: string; readonly locale: Locale }

/** The hold-to-talk mic, for the dock. */
export const micView = Submodel.defineView<RobotVoice.Model, Message, ViewInputs>((voice, { name, locale }, h) =>
  micButton(voice, name, locale, h),
)

/** The line under the dock's rows. */
export const statusView = Submodel.defineView<RobotVoice.Model, Message, ViewInputs>((voice, { name, locale }, h) =>
  voiceStatus(voice, name, locale, h),
)

/** While the mic is open or the clip is with 0G: the owner's bubble-to-be, faint, with three dots. */
const pendingBubble = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.p(
    [h.Class(clsx(ownerClassName, 'opacity-55')), h.AriaHidden(true)],
    [
      h.span([h.Class('inline-flex items-center py-1.5')], [workingDots(h)]),
      h.span([h.Class(ownerSaidClassName)], [micIcon(iconClassName, h), format(locale, 'voice.pending', {})]),
    ],
  )

/** The spoken exchange, in the thread after the errand's own messages (a `contents` box: the thread lays them out). */
export const bubblesView = Submodel.defineView<RobotVoice.Model, Message, ViewInputs>((voice, { name, locale }, h) =>
  h.div(
    [h.Class('contents')],
    [
      ...voice.entries.map((entry) => entryView(entry, name, locale, h)),
      RobotVoice.Status.guards.Listening(voice.status) || RobotVoice.Status.guards.Thinking(voice.status)
        ? pendingBubble(locale, h)
        : h.empty,
    ],
  ),
)
