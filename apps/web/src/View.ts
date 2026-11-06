import { format, type Locale } from '@ethmumbai/i18n'
import { Option } from 'effect'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { Dialog } from '@foldkit/ui'
import type { SessionView } from '@ethmumbai/auth/config'
import { sheetTitleClassName, sheetView } from './Sheet.ts'
import { avatarSkeleton } from './Skeleton.ts'
import { Message } from './message.ts'
import { AuthState, type Model } from './model.ts'
import { architectureUrl, homeView } from './pages/Home.ts'
import * as Approval from './pages/Approval.ts'
import { episodeView } from './pages/EpisodeView.ts'
import * as Episodes from './pages/Episodes.ts'
import * as Gate from './pages/gate/Gate.ts'
import * as Merchant from './pages/merchant/Merchant.ts'
import { robotConsoleView } from './pages/RobotConsoleView.ts'
import { addRobotView } from './pages/AddRobotView.ts'
import { walletView } from './pages/WalletView.ts'
import { welcomeView } from './pages/WelcomeView.ts'
import { AppRoute, episodesRouter, homeRouter, walletRouter } from './route.ts'
import * as Telegram from './Telegram.ts'
// STYLES

const appShellClassName =
  'mx-auto flex min-h-svh w-full max-w-[30rem] flex-col pt-[env(safe-area-inset-top)] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))]'
const topBarClassName = 'flex items-center justify-between px-1.5 pt-2 pb-1'
const avatarClassName =
  'grid size-11 cursor-pointer place-items-center rounded-full bg-ink pt-0.5 font-display text-lg font-bold text-surface transition-transform active:scale-[0.96]'
const profileListClassName =
  'grid gap-1 [&_a]:flex [&_a]:min-h-11 [&_a]:items-center [&_a]:no-underline [&_a]:font-semibold'
const profileAddressClassName = 'font-mono text-sm break-all text-muted'
const signOutClassName =
  'min-h-12 cursor-pointer rounded-control bg-error-soft font-semibold text-error transition-transform active:scale-[0.96] disabled:opacity-60'
const wideNavClassName = 'flex gap-4'

/** The merchant and gate pages keep the wide layout and a small masthead until they are redesigned. */
const wideNav = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  return AuthState.guards.SignedIn(model.auth)
    ? h.nav(
        [h.Class(wideNavClassName)],
        [
          h.a([h.Href(walletRouter())], [format(locale, 'wallet.title', {})]),
          h.a([h.Href(episodesRouter())], [format(locale, 'episodes.title', {})]),
        ],
      )
    : h.empty
}

/** The avatar's sheet: who is signed in, their address, the audit log and sign out. */
const profileSheet = (model: Model, session: SessionView, signingOut: boolean, h: HtmlBuilder<Message>): Html => {
  const { locale } = model.context
  return h.submodel({
    slotId: model.profileSheet.id,
    model: model.profileSheet,
    view: Dialog.view,
    viewInputs: {
      hasDescription: true,
      toView: (render: Dialog.RenderInfo) =>
        sheetView(
          render,
          [
            h.h2([...render.title, h.Class(sheetTitleClassName)], [session.displayName]),
            h.div(
              [...render.description, h.Class('grid gap-1')],
              [
                h.p([h.Class('text-muted')], [format(locale, 'profile.address', {})]),
                h.p([h.Class(profileAddressClassName)], [session.smartAccount]),
              ],
            ),
            h.div(
              [h.Class(profileListClassName)],
              [
                h.a([h.Href(episodesRouter())], [format(locale, 'profile.records', {})]),
                h.a([h.Href(architectureUrl)], [format(locale, 'profile.howItWorks', {})]),
              ],
            ),
            h.submodel({
              slotId: 'telegram',
              model: model.telegram,
              view: Telegram.view,
              viewInputs: { locale },
              toParentMessage: (message) => Message.GotTelegramMessage({ message }),
            }),
            h.button(
              [
                h.Type('button'),
                h.Class(signOutClassName),
                h.Disabled(signingOut),
                h.OnClick(Message.ClickedSignOut()),
              ],
              [format(locale, 'auth.signOut', {})],
            ),
          ],
          format(locale, 'profile.close', {}),
          h,
        ),
    },
    toParentMessage: (message) => Message.GotProfileSheetMessage({ message }),
  })
}

