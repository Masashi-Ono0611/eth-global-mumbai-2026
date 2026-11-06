import { Command, click, expect, given, role, scene, text, withViewInputs } from 'foldkit/scene'
import { describe, expect as vitestExpect, test } from 'vitest'
import * as Telegram from '../src/Telegram.ts'

const view = withViewInputs(Telegram.view, { locale: 'en' })()
/** The row after the server answered `status` (its states are reached only through update). */
const loaded = (configured: boolean, linked: boolean, username: string | null = null) =>
  Telegram.update(Telegram.init(), Telegram.Message.SucceededLoadTelegram({ configured, linked, username })).model
const link = 'https://t.me/vitaquack_bot?start=abcdefghijklmnopqrstuvwxyz012345'

describe('the profile sheet Telegram row', () => {
  test('connect: a one-time link to open Telegram, then Connected after Start', () => {
    scene(
      { update: Telegram.update, view },
      given(loaded(true, false)),
      expect(text('Get a message when I need your OK or have paid.')).toExist(),
      click(role('button', { name: 'Connect Telegram' })),
      Command.expectExact(Telegram.LinkTelegram()),
      Command.resolve(Telegram.LinkTelegram, Telegram.Message.SucceededLinkTelegram({ url: link })),
      expect(role('link', { name: 'Open Telegram' })).toHaveAttr('href', link),
      // Not pressed Start yet: the link stays on screen.
      click(role('button', { name: 'I pressed Start' })),
      Command.resolve(
        Telegram.LoadTelegram,
        Telegram.Message.SucceededLoadTelegram({ configured: true, linked: false, username: null }),
      ),
      expect(role('link', { name: 'Open Telegram' })).toExist(),
      click(role('button', { name: 'I pressed Start' })),
      Command.resolve(
        Telegram.LoadTelegram,
        Telegram.Message.SucceededLoadTelegram({ configured: true, linked: true, username: 'kristjan96' }),
      ),
      expect(role('status')).toHaveText('Connected as @kristjan96'),
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

test('opening the sheet asks the server; a link not yet used survives a reopen', () => {
  const asked = Telegram.opened(Telegram.init())
  vitestExpect(asked.commands?.map((command) => command.name)).toEqual([Telegram.LoadTelegram.name])
  const ready = Telegram.update(loaded(true, false), Telegram.Message.SucceededLinkTelegram({ url: link })).model
  vitestExpect(Telegram.opened(ready).model).toEqual(ready)
})
