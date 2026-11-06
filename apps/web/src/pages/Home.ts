import { format, type Locale } from '@ethmumbai/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { Message } from '../message.ts'
import { type AuthFailure, AuthState, type Model } from '../model.ts'
import { duck } from '../Duck.ts'
import { walletRouter } from '../route.ts'

// STYLES

const mainClassName = 'grid min-h-[calc(100svh-2rem)] content-center gap-6 px-2 py-8'
const heroClassName = 'grid justify-items-start gap-3'
const faceClassName = 'grid size-20 place-items-center rounded-full bg-ink'
const titleClassName = 'font-display text-[2.6rem] leading-[1.05] font-extrabold tracking-[-0.015em] text-balance'
const leadClassName = 'max-w-[34ch] text-[1.1rem] text-muted text-pretty'
const panelClassName = 'grid gap-3'
const formClassName = 'grid gap-2'
const labelClassName = 'text-sm font-semibold text-muted'
const inputClassName =
  'min-h-12 w-full rounded-control border border-rule bg-surface px-3.5 text-base text-ink placeholder:text-muted'
const primaryClassName =
  'min-h-12 cursor-pointer rounded-control bg-ink px-4 font-semibold text-surface transition-transform active:scale-[0.96] disabled:opacity-60'
const secondaryClassName =
  'min-h-12 cursor-pointer rounded-control bg-surface px-4 font-semibold transition-transform active:scale-[0.96] disabled:opacity-60'
const hintClassName = 'text-sm text-muted text-pretty'
const errorClassName = 'text-error'
const linkClassName = 'justify-self-start text-sm font-semibold'

// VIEW

/** The team's architecture page on the scratch site (docs/site). */
export const architectureUrl = 'https://eth-mumbai-site.kristjan-grm11775.workers.dev/architecture/'

type Ceremony = 'idle' | 'creating' | 'signingIn'

const failureAlert = (failure: AuthFailure, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.p(
    [h.Role('alert'), h.Class(errorClassName)],
    [format(locale, failure === 'passkey' ? 'auth.passkeyFailed' : 'auth.serverFailed', {})],
  )

const signUpView = (model: Model, ceremony: Ceremony, maybeFailure: Html, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  const busy = ceremony !== 'idle'
  return h.section(
    [h.Class(panelClassName)],
    [
      h.form(
        [h.Class(formClassName), h.OnSubmit(Message.SubmittedCreateWallet()), h.AriaBusy(ceremony === 'creating')],
        [
          h.label([h.For('display-name'), h.Class(labelClassName)], [format(locale, 'auth.displayName', {})]),
          h.input([
            h.Id('display-name'),
            h.Name('displayName'),
            h.Type('text'),
            h.Class(inputClassName),
            h.Autocomplete('nickname'),
            h.Required(true),
            h.Maxlength(64),
            h.Value(model.displayName),
            h.Readonly(busy),
            h.OnInput((value) => Message.UpdatedDisplayName({ value })),
          ]),
          h.button(
            [h.Type('submit'), h.Disabled(busy), h.Class(primaryClassName)],
            [format(locale, ceremony === 'creating' ? 'auth.creatingWallet' : 'auth.createWallet', {})],
          ),
        ],
      ),
      h.button(
        [h.Type('button'), h.Disabled(busy), h.Class(secondaryClassName), h.OnClick(Message.ClickedSignIn())],
        [format(locale, ceremony === 'signingIn' ? 'auth.signingIn' : 'auth.signInWithPasskey', {})],
      ),
      maybeFailure,
      h.p([h.Class(hintClassName)], [format(locale, 'auth.passkeyHint', {})]),
    ],
  )
}

/** Signed in on this page: the wallet opens (a full load) — the link is there if it does not. */
const openingView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class(panelClassName)],
    [
      h.p([h.Role('status')], [format(locale, 'auth.openingWallet', {})]),
      h.a([h.Href(walletRouter()), h.Class(linkClassName)], [format(locale, 'wallet.open', {})]),
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
    SignedIn: () => openingView(locale, h),
    SigningOut: () => openingView(locale, h),
    Unavailable: () =>
      h.section(
        [h.Class(panelClassName)],
        [
          h.p([h.Role('alert')], [format(locale, 'common.error', {})]),
          h.button(
            [h.Type('button'), h.Class(primaryClassName), h.OnClick(Message.ClickedRetrySession())],
            [format(locale, 'common.retry', {})],
          ),
        ],
      ),
  })
}

/** `/` (and any owner page without a session): what Vitaquack is, then passkey signup or sign-in. The landing page
 *  replaces the pitch here in iteration 2. */
export const homeView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  return h.main(
    [h.Id('main'), h.Class(mainClassName)],
    [
      h.section(
        [h.Class(heroClassName)],
        [
          h.span([h.Class(faceClassName)], [duck('size-14', false, h)]),
          h.h1([h.Class(titleClassName)], [format(locale, 'landing.title', {})]),
          h.p([h.Class(leadClassName)], [format(locale, 'landing.description', {})]),
        ],
      ),
      authView(model, h),
      h.a([h.Href(architectureUrl), h.Class(linkClassName)], [format(locale, 'landing.browse', {})]),
    ],
  )
}