/** The wallet home's top bar: the avatar opens the profile sheet. */
const walletTopBar = (model: Model, h: HtmlBuilder<Message>): Html =>
  AuthState.match(model.auth, {
    SignedIn: ({ session }) => topBar(model, session, false, h),
    SigningOut: ({ session }) => topBar(model, session, true, h),
    Checking: () => h.header([h.Class(topBarClassName)], [avatarSkeleton(h)]),
    SignedOut: () => h.empty,
    Refused: () => h.empty,
    CreatingWallet: () => h.empty,
    SigningIn: () => h.empty,
    Unavailable: () => h.empty,
  })

const topBar = (model: Model, session: SessionView, signingOut: boolean, h: HtmlBuilder<Message>): Html =>
  h.header(
    [h.Class(topBarClassName)],
    [
      h.button(
        [
          h.Type('button'),
          h.Class(avatarClassName),
          h.AriaLabel(format(model.context.locale, 'profile.open', {})),
          h.OnClick(Message.ClickedProfile()),
        ],
        [session.displayName.trim().slice(0, 1).toUpperCase()],
      ),
      profileSheet(model, session, signingOut, h),
    ],
  )

const notFoundView = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.main(
    [h.Id('main'), h.Class('intro')],
    [
      h.h1([], [format(locale, 'common.notFoundTitle', {})]),
      h.p([], [format(locale, 'common.notFoundDescription', {})]),
      h.a([h.Href(homeRouter())], [format(locale, 'common.goHome', {})]),
    ],
  )

type Page = { readonly title: string; readonly body: Html }

/** An owner, merchant or gate page: its Submodel when the route created one, otherwise not found. */
const childPage = <A>(
  model: Model,
  title: string,
  maybeChild: Option.Option<A>,
  embed: (child: A) => Html,
  h: HtmlBuilder<Message>,
): Page => ({
  title,
  body: Option.match(maybeChild, { onNone: () => notFoundView(model.context.locale, h), onSome: embed }),
})

const walletPage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'wallet.title', {}),
    model.maybeWallet,
    (wallet) =>
      h.submodel({
        slotId: 'wallet',
        model: wallet,
        view: walletView,
        viewInputs: { locale: model.context.locale },
        toParentMessage: (message) => Message.GotWalletMessage({ message }),
      }),
    h,
  )

const welcomePage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'welcome.title', {}),
    model.maybeWelcome,
    (welcome) =>
      h.submodel({
        slotId: 'welcome',
        model: welcome,
        view: welcomeView,
        viewInputs: { locale: model.context.locale },
        toParentMessage: (message) => Message.GotWelcomeMessage({ message }),
      }),
    h,
  )

const robotsPage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'addRobot.title', {}),
    model.maybeAddRobot,
    (robots) =>
      h.submodel({
        slotId: 'robots',
        model: robots,
        view: addRobotView,
        viewInputs: { locale: model.context.locale },
        toParentMessage: (message) => Message.GotAddRobotMessage({ message }),
      }),
    h,
  )

/** Pages that render clock times also get the page's time zone. */
const auditInputs = (model: Model) => ({ locale: model.context.locale, timeZone: model.context.timeZone })

const consolePage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'console.title', {}),
    model.maybeConsole,
    (robotConsole) =>
      h.submodel({
        slotId: 'robot-console',
        model: robotConsole,
        view: robotConsoleView,
        viewInputs: auditInputs(model),
        toParentMessage: (message) => Message.GotConsoleMessage({ message }),
      }),
    h,
  )

const approvalPage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'approval.title', {}),
    model.maybeApproval,
    (approval) =>
      h.submodel({
        slotId: 'approval',
        model: approval,
        view: Approval.view,
        viewInputs: { locale: model.context.locale },
        toParentMessage: (message) => Message.GotApprovalMessage({ message }),
      }),
    h,
  )

const episodesPage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'episodes.title', {}),
    model.maybeEpisodes,
    (episodes) =>
      h.submodel({
        slotId: 'episodes',
        model: episodes,
        view: Episodes.view,
        viewInputs: auditInputs(model),
        toParentMessage: (message) => Message.GotEpisodesMessage({ message }),
      }),
    h,
  )

