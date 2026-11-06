import { format, type Locale } from '@ethmumbai/i18n'
import { Effect, Schema } from 'effect'
import { Command, Submodel, type Update } from 'foldkit'
import type * as HttpClient from 'effect/http/HttpClient'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { isSignedOut } from '../api/Http.ts'
import { robotsRouter } from '../route.ts'
import { failedView, signedOutView } from './Shared.ts'
import {
  ActivityView,
  type EpisodeActivity,
  explorerAddress,
  explorerTx,
  loadActivity,
  loadWallet,
  usdc,
  WalletView,
} from '../api/Wallet.ts'

// MODEL

const WalletState = defineTaggedUnion({
  Loading: {},
  SignedOut: {},
  Loaded: { wallet: WalletView, activity: ActivityView },
  Failed: { error: Schema.String },
})
export const Model = Schema.Struct({ state: WalletState })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadWallet: { wallet: WalletView, activity: ActivityView },
  FailedLoadWallet: { error: Schema.String, signedOut: Schema.Boolean },
  ClickedReload: {},
})
export type Message = typeof Message.Type

// COMMAND

export const LoadWallet = Command.define('LoadWallet', {
  messages: [Message.SucceededLoadWallet, Message.FailedLoadWallet],
  execute: Effect.all([loadWallet, loadActivity], { concurrency: 2 }).pipe(
    Effect.map(([wallet, activity]) => Message.SucceededLoadWallet({ wallet, activity })),
    Effect.catch((failure) =>
      Effect.succeed(Message.FailedLoadWallet({ error: failure.error, signedOut: isSignedOut(failure) })),
    ),
  ),
})

// INIT

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient>

export const init = (): UpdateReturn => ({
  model: { state: WalletState.Loading() },
  commands: [LoadWallet()],
})

// UPDATE

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadWallet: ({ wallet, activity }) => ({
      model: modifyFields(model, { state: () => WalletState.Loaded({ wallet, activity }) }),
    }),
    FailedLoadWallet: ({ error, signedOut }) => ({
      model: modifyFields(model, {
        state: () => (signedOut ? WalletState.SignedOut() : WalletState.Failed({ error })),
      }),
    }),
    ClickedReload: () => ({
      model: modifyFields(model, { state: () => WalletState.Loading() }),
      commands: [LoadWallet()],
    }),
  })

// VIEW

const episodeRow = (episode: EpisodeActivity, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    episode.id,
    [h.Class('activity-row')],
    [
      h.span([h.Class('activity-what')], [`${episode.robotName} · ${episode.item}`]),
      h.span([h.Class(`state state-${episode.state}`)], [format(locale, 'robot.state', { state: episode.state })]),
      episode.amount === null ? h.empty : h.span([], [`${usdc(episode.amount)} USDC`]),
      episode.txHash === null
        ? h.empty
        : h.a([h.Href(explorerTx(episode.txHash)), h.Class('tx-link')], [format(locale, 'wallet.viewTx', {})]),
    ],
  )

const loadedView = (wallet: WalletView, activity: ActivityView, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('wallet-page')],
    [
      h.section(
        [h.Class('wallet-card')],
        [
          h.p([], [format(locale, 'wallet.signedInAs', { name: wallet.account.displayName })]),
          h.h2([], [format(locale, 'wallet.balance', {})]),
          h.p(
            [h.Class('balance')],
            [wallet.balance === null ? format(locale, 'wallet.balanceUnknown', {}) : `${wallet.balance.usdc} USDC`],
          ),
          h.h2([], [format(locale, 'wallet.address', {})]),
          h.a(
            [h.Href(explorerAddress(wallet.account.smartAccount)), h.Class('smart-account')],
            [wallet.account.smartAccount],
          ),
          h.p(
            [h.Class('hint')],
            [format(locale, wallet.account.deployStatus === 'deployed' ? 'wallet.deployed' : 'wallet.addressNote', {})],
          ),
          h.h2([], [format(locale, 'wallet.fundTitle', {})]),
          h.p([], [format(locale, 'wallet.fundInstructions', {})]),
          h.a([h.Href(robotsRouter()), h.Class('primary-action')], [format(locale, 'robots.title', {})]),
        ],
      ),
      h.section(
        [h.Class('activity')],
        [
          h.h2([], [format(locale, 'wallet.activity', {})]),
          activity.episodes.length === 0
            ? h.p([h.Class('empty-state')], [format(locale, 'wallet.noActivity', {})])
            : h.ul(
                [h.Class('activity-list')],
                activity.episodes.map((episode) => episodeRow(episode, locale, h)),
              ),
          h.button(
            [h.Type('button'), h.Class('secondary-action'), h.OnClick(Message.ClickedReload())],
            [format(locale, 'common.refresh', {})],
          ),
        ],
      ),
    ],
  )

/** `/wallet`: balance, fund instructions and activity. */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), h.Class('owner-page')],
    [
      h.h1([], [format(locale, 'wallet.title', {})]),
      WalletState.match(model.state, {
        Loading: () => h.p([h.Role('status')], [format(locale, 'common.loading', {})]),
        SignedOut: () => signedOutView(locale, h),
        Loaded: ({ wallet, activity }) => loadedView(wallet, activity, locale, h),
        Failed: ({ error }) => failedView(error, Message.ClickedReload(), locale, h),
      }),
    ],
  ),
)
