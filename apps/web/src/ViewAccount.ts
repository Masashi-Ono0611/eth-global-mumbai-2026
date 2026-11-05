import type { AccountClaims } from '@ethmumbai/auth/config'
import { format, type Locale } from '@ethmumbai/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { Message } from './message.ts'
import { AuthState, type Model } from './model.ts'
import { passwordFormId } from './PasswordForm.ts'

const signedInView = (claims: AccountClaims, pending: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('account-details')],
    [
      h.h1([], [format(locale, 'account.title', {})]),
      h.dl(
        [],
        [
          h.dt([], [format(locale, 'account.name', {})]),
          h.dd([], [claims.displayName]),
          h.dt([], [format(locale, 'account.email', {})]),
          h.dd([], [claims.email]),
        ],
      ),
      h.button(
        [h.Type('button'), h.Class('primary-action'), h.Disabled(pending), h.OnClick(Message.RequestedSignOut())],
        [format(locale, 'auth.signOut', {})],
      ),
    ],
  )

const signInForm = (pending: boolean, failed: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [],
    [
      h.h1([], [format(locale, 'auth.signInTitle', {})]),
      h.form(
        [h.Id(passwordFormId), h.Class('auth-form'), h.OnSubmit(Message.SubmittedSignIn()), h.AriaBusy(pending)],
        [
          h.label([h.For('auth-email')], [format(locale, 'auth.email', {})]),
          h.input([
            h.Id('auth-email'),
            h.Name('email'),
            h.Type('email'),
            h.Autocomplete('username'),
            h.Required(true),
            h.Maxlength(320),
            h.Readonly(pending),
          ]),
          h.label([h.For('auth-password')], [format(locale, 'auth.password', {})]),
          h.input([
            h.Id('auth-password'),
            h.Name('password'),
            h.Type('password'),
            h.Autocomplete('current-password'),
            h.Required(true),
            h.Maxlength(65536),
            h.Readonly(pending),
          ]),
          failed ? h.p([h.Role('alert'), h.Class('form-error')], [format(locale, 'auth.signInError', {})]) : h.empty,
          h.button(
            [h.Type('submit'), h.Disabled(pending), h.Class('primary-action')],
            [format(locale, pending ? 'auth.signingIn' : 'auth.signInWithEmail', {})],
          ),
        ],
      ),
    ],
  )

export const accountView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  return h.main(
    [h.Id('main'), h.Class('auth-page')],
    [
      AuthState.match(model.auth, {
        Checking: () => h.p([h.Role('status')], [format(locale, 'common.loading', {})]),
        SignedOut: ({ failed }) => signInForm(false, failed, locale, h),
        SigningIn: () => signInForm(true, false, locale, h),
        SignedIn: ({ claims }) => signedInView(claims, false, locale, h),
        SigningOut: ({ claims }) => signedInView(claims, true, locale, h),
        Unavailable: () =>
          h.section(
            [],
            [
              h.p([h.Role('alert')], [format(locale, 'common.error', {})]),
              h.button(
                [h.Type('button'), h.Class('primary-action'), h.OnClick(Message.RequestedSession())],
                [format(locale, 'common.retry', {})],
              ),
            ],
          ),
      }),
    ],
  )
}