const episodePage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'episodes.title', {}),
    model.maybeEpisode,
    (episode) =>
      h.submodel({
        slotId: 'episode',
        model: episode,
        view: episodeView,
        viewInputs: auditInputs(model),
        toParentMessage: (message) => Message.GotEpisodeMessage({ message }),
      }),
    h,
  )

const merchantPage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'merchant.pageTitle', {}),
    model.maybeMerchant,
    (merchant) =>
      h.submodel({
        slotId: 'merchant',
        model: merchant,
        view: Merchant.view,
        viewInputs: { locale: model.context.locale },
        toParentMessage: (message) => Message.GotMerchantMessage({ message }),
      }),
    h,
  )

const gatePage = (model: Model, h: HtmlBuilder<Message>): Page =>
  childPage(
    model,
    format(model.context.locale, 'gate.title', {}),
    model.maybeGate,
    (gate) =>
      h.submodel({
        slotId: 'gate',
        model: gate,
        view: Gate.view,
        viewInputs: { locale: model.context.locale },
        toParentMessage: (message) => Message.GotGateMessage({ message }),
      }),
    h,
  )

const pageOf = (model: Model, h: HtmlBuilder<Message>): Page => {
  const { locale } = model.context
  return AppRoute.match(model.route, {
    Home: () => ({ title: format(locale, 'landing.title', {}), body: homeView(model, h) }),
    NotFound: () => ({ title: format(locale, 'common.notFoundTitle', {}), body: notFoundView(locale, h) }),
    Wallet: () => walletPage(model, h),
    Welcome: () => welcomePage(model, h),
    Robots: () => robotsPage(model, h),
    RobotConsole: () => consolePage(model, h),
    Approval: () => approvalPage(model, h),
    Episodes: () => episodesPage(model, h),
    RobotEpisodes: () => episodesPage(model, h),
    Episode: () => episodePage(model, h),
    Merchant: () => merchantPage(model, h),
    Gate: () => gatePage(model, h),
  })
}

/** The owner's app: sign-in, the wallet, robots, approvals and payment records, in one phone-width column. */
const isOwnerRoute = (route: AppRoute): boolean =>
  AppRoute.match(route, {
    Home: () => true,
    Wallet: () => true,
    Welcome: () => true,
    Robots: () => true,
    RobotConsole: () => true,
    Approval: () => true,
    Episodes: () => true,
    RobotEpisodes: () => true,
    Episode: () => true,
    Merchant: () => false,
    Gate: () => false,
    NotFound: () => false,
  })

/** Without a session an owner page shows the passkey sign-in in its place; it reloads its data once signed in. */
const needsSignIn = (auth: AuthState): boolean =>
  AuthState.guards.SignedOut(auth) ||
  AuthState.guards.Refused(auth) ||
  AuthState.guards.CreatingWallet(auth) ||
  AuthState.guards.SigningIn(auth)

const ownerBody = (model: Model, page: Page, h: HtmlBuilder<Message>): Html => {
  if (AppRoute.guards.Home(model.route) || needsSignIn(model.auth)) return homeView(model, h)
  return AppRoute.guards.Wallet(model.route)
    ? h.div([h.Class('contents')], [walletTopBar(model, h), page.body])
    : page.body
}

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const { locale } = model.context
  const page = pageOf(model, h)
  const base = { title: `${page.title} | Vitaquack`, lang: locale, dir: 'Ltr' as const }
  if (isOwnerRoute(model.route)) {
    return { ...base, body: h.div([h.Class(appShellClassName)], [ownerBody(model, page, h)]) }
  }
  return {
    ...base,
    body: h.div(
      [h.Class('site')],
      [
        h.header(
          [h.Class('masthead')],
          [h.a([h.Href(walletRouter()), h.Class('brand')], ['Vitaquack']), wideNav(model, h)],
        ),
        page.body,
        h.footer(
          [],
          [
            h.span([], ['Vitaquack · ETHGlobal Mumbai 2026']),
            h.a([h.Href('https://github.com/grmkris/eth-global-mumbai-2026')], [format(locale, 'landing.contact', {})]),
          ],
        ),
      ],
    ),
  }
}
