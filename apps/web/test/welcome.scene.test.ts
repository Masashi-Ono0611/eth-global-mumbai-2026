import { Command, click, expect, given, role, scene, text, withViewInputs } from 'foldkit/scene'
import { describe, expect as vitestExpect, test } from 'vitest'
import * as Telegram from '../src/Telegram.ts'
import * as Welcome from '../src/pages/Welcome.ts'
import { welcomeView } from '../src/pages/WelcomeView.ts'
import { address } from './Fixtures.ts'

const view = withViewInputs(welcomeView, { locale: 'en' })()
const started = Welcome.init().model
const poll = Welcome.LoadFunds({ delayMillis: Welcome.POLL_MILLIS })
const telegramStatus = (configured: boolean, linked: boolean) =>
  Welcome.Message.GotTelegramMessage({
    message: Telegram.Message.SucceededLoadTelegram({ configured, linked, username: linked ? 'ana' : null }),
  })
const fundsAre = (balanceUnits: string | null) => Welcome.Message.SucceededLoadFunds({ address, balanceUnits })
const at = (...messages: ReadonlyArray<Welcome.Message>) =>
  messages.reduce((model, message) => Welcome.update(model, message).model, started)

describe('/welcome (first steps after the passkey wallet)', () => {
  test('starts by reading the wallet and the Telegram row', () => {
    scene(
      { update: Welcome.update, view },
      given(started),
      expect(text('Step 1 of 3')).toExist(),
      expect(role('heading', { name: 'Where should your robot reach you?' })).toExist(),
      expect(role('link', { name: 'Go to the wallet' })).toHaveAttr('href', '/app/wallet'),
    )
  })

  test('Telegram linked in the chat moves on to Add money, which watches the balance until USDC arrives', () => {
    scene(
      { update: Welcome.update, view },
      given(at(telegramStatus(true, false), fundsAre('0'))),
      click(role('button', { name: 'Connect Telegram' })),
      Command.resolve(Telegram.LinkTelegram, Telegram.Message.SucceededLinkTelegram({ url: 'https://t.me/x?start=y' })),
      Command.resolve(
        Telegram.PollTelegram,
        Telegram.Message.SucceededPollTelegram({ configured: true, linked: true, username: 'ana' }),
      ),
      expect(text('Step 2 of 3')).toExist(),
      expect(role('heading', { name: 'Add money' })).toExist(),
      expect(role('img', { name: 'QR code of your wallet address' })).toExist(),
      expect(text('Watching for your USDC…')).toExist(),
    )
    // Still empty: read again. Money in: on to the robot, and the watch ends.
    const funding = at(telegramStatus(true, true), fundsAre('0'))
    vitestExpect(
      Welcome.update(funding, fundsAre('0')).commands?.map((command) => [command.name, command.args]),
    ).toEqual([[poll.name, poll.args]])
    const funded = Welcome.update(funding, fundsAre('1000000'))
    vitestExpect(funded.commands).toEqual([])
    scene(
      { update: Welcome.update, view },
      given(funded.model),
      expect(role('heading', { name: 'Add your robot' })).toExist(),
      expect(text('Your wallet has 1.00 USDC.')).toExist(),
      expect(role('link', { name: 'Add a robot' })).toHaveAttr('href', '/app/wallet/robots'),
    )
  })

  test('Telegram can be skipped; a server without a bot skips it by itself; money can come later', () => {
    scene(
      { update: Welcome.update, view },
      given(at(telegramStatus(true, false), fundsAre('0'))),
      click(role('button', { name: 'Not now' })),
      expect(role('heading', { name: 'Add money' })).toExist(),
      click(role('button', { name: "I'll add money later" })),
      expect(role('heading', { name: 'Add your robot' })).toExist(),
    )
    scene(
      { update: Welcome.update, view },
      given(at(fundsAre('0'), telegramStatus(false, false))),
      expect(role('heading', { name: 'Add money' })).toExist(),
    )
  })

  test('a wallet that already holds USDC goes from Telegram straight to the robot', () => {
    scene(
      { update: Welcome.update, view },
      given(at(fundsAre('250000'), telegramStatus(true, true))),
      expect(role('heading', { name: 'Add your robot' })).toExist(),
      expect(text('Your wallet has 0.25 USDC.')).toExist(),
    )
  })
})
