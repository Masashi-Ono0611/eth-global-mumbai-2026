import { catalogVersion } from '@ethmumbai/i18n'
import { Option } from 'effect'
import { Command, Mount, click, expect, given, label, role, scene, selector, submit, text, type } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, expect as vitestExpect, test } from 'vitest'
import { CreatePasskeyWallet, OpenWallet, ReadSession, SignInWithPasskey, SignOut } from '../src/command.ts'
import { Message } from '../src/message.ts'
import { AuthState } from '../src/model.ts'
import { AppRoute } from '../src/route.ts'
import { init, update } from '../src/update.ts'
import { view } from '../src/View.ts'
import { Dialog } from '@foldkit/ui'

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

  test('owner, merchant and gate paths parse into their pages and start loading', () => {
    vitestExpect(AppRoute.guards.Wallet(page('/wallet').route)).toBe(true)
    vitestExpect(AppRoute.guards.Robots(page('/wallet/robots').route)).toBe(true)
    vitestExpect(page('/robot/abc').route).toEqual(AppRoute.RobotConsole({ robotId: 'abc' }))
    vitestExpect(AppRoute.guards.Merchant(page('/merchant').route)).toBe(true)
    vitestExpect(page('/gate/duck-cafe').route).toEqual(AppRoute.Gate({ merchantId: 'duck-cafe' }))
    vitestExpect(
      init({
        locale: 'en',
        catalogVersion,
        timeZone: 'UTC',
        referenceTime: 0,
        pathname: '/wallet/robots',
      }).commands?.map((command) => command.name),
    ).toEqual(['ReadSession', 'LoadRobots'])
    scene({ update, view }, given(signedOut('/gate/duck-cafe')), expect(role('status')).toHaveText('CLOSED'))
    scene(
      { update, view },
      given(page('/wallet')),
      expect(role('heading', { name: 'Wallet', level: 1 })).toExist(),
      expect(role('status')).toHaveText('Loading...'),
    )
  })
})

describe('passkey wallet', () => {
  test('the first render asks for the session and waits for it', () => {
    vitestExpect(init(page('/').context).commands?.map((command) => command.name)).toEqual(['ReadSession'])
    scene({ update, view }, given(page('/')), expect(role('status')).toHaveText('Loading...'))
  })

  test('creating a passkey wallet on the sign-in page opens the wallet', () => {
    scene(
      { update, view },
      given(signedOut('/')),
      type(label('Your name'), 'Ana'),
      submit(selector('form')),
      expect(role('button', { name: 'Creating your wallet...' })).toBeDisabled(),
      expect(role('button', { name: 'Sign in with passkey' })).toBeDisabled(),
      Command.expectExact(CreatePasskeyWallet({ displayName: 'Ana' })),
      Command.resolve(CreatePasskeyWallet, Message.SucceededCreatePasskeyWallet({ session })),
      Command.expectExact(OpenWallet()),
      Command.resolve(OpenWallet, Message.CompletedOpenWallet()),
    )
  })

  test('an owner page without a session shows the sign-in in its place', () => {
    scene(
      { update, view },
      given(signedOut('/wallet')),
      expect(role('button', { name: 'Create passkey wallet' })).toBeEnabled(),
      expect(role('button', { name: 'Sign in with passkey' })).toBeEnabled(),
    )
  })

  test('the avatar opens the profile sheet; signing out there returns to the sign-in', () => {
    scene(
      { update, view },
      given(modifyFields(page('/wallet'), { auth: () => AuthState.SignedIn({ session }) })),
      click(role('button', { name: 'Profile, records and sign out' })),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      expect(role('heading', { name: 'Ana' })).toExist(),
      expect(text(session.smartAccount)).toExist(),
      expect(role('link', { name: 'Payment records' })).toHaveAttr('href', '/wallet/episodes'),
      click(role('button', { name: 'Sign out' })),
      Command.expectExact(SignOut()),
      Command.resolve(SignOut, Message.SucceededSignOut()),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
      Mount.expectEnded(Dialog.AcquireResources),
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
      Command.resolve(OpenWallet, Message.CompletedOpenWallet()),
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
      Command.resolve(OpenWallet, Message.CompletedOpenWallet()),
    )
  })
})
