import type { IntentView } from '@ethmumbai/protocol/Intent'
import { Option } from 'effect'
import { expect, test } from 'vitest'
import { merchants } from '../src/merchant/Catalogue.ts'
import {
  answerLine,
  BOSS,
  hearingPrompt,
  intentLine,
  parseHearing,
  SNACKS,
  stoppedLine,
  usdc,
  voiceInstruction,
} from '../src/robot/VoiceLines.ts'

const items = merchants[0]?.items ?? []
const chai = Option.fromNullishOr(items.find((item) => item.itemId === 'chai'))
const thali = Option.fromNullishOr(items.find((item) => item.itemId === 'thali'))
const reply = (content: unknown) => ({ role: 'assistant', content })

const intent = (patch: Partial<IntentView>): IntentView => ({
  id: 'intent-1',
  robotId: 'robot-1',
  state: 'scanned',
  instruction: 'Can you buy me a chai?',
  item: 'chai',
  episodeId: 'episode-1',
  episodeState: null,
  reason: null,
  turns: [],
  createdAt: 0,
  ...patch,
})

test('the hearing JSON becomes a typed turn, also inside a code fence', () => {
  expect(
    parseHearing(reply('{"heard":"Can you buy me a chai?","intent":"buy","item":"chai","topic":null}'), items),
  ).toEqual({ ok: true, heard: 'Can you buy me a chai?', intent: 'buy', item: 'chai', topic: 'other' })
  expect(parseHearing(reply('```json\n{"heard":"Stop!","intent":"stop","item":null}\n```'), items)).toMatchObject({
    ok: true,
    intent: 'stop',
    item: null,
  })
})

test('an item off the menu is no item, and nothing the model could not hear is guessed', () => {
  expect(parseHearing(reply('{"heard":"Get me a coffee","intent":"buy","item":"coffee"}'), items)).toMatchObject({
    ok: true,
    intent: 'buy',
    item: null,
  })
  expect(parseHearing(reply('{"heard":"  ","intent":"buy","item":"chai"}'), items)).toEqual({
    ok: false,
    error: 'heard nothing',
  })
  expect(parseHearing(reply('{"heard":"hi","intent":"pay"}'), items)).toMatchObject({ ok: false })
  expect(parseHearing(reply('Sure, I will buy you a chai!'), items)).toEqual({
    ok: false,
    error: 'reply is not the hearing JSON (28 chars)',
  })
  expect(parseHearing({ role: 'assistant', tool_calls: [] }, items)).toEqual({
    ok: false,
    error: 'reply has no text content',
  })
})

const facts = {
  items,
  limits: Option.some({ perPayment: 1_000_000n, daily: 3_000_000n, spentToday: 250_000n }),
}

test('a question is answered by code from its topic and the real facts; the model writes nothing Vita says', () => {
  expect(answerLine('limits', facts).text).toBe(
    `Quack quack! My feather-weight budget is 1.00 per payment and 3.00 a day, 0.25 spent today. ${SNACKS}`,
  )
  expect(answerLine('limits', { items, limits: Option.none() }).closer).toBe(BOSS)
  expect(answerLine('menu', facts).text).toContain('chai 0.10, samosa 0.25, thali 2.00 USDC')
  for (const topic of ['menu', 'limits', 'decider', 'switch_off', 'status', 'other'] as const)
    expect(answerLine(topic, facts).text).not.toMatch(/\b(paid|bought|ordered|settled|succeeded)\b/i)
  expect(
    parseHearing(reply('{"heard":"Did you pay?","intent":"question","topic":"status","answer":"Yes, I paid!"}'), items),
  ).toEqual({ ok: true, heard: 'Did you pay?', intent: 'question', item: null, topic: 'status' })
  expect(parseHearing(reply('{"heard":"Sing!","intent":"question","topic":"karaoke"}'), items)).toMatchObject({
    topic: 'other',
  })
})

test('every errand line comes from the typed state; only `paid` says paid', () => {
  const paid = intentLine(intent({ state: 'finished', episodeState: 'paid' }), chai)
  expect(paid.text).toBe(`Quaaack! Paid on Arc; the receipt in the chat shows what and how much. ${SNACKS}`)
  // The robot pays what it scanned: the line names no item or price that the request might contradict.
  expect(intentLine(intent({ item: 'chai', state: 'finished', episodeState: 'paid' }), chai).text).not.toMatch(
    /chai|0\.10/,
  )
  const asking = intentLine(intent({ item: 'thali', episodeState: 'awaiting_approval' }), thali)
  expect(asking.text).toBe(`What the duck?! This one needs your approval in World App. ${BOSS}`)
  expect(intentLine(intent({ state: 'finished', episodeState: 'refused' }), chai).text).toContain(
    'My chip refused to sign',
  )
  // `denied` is also a World failure, and `signing` also follows the owner's approval: neither line names who decided.
  expect(intentLine(intent({ state: 'finished', episodeState: 'denied' }), thali).text).not.toContain('You said no')
  expect(intentLine(intent({ episodeState: 'signing' }), thali).text).not.toContain('0G said pay')
  expect(asking.closer).toBe(BOSS)
  expect(intentLine(intent({ state: 'finished', episodeState: 'failed' }), thali).text).not.toMatch(/nothing was paid/)
  for (const state of ['walked_away', 'denied', 'safe_stop', 'refused', 'expired'] as const)
    expect(intentLine(intent({ state: 'finished', episodeState: state }), thali).text).toMatch(
      /^[^!]+! (?!Paid)[^]*(paid nothing|nothing was paid|without paying)/,
    )
  expect(intentLine(intent({ state: 'running', episodeId: null }), chai).text).toBe(
    `Waddle waddle! Off to the counter for a chai; I pay only when 0G says so. ${SNACKS}`,
  )
  expect(intentLine(intent({ state: 'expired', episodeId: null }), chai).closer).toBe(BOSS)
})

test('the hearing prompt names the menu ids and asks only to classify', () => {
  const prompt = hearingPrompt(items)
  expect(prompt).toContain('exactly one of "chai", "samosa", "thali"')
  expect(prompt).toContain('"topic"')
  expect(prompt).not.toMatch(/sentence|pun/i)
  expect(usdc('2000000')).toBe('2.00')
  expect(usdc(1n)).toBe('0.00')
})

test('a spoken stop never promises that a signed payment stops', () => {
  expect(stoppedLine(true).text).toContain('I start nothing new')
  expect(stoppedLine(true).text).not.toMatch(/nothing (more )?gets paid/)
  expect(stoppedLine(true, true).text).toContain('may still pay')
  expect(stoppedLine(false, true).text).toContain('may still pay')
  expect(stoppedLine(false).closer).toBe(SNACKS)
})

test('a spoken buy stores a sentence built from the catalogue, never the transcript', () => {
  const [first, , last] = items
  expect(first === undefined ? '' : voiceInstruction(first)).toBe('Get me a chai')
  expect(last === undefined ? '' : voiceInstruction(last)).toBe('Get me a thali')
})
