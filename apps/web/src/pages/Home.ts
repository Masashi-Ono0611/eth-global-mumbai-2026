import type { SessionView } from '@ethmumbai/auth/config'
import { format, type Locale } from '@ethmumbai/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { Message } from '../message.ts'
import { type AuthFailure, AuthState, type Model } from '../model.ts'
import { walletRouter } from '../route.ts'

// VIEW

/** The team's architecture page on the scratch site (docs/site). */
export const architectureUrl = 'https://eth-mumbai-site.kristjan-grm11775.workers.dev/architecture/'

type Ceremony = 'idle' | 'creating' | 'signingIn'

const failureAlert = (failure: AuthFailure, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.p(
    [h.Role('alert'), h.Class('form-error')],
    [format(locale, failure === 'passkey' ? 'auth.passkeyFailed' : 'auth.serverFailed', {})],
  )

const signUpView = (model: Model, ceremony: Ceremony, maybeFailure: Html, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  const busy = ceremony !== 'idle'
  return h.section(
    [h.Class('passkey-panel')],
    [
      h.form(
        [h.Class('auth-form'), h.OnSubmit(Message.SubmittedCreateWallet()), h.AriaBusy(ceremony === 'creating')],
        [
          h.label([h.For('display-name')], [format(locale, 'auth.displayName', {})]),
          h.input([
            h.Id('display-name'),
            h.Name('displayName'),
            h.Type('text'),
            h.Autocomplete('nickname'),
            h.Required(true),
            h.Maxlength(64),
            h.Value(model.displayName),
            h.Readonly(busy),
            h.OnInput((value) => Message.UpdatedDisplayName({ value })),
          ]),
          h.button(
            [h.Type('submit'), h.Disabled(busy), h.Class('primary-action')],
            [format(locale, ceremony === 'creating' ? 'auth.creatingWallet' : 'auth.createWallet', {})],
          ),
        ],
      ),
      h.button(
        [h.Type('button'), h.Disabled(busy), h.Class('secondary-action'), h.OnClick(Message.ClickedSignIn())],
        [format(locale, ceremony === 'signingIn' ? 'auth.signingIn' : 'auth.signInWithPasskey', {})],
      ),
      maybeFailure,
      h.p([h.Class('hint')], [format(locale, 'auth.passkeyHint', {})]),
    ],
  )
}

const walletView = (session: SessionView, signingOut: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('account-details')],
    [
      h.p([], [format(locale, 'wallet.signedInAs', { name: session.displayName })]),
      h.h2([], [format(locale, 'wallet.address', {})]),
      h.code([h.Class('smart-account')], [session.smartAccount]),
      h.p([h.Class('hint')], [format(locale, 'wallet.addressNote', {})]),
      h.a([h.Href(walletRouter()), h.Class('primary-action')], [format(locale, 'wallet.open', {})]),
      h.button(
        [h.Type('button'), h.Class('secondary-action'), h.Disabled(signingOut), h.OnClick(Message.ClickedSignOut())],
        [format(locale, 'auth.signOut', {})],
      ),
    ],
  )

const authView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  return AuthState.match(model.auth, {
    Checking: () => h.p([h.Role('status')], [format(locale, 'common.loading', {})]),
    SignedOut: () => signUpView(model, 'idle', h.empty, h),
    Refused: ({ failure }) => signUpView(model, 'idle', failureAlert(failure, locale, h), h),
    CreatingWallet: () => signUpView(model, 'creating', h.empty, h),
    SigningIn: () => signUpView(model, 'signingIn', h.empty, h),
    SignedIn: ({ session }) => walletView(session, false, locale, h),
    SigningOut: ({ session }) => walletView(session, true, locale, h),
    Unavailable: () =>
      h.section(
        [],
        [
          h.p([h.Role('alert')], [format(locale, 'common.error', {})]),
          h.button(
            [h.Type('button'), h.Class('primary-action'), h.OnClick(Message.ClickedRetrySession())],
            [format(locale, 'common.retry', {})],
          ),
        ],
      ),
  })
}

/** `/`: what Vitaquack is, then passkey signup or login, or the signed-in owner's smart account. */
export const homeView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  return h.main(
    [h.Id('main')],
    [
      h.section(
        [h.Class('intro')],
        [
          h.h1([], [format(locale, 'landing.title', {})]),
          h.p([h.Class('lead')], [format(locale, 'landing.description', {})]),
          authView(model, h),
          h.a([h.Href(architectureUrl)], [format(locale, 'landing.browse', {})]),
        ],
      ),
      h.section(
        [h.Id('inspiration'), h.Class('inspiration')],
        [h.h2([], [format(locale, 'landing.feedTitle', {})]), h.p([], [format(locale, 'landing.feedDescription', {})])],
      ),
    ],
  )
}
