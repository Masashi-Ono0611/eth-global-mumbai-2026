import { catalogVersion } from '@ethmumbai/i18n'
import { Option } from 'effect'
import { Command, change, click, expect, given, label, role, scene, selector, submit, text, type } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, expect as vitestExpect, test } from 'vitest'
import { CreatePasskeyWallet, ReadSession, SaveLocale, SignInWithPasskey, SignOut } from '../src/command.ts'
import { Message } from '../src/message.ts'
import { AuthState } from '../src/model.ts'
import { AppRoute } from '../src/route.ts'
import { init, update } from '../src/update.ts'
import { view } from '../src/View.ts'

const page = (pathname: string) =>
  init({ locale: 'en', catalogVersion, timeZone: 'UTC', referenceTime: 0, pathname }).model

const signedOut = (pathname: string) => modifyFields(page(pathname), { auth: () => AuthState.SignedOut() })

const session = {
  accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
  displayName: 'Ana',
  smartAccount: '0x1234567890abcdef1234567890ABCDEF12345678',
}

describe('routes', () => {
  test('the home page renders and unknown paths render not found', () => {
    scene(
      { update, view },
      given(signedOut('/')),
      expect(role('heading', { name: 'A duck with a budget.' })).toExist(),
      expect(role('button', { name: 'Create passkey wallet' })).toBeEnabled(),
      expect(role('link', { name: 'Read the architecture' })).toHaveAttr(
        'href',
        'https://eth-mumbai-site.kristjan-grm11775.workers.dev/architecture/',
      ),
    )
    scene(
      { update, view },
      given(page('/nope')),
      expect(role('heading', { name: 'Page not found' })).toExist(),
      expect(role('link', { name: 'Go to home' })).toHaveAttr('href', '/'),
    )
    vitestExpect(AppRoute.guards.Home(page('/').route)).toBe(true)
    vitestExpect(AppRoute.guards.NotFound(page('/login').route)).toBe(true)
  })
})

describe('passkey wallet', () => {
  test('the first render asks for the session and waits for it', () => {
    vitestExpect(init(page('/').context).commands?.map((command) => command.name)).toEqual(['ReadSession'])
    scene({ update, view }, given(page('/')), expect(role('status')).toHaveText('Loading...'))
  })

  test('creating a passkey wallet shows the counterfactual smart account, and signing out returns to signup', () => {
    scene(
      { update, view },
      given(signedOut('/')),
      type(label('Your name'), 'Ana'),
      submit(selector('form')),
      expect(role('button', { name: 'Creating your wallet...' })).toBeDisabled(),
      expect(role('button', { name: 'Sign in with passkey' })).toBeDisabled(),
      Command.expectExact(CreatePasskeyWallet({ displayName: 'Ana' })),
      Command.resolve(CreatePasskeyWallet, Message.SucceededCreatePasskeyWallet({ session })),
      expect(text('Signed in as Ana')).toExist(),
      expect(role('heading', { name: 'Your smart account on Arc' })).toExist(),
      expect(text(session.smartAccount)).toExist(),
      click(role('button', { name: 'Sign out' })),
      Command.expectExact(SignOut()),
      Command.resolve(SignOut, Message.SucceededSignOut()),
      expect(role('button', { name: 'Create passkey wallet' })).toExist(),
    )
  })

  test('an empty name starts no ceremony', () => {
    scene(
      { update, view },
      given(signedOut('/')),
      type(label('Your name'), '   '),
      submit(selector('form')),
      expect(role('button', { name: 'Create passkey wallet' })).toBeEnabled(),
    )
  })

  test('signing in with a passkey shows the account; a dismissed prompt says so and can be retried', () => {
    scene(
      { update, view },
      given(signedOut('/')),
      click(role('button', { name: 'Sign in with passkey' })),
      expect(role('button', { name: 'Signing in...' })).toBeDisabled(),
      Command.expectExact(SignInWithPasskey()),
      Command.resolve(SignInWithPasskey, Message.FailedSignInWithPasskey({ failure: 'passkey' })),
      expect(role('alert')).toHaveText('The passkey step did not finish. Please try again.'),
      click(role('button', { name: 'Sign in with passkey' })),
      Command.resolve(SignInWithPasskey, Message.SucceededSignInWithPasskey({ session })),
      expect(text(session.smartAccount)).toExist(),
    )
  })

  test('a Worker failure during signup is reported separately from the passkey prompt', () => {
    scene(
      { update, view },
      given(signedOut('/')),
      type(label('Your name'), 'Ana'),
      submit(selector('form')),
      Command.resolve(CreatePasskeyWallet, Message.FailedCreatePasskeyWallet({ failure: 'server' })),
      expect(role('alert')).toHaveText('The wallet service did not answer. Please try again.'),
      expect(role('button', { name: 'Create passkey wallet' })).toBeEnabled(),
    )
  })

  test('an unreachable session service offers a retry', () => {
    scene(
      { update, view },
      given(modifyFields(page('/'), { auth: () => AuthState.Unavailable() })),
      expect(role('alert')).toHaveText('Something went wrong'),
      click(role('button', { name: 'Retry' })),
      Command.resolve(ReadSession, Message.SucceededReadSession({ maybeSession: Option.some(session) })),
      expect(text('Signed in as Ana')).toExist(),
    )
  })
})

describe('language', () => {
  test('choosing a language saves it and renders the page in that language', () => {
    scene(
      { update, view },
      given(signedOut('/')),
      expect(label('Language')).toHaveValue('en'),
      change(label('Language'), 'sl'),
      Command.expectExact(SaveLocale({ locale: 'sl' })),
      Command.resolve(SaveLocale, Message.SucceededSaveLocale({ locale: 'sl' })),
      expect(role('heading', { name: 'Raca s proračunom.' })).toExist(),
      expect(role('button', { name: 'Ustvari denarnico s ključem za dostop' })).toExist(),
    )
  })

  test('Japanese, Hindi and Marathi are offered and render the page', () => {
    scene(
      { update, view },
      given(signedOut('/')),
      change(label('Language'), 'ja'),
      Command.resolve(SaveLocale, Message.SucceededSaveLocale({ locale: 'ja' })),
      expect(role('heading', { name: '予算を持ったアヒル。' })).toExist(),
      expect(role('button', { name: 'パスキーでサインイン' })).toExist(),
      change(label('言語'), 'hi'),
      Command.resolve(SaveLocale, Message.SucceededSaveLocale({ locale: 'hi' })),
      expect(role('heading', { name: 'बजट वाली बत्तख।' })).toExist(),
      change(label('भाषा'), 'mr'),
      Command.resolve(SaveLocale, Message.SucceededSaveLocale({ locale: 'mr' })),
      expect(role('heading', { name: 'बजेट असलेले बदक.' })).toExist(),
      expect(role('button', { name: 'पासकी वॉलेट तयार करा' })).toExist(),
    )
  })
})
