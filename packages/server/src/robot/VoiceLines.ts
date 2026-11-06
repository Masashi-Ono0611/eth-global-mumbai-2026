import { EpisodeState } from '@ethmumbai/protocol/Errand'
import type { IntentView } from '@ethmumbai/protocol/Intent'
import { VoiceIntent, type VoiceLine } from '@ethmumbai/protocol/Voice'
import { Option, Schema } from 'effect'
import type { CatalogueItem } from '../merchant/Catalogue.ts'

// What Vita says, built by code. The voice model only hears: it returns a transcript, the kind of turn and, for a
// question, one short in-character sentence. Every line about an errand (started, deciding, paid, asking you, walked
// away, safe stop) comes from the intent's typed state and 0G's recorded reason, so the voice can never claim a payment
// that did not happen. The character is the demo kit's (docs/research/vita-voice-demo.md): an opener, one sentence,
// and a closer.

export const SNACKS = 'Budget first, snacks second, QUACK!'
export const BOSS = "That's a boss decision, QUACK!"

const OPENER = {
  quack: 'Quack quack!',
  surprised: 'What the duck?!',
  off: 'Waddle waddle!',
  excited: 'Quaaack!',
} as const

const line = (opener: keyof typeof OPENER, body: string, closer: string): VoiceLine => ({
  text: `${OPENER[opener]} ${body} ${closer}`,
  opener: OPENER[opener],
  closer,
})

