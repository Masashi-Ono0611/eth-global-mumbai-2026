import { Command, click, expect, given, role, scene, text, withViewInputs } from 'foldkit/scene'
import { describe, expect as vitestExpect, test } from 'vitest'
import * as Telegram from '../src/Telegram.ts'

const view = withViewInputs(Telegram.view, { locale: 'en' })()
/** The row after the server answered `status` (its states are reached only through update). */
const loaded = (configured: boolean, linked: boolean, username: string | null = null) =>
  Telegram.update(Telegram.init(), Telegram.Message.SucceededLoadTelegram({ configured, linked, username })).model
const link = 'https://t.me/vitaquack_bot?start=abcdefghijklmnopqrstuvwxyz012345'

describe('the profile sheet Telegram row', () => {
  test('connect: a one-time link to open Telegram; the row notices Start by itself', () => {
    const poll = Telegram.PollTelegram({ delayMillis: Telegram.POLL_MILLIS })
    scene(
      { update: Telegram.update, view },
      given(loaded(true, false)),
      expect(text('Get a message when your robot needs your OK or has paid.')).toExist(),
      click(role('button', { name: 'Connect Telegram' })),
      Command.expectExact(Telegram.LinkTelegram()),
      Command.resolve(Telegram.LinkTelegram, Telegram.Message.SucceededLinkTelegram({ url: link })),
      expect(role('link', { name: 'Open Telegram' })).toHaveAttr('href', link),
      expect(role('status')).toHaveText('Waiting for Start in Telegram…'),
      // Not pressed Start yet: the link stays on screen and the row asks again.
      Command.expectExact(poll),
      Command.resolve(
        poll,
        Telegram.Message.SucceededPollTelegram({ configured: true, linked: false, username: null }),
      ),
      expect(role('link', { name: 'Open Telegram' })).toExist(),
      // A failed read keeps watching too.
      Command.resolve(poll, Telegram.Message.FailedPollTelegram()),
      Command.resolve(
        poll,
        Telegram.Message.SucceededPollTelegram({ configured: true, linked: true, username: 'kristjan96' }),
      ),
      expect(role('status')).toHaveText('Connected as @kristjan96'),
      Command.expectNone(),
    )
  })

  test('disconnect returns to Connect; without a configured bot the row is hidden', () => {
    scene(
      { update: Telegram.update, view },
      given(loaded(true, true)),
      expect(role('status')).toHaveText('Connected'),
      click(role('button', { name: 'Disconnect' })),
      Command.expectExact(Telegram.UnlinkTelegram()),
      Command.resolve(Telegram.UnlinkTelegram, Telegram.Message.SucceededUnlinkTelegram()),
      expect(role('button', { name: 'Connect Telegram' })).toExist(),
    )
    scene({ update: Telegram.update, view }, given(loaded(false, false)), expect(text('Telegram')).not.toExist())
  })
})

test('the watch ends with the link: after 10 minutes of polls the row offers Connect again', () => {
  let model = Telegram.update(loaded(true, false), Telegram.Message.SucceededLinkTelegram({ url: link })).model
  for (let poll = 0; poll < 300; poll++) model = Telegram.update(model, Telegram.Message.FailedPollTelegram()).model
  vitestExpect(Telegram.isLinked(model)).toBe(false)
  scene({ update: Telegram.update, view }, given(model), expect(role('button', { name: 'Connect Telegram' })).toExist())
})

test('opening the sheet asks the server; a link not yet used survives a reopen', () => {
  const asked = Telegram.opened(Telegram.init())
  vitestExpect(asked.commands?.map((command) => command.name)).toEqual([Telegram.LoadTelegram.name])
  const ready = Telegram.update(loaded(true, false), Telegram.Message.SucceededLinkTelegram({ url: link })).model
  vitestExpect(Telegram.opened(ready).model).toEqual(ready)
})
