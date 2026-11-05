import { catalogVersion } from '@ethmumbai/i18n'
import { Command, change, click, expect, given, label, role, scene, selector, submit, text } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, expect as vitestExpect, test } from 'vitest'
import { ReadSession, SaveLocale, SignIn, SignOut } from '../src/command.ts'
import { Message } from '../src/message.ts'
import { AuthState } from '../src/model.ts'
import { AppRoute } from '../src/route.ts'
import { init, update } from '../src/update.ts'
import { view } from '../src/View.ts'

const page = (pathname: string) =>
  init({ locale: 'en', catalogVersion, timeZone: 'UTC', referenceTime: 0, pathname }).model

const signedOut = (pathname: string) =>
  modifyFields(page(pathname), { auth: () => AuthState.SignedOut({ failed: false }) })

const claims = { accountId: 'acc_1', displayName: 'ana', email: 'ana@example.com', emailVerified: true }

describe('routes', () => {
  test('each path renders its page and unknown paths render not found', () => {
    scene(
      { update, view },
      given(page('/')),
      expect(role('heading', { name: 'A duck with a budget.' })).toExist(),
      expect(role('link', { name: 'Sign in with email' })).toHaveAttr('href', '/login'),
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
  })

  test('paths parse into typed routes', () => {
    scene({ update, view }, given(page('/account')), expect(role('status')).toHaveText('Loading...'))
    vitestExpect(AppRoute.guards.Home(page('/').route)).toBe(true)
    vitestExpect(AppRoute.guards.Login(page('/login').route)).toBe(true)
    vitestExpect(AppRoute.guards.Account(page('/account').route)).toBe(true)
    vitestExpect(AppRoute.guards.NotFound(page('/login/extra').route)).toBe(true)
  })
})

describe('session', () => {
  test('the first render asks for the session and waits for it', () => {
    vitestExpect(init(page('/login').context).commands?.map((command) => command.name)).toEqual(['ReadSession'])
    scene({ update, view }, given(page('/login')), expect(role('status')).toHaveText('Loading...'))
  })

  test('signing in shows the account, and signing out returns to the form', () => {
    scene(
      { update, view },
      given(signedOut('/login')),
      submit(selector('form')),
      expect(role('button', { name: 'Signing in...' })).toBeDisabled(),
      Command.expectExact(SignIn()),
      Command.resolve(SignIn, Message.SucceededSignIn({ claims })),
      expect(role('heading', { name: 'Account' })).toExist(),
      expect(text('ana@example.com')).toExist(),
      click(role('button', { name: 'Sign out' })),
      Command.expectExact(SignOut()),
      Command.resolve(SignOut, Message.SucceededSignOut()),
      expect(role('heading', { name: 'Sign in' })).toExist(),
    )
  })

  test('a failed sign-in keeps the form and says so', () => {
    scene(
      { update, view },
      given(signedOut('/login')),
      submit(selector('form')),
      Command.resolve(SignIn, Message.FailedSignIn()),
      expect(role('alert')).toHaveText('Sign-in failed. Please try again.'),
      expect(role('button', { name: 'Sign in with email' })).toBeEnabled(),
    )
  })

  test('an unreachable session service offers a retry', () => {
    scene(
      { update, view },
      given(modifyFields(page('/account'), { auth: () => AuthState.Unavailable() })),
      expect(role('alert')).toHaveText('Something went wrong'),
      click(role('button', { name: 'Retry' })),
      Command.resolve(ReadSession, Message.ReceivedSession({ claims })),
      expect(role('heading', { name: 'Account' })).toExist(),
    )
  })
})

describe('language', () => {
  test('choosing a language saves it and renders the page in that language', () => {
    scene(
      { update, view },
      given(signedOut('/')),
      expect(label('Language')).toHaveValue('en'),
      expect(role('heading', { name: 'A duck with a budget.' })).toExist(),
      change(label('Language'), 'sl'),
      Command.expectExact(SaveLocale({ locale: 'sl' })),
      Command.resolve(SaveLocale, Message.SucceededSaveLocale({ locale: 'sl' })),
      expect(role('heading', { name: 'Raca s proračunom.' })).toExist(),
    )
  })

  test('Japanese, Hindi and Marathi are offered and render the page', () => {
    scene(
      { update, view },
      given(signedOut('/')),
      change(label('Language'), 'ja'),
      Command.resolve(SaveLocale, Message.SucceededSaveLocale({ locale: 'ja' })),
      expect(role('heading', { name: '予算を持ったアヒル。' })).toExist(),
      expect(role('link', { name: 'メールでサインイン' })).toHaveAttr('href', '/login'),
      change(label('言語'), 'hi'),
      Command.resolve(SaveLocale, Message.SucceededSaveLocale({ locale: 'hi' })),
      expect(role('heading', { name: 'बजट वाली बत्तख।' })).toExist(),
      change(label('भाषा'), 'mr'),
      Command.resolve(SaveLocale, Message.SucceededSaveLocale({ locale: 'mr' })),
      expect(role('heading', { name: 'बजेट असलेले बदक.' })).toExist(),
    )
  })
})