/** USDC base units (6 dp) as "0.10". */
export const usdc = (amount: string | bigint) => {
  const units = BigInt(amount)
  const cents = (units + 5_000n) / 10_000n
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`
}

/** The facts a question is answered from: the café's menu and the robot's real limits (never the model's words). */
export interface VoiceFacts {
  readonly items: ReadonlyArray<CatalogueItem>
  /** The signed grant's limits and today's spend; none before the owner signs a grant. */
  readonly limits: Option.Option<{
    readonly perPayment: bigint
    readonly daily: bigint
    readonly spentToday: bigint
  }>
}

/**
 * What a question is about. The model only picks the topic; the answer is a fixed sentence built here from the facts,
 * so no model text is ever spoken (it could claim a payment in words no filter anticipates).
 */
const VoiceTopic = Schema.Literals(['menu', 'limits', 'decider', 'switch_off', 'status', 'other'])
type VoiceTopic = typeof VoiceTopic.Type

/** The hearing prompt: classify the owner's transcribed words. The model writes nothing Vita says. */
export const hearingPrompt = (items: ReadonlyArray<CatalogueItem>) =>
  [
    'You are the ears of Vita, a robot duck that runs errands at the Duck Café for its owner.',
    'The owner just spoke to Vita; the user message is the transcript of what they said. Answer with one JSON object and nothing else:',
    '{"heard": what the owner said, in English, at most 200 characters,',
    ' "intent": "buy" when they ask Vita to get, buy or fetch something; "stop" when they ask Vita to stop, cancel or come back; otherwise "question",',
    ` "item": for "buy", the item they asked for, exactly one of ${items.map((item) => `"${item.itemId}"`).join(', ')}, or null when it is not on that list; null otherwise,`,
    ' "topic": for "question", what it is about: "menu" (what Vita can get, prices), "limits" (budget, spending limits), "decider" (who decides what Vita buys), "switch_off" (stopping or switching Vita off for good), "status" (whether something was bought or paid, where an errand is), or "other"; null otherwise}.',
    'English only.',
  ].join('\n')

const Heard = Schema.Struct({
  heard: Schema.String,
  intent: VoiceIntent,
  item: Schema.optionalKey(Schema.NullOr(Schema.String)),
  topic: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
const HeardJson = Schema.fromJsonString(Heard)
const Content = Schema.Struct({ content: Schema.String })

export type Hearing =
  | {
      readonly ok: true
      readonly heard: string
      readonly intent: VoiceIntent
      readonly item: string | null
      readonly topic: VoiceTopic
    }
  | { readonly ok: false; readonly error: string }

/**
 * The hearing model's reply as a typed turn. The reason for a failure names the shape (never the text). An item off the
 * menu becomes null, an unknown topic is `other`, and an empty transcript is a failure: Vita does not guess what it did
 * not hear.
 */
export const parseHearing = (message: unknown, items: ReadonlyArray<CatalogueItem>): Hearing => {
  const content = Schema.decodeUnknownOption(Content)(message)
  if (Option.isNone(content)) return { ok: false, error: 'reply has no text content' }
  const text = content.value.content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const parsed = Schema.decodeUnknownOption(HeardJson)(text)
  if (Option.isNone(parsed)) return { ok: false, error: `reply is not the hearing JSON (${text.length} chars)` }
  const heard = parsed.value.heard.trim().slice(0, 200)
  if (heard.length === 0) return { ok: false, error: 'heard nothing' }
  const item = parsed.value.item ?? null
  return {
    ok: true,
    heard,
    intent: parsed.value.intent,
    item: items.some((known) => known.itemId === item) ? item : null,
    topic: Option.getOrElse(Schema.decodeUnknownOption(VoiceTopic)(parsed.value.topic), (): VoiceTopic => 'other'),
  }
}

const menuText = (items: ReadonlyArray<CatalogueItem>) =>
  `${items
    .slice(0, -1)
    .map((item) => item.name.toLowerCase())
    .join(', ')} or ${items.at(-1)?.name.toLowerCase() ?? 'a snack'}`

const priced = (items: ReadonlyArray<CatalogueItem>) =>
  items.map((item) => `${item.name.toLowerCase()} ${usdc(item.amount)}`).join(', ')

/** A question's answer, from its topic and the real facts only: one sentence, one pun, the closer. */
export const answerLine = (topic: VoiceTopic, facts: VoiceFacts) => {
  switch (topic) {
    case 'menu':
      return line('quack', `The Duck Café has ${priced(facts.items)} USDC; egg-cellent choices.`, SNACKS)
    case 'limits':
      return Option.match(facts.limits, {
        onNone: () => line('surprised', 'You have not given me a budget yet, so I cannot buy a thing.', BOSS),
        onSome: ({ perPayment, daily, spentToday }) =>
          line(
            'quack',
            `My feather-weight budget is ${usdc(perPayment)} per payment and ${usdc(daily)} a day, ${usdc(spentToday)} spent today.`,
            SNACKS,
          ),
      })
    case 'decider':
      return line('quack', 'My 0G brain decides every purchase, and you approve the big ones; no fowl play.', SNACKS)
    case 'switch_off':
      return line(
        'surprised',
        'One Stop from you ends my grant on Arc, and Arc refuses my next payment; quack-tually final.',
        BOSS,
      )
    case 'status':
      return line('quack', 'Only the errand card knows what 0G and Arc recorded; I quack what it says.', SNACKS)
    case 'other':
      return line('quack', `I can fetch ${menuText(facts.items)}; just ask me, it is egg-cellent.`, SNACKS)
  }
}

export const offMenuLine = (items: ReadonlyArray<CatalogueItem>) =>
  line('surprised', `The Duck Café only has ${menuText(items)}.`, SNACKS)

export const busyLine = () => line('surprised', 'I am already on an errand; stop it first or wait for me.', BOSS)

export const notPairedLine = () => line('surprised', 'I have no chip paired, so I cannot run errands yet.', BOSS)

/**
 * After a spoken stop. Ending the intent starts nothing new, but it cannot recall an errand already under way (deciding,
 * awaiting approval, signing, settling): Vita says so and points at Stop on Arc instead of promising nothing gets paid.
 */
export const stoppedLine = (stopped: boolean, paying = false) => {
  if (!stopped)
    return paying
      ? line(
          'surprised',
          'Nothing new to stop, but an errand already under way may still pay; Stop on Arc switches me off.',
          BOSS,
        )
      : line('quack', 'I am not on an errand right now.', SNACKS)
  return paying
    ? line(
        'off',
        'Stopped: I start nothing new, but the errand already under way may still pay; Stop on Arc switches me off.',
        BOSS,
      )
    : line('off', 'Stopping right here; I start nothing new on this errand.', BOSS)
}

const article = (item: CatalogueItem) => `${/^[aeiou]/i.test(item.name) ? 'an' : 'a'} ${item.name.toLowerCase()}`

/**
 * The intent's instruction for a spoken buy, built from the catalogue item: the transcript itself is never stored
 * (`intents.instruction` keeps this canonical sentence, as a Buy chip's does).
 */
export const voiceInstruction = (item: CatalogueItem) => `Get me ${article(item)}`

/**
 * An errand's terminal or live episode state, as Vita says it. It names no item, price or reason: the robot pays the
 * invoice it scanned (not necessarily what was asked for), and an approval can have several causes; the chat's receipt
 * and approval cards carry those facts. 0G's own reason is model text, shown as a quote (`VoiceSay.decisionReason`).
 */
const episodeLine = (state: EpisodeState): VoiceLine => {
  switch (state) {
    case 'queued':
    case 'deciding':
      return line('quack', 'My 0G brain is deciding on what the counter shows.', SNACKS)
    case 'awaiting_approval':
      return line('surprised', 'This one needs your approval in World App.', BOSS)
    case 'signing':
    case 'settling':
      return line('off', 'My chip is paying on Arc; only Arc can settle it.', SNACKS)
    case 'paid':
      return line('excited', 'Paid on Arc; the receipt in the chat shows what and how much.', SNACKS)
    case 'walked_away':
      return line('surprised', "I walked away and paid nothing; 0G's reason is in the chat.", BOSS)
    case 'denied':
      // A World failure ends in `denied` too: Vita does not claim the owner said no.
      return line('quack', 'The approval was not given, so nothing was paid.', BOSS)
    case 'safe_stop':
      return line('surprised', 'Safe stop: this errand stopped without paying.', BOSS)
    case 'refused':
      return line('surprised', 'My chip refused to sign, so nothing was paid.', BOSS)
    case 'failed':
      return line('surprised', 'The errand failed; the chat shows whether anything was paid.', BOSS)
    case 'expired':
      return line('surprised', 'The errand expired, so nothing was paid.', BOSS)
  }
}

const offTo = (thing: string) => line('off', `Off to the counter for ${thing}; I pay only when 0G says so.`, SNACKS)
const noScanLine = () => line('surprised', 'No counter QR code in time, so I stopped and paid nothing.', BOSS)
const finishedLine = () => line('quack', 'That errand is finished.', SNACKS)

/** Vita's line for an intent as it is now: from its state and its episode's state only. */
export const intentLine = (intent: IntentView, item: Option.Option<CatalogueItem>) => {
  if (intent.episodeState !== null) return episodeLine(intent.episodeState)
  switch (intent.state) {
    case 'running':
    case 'scanned':
      return offTo(Option.match(item, { onNone: () => 'your errand', onSome: article }))
    case 'stopped':
      return stoppedLine(true)
    case 'expired':
      return noScanLine()
    case 'finished':
      return finishedLine()
  }
}

/**
 * Every line Vita can say for this menu that depends on no robot's state: all of them but the answer quoting a signed
 * grant's limits. Their speech can be made ahead (`POST …/voice/warm`), so those lines play at once.
 */
export const fixedLines = (items: ReadonlyArray<CatalogueItem>): ReadonlyArray<VoiceLine> => {
  const lines = [
    ...VoiceTopic.literals.map((topic) => answerLine(topic, { items, limits: Option.none() })),
    offMenuLine(items),
    busyLine(),
    notPairedLine(),
    ...[false, true].flatMap((stopped) => [stoppedLine(stopped, false), stoppedLine(stopped, true)]),
    ...EpisodeState.literals.map(episodeLine),
    offTo('your errand'),
    ...items.map((item) => offTo(article(item))),
    noScanLine(),
    finishedLine(),
  ]
  return lines.filter((each, index) => lines.findIndex((other) => other.text === each.text) === index)
}
