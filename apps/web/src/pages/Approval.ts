import { format, type Locale } from '@ethmumbai/i18n'
import { Effect, Schema } from 'effect'
import { Command, Submodel, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import type * as HttpClient from 'effect/http/HttpClient'
import { getJson, isSignedOut, postJson } from '../api/Http.ts'
import { usdc } from '../api/Wallet.ts'
import { robotConsoleRouter } from '../route.ts'
import { failedView, loadingView, ownerMain, signedOutView } from './Shared.ts'

// MODEL

const ApprovalView = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  error: Schema.NullOr(Schema.String),
  item: Schema.NullOr(Schema.String),
  robotName: Schema.NullOr(Schema.String),
  robotId: Schema.String,
  invoiceId: Schema.String,
  payee: Schema.String,
  amount: Schema.String,
  closesAt: Schema.Number,
  worldConfigured: Schema.Boolean,
})
type ApprovalView = typeof ApprovalView.Type

const ApprovalState = defineTaggedUnion({
  Loading: {},
  SignedOut: {},
  Loaded: { approval: ApprovalView },
  Failed: { error: Schema.String },
})
const Denial = defineTaggedUnion({ Idle: {}, Denying: {}, Failed: { error: Schema.String } })
export const Model = Schema.Struct({ approvalId: Schema.String, state: ApprovalState, denial: Denial })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadApproval: { approval: ApprovalView },
  FailedLoadApproval: { error: Schema.String, signedOut: Schema.Boolean },
  ClickedDeny: {},
  SucceededDenyApproval: {},
  FailedDenyApproval: { error: Schema.String },
  ClickedReload: {},
})
export type Message = typeof Message.Type

// COMMAND

const answerable = (status: string) => status === 'requested' || status === 'opened'
const POLL_MILLIS = 3000

/**
 * Reads the approval after `delayMillis` (the page re-reads while it can still be answered).
 * @internal Exported for the scene tests; the page update is its only production caller.
 */
export const LoadApproval = Command.define('LoadApproval', {
  args: { approvalId: Schema.String, delayMillis: Schema.Number },
  messages: [Message.SucceededLoadApproval, Message.FailedLoadApproval],
  execute: ({ approvalId, delayMillis }) =>
    Effect.sleep(delayMillis).pipe(
      Effect.andThen(getJson(`/api/approvals/${approvalId}`, ApprovalView)),
      Effect.map((approval) => Message.SucceededLoadApproval({ approval })),
      Effect.catch((failure) =>
        Effect.succeed(Message.FailedLoadApproval({ error: failure.error, signedOut: isSignedOut(failure) })),
      ),
    ),
})

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const DenyApproval = Command.define('DenyApproval', {
  args: { approvalId: Schema.String },
  messages: [Message.SucceededDenyApproval, Message.FailedDenyApproval],
  execute: ({ approvalId }) =>
    postJson(`/api/approvals/${approvalId}/deny`, {}, Schema.Struct({ status: Schema.String })).pipe(
      Effect.as(Message.SucceededDenyApproval()),
      Effect.catch((failure) => Effect.succeed(Message.FailedDenyApproval({ error: failure.error }))),
    ),
})

// INIT

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient>

export const init = (approvalId: string): UpdateReturn => ({
  model: { approvalId, state: ApprovalState.Loading(), denial: Denial.Idle() },
  commands: [LoadApproval({ approvalId, delayMillis: 0 })],
})

// UPDATE

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadApproval: ({ approval }) => {
      const loaded = modifyFields(model, { state: () => ApprovalState.Loaded({ approval }) })
      return answerable(approval.status)
        ? { model: loaded, commands: [LoadApproval({ approvalId: model.approvalId, delayMillis: POLL_MILLIS })] }
        : { model: loaded }
    },
    FailedLoadApproval: ({ error, signedOut }) => ({
      model: modifyFields(model, {
        state: () => (signedOut ? ApprovalState.SignedOut() : ApprovalState.Failed({ error })),
      }),
    }),
    ClickedDeny: () =>
      Denial.guards.Denying(model.denial)
        ? { model }
        : {
            model: modifyFields(model, { denial: () => Denial.Denying() }),
            commands: [DenyApproval({ approvalId: model.approvalId })],
          },
    SucceededDenyApproval: () => ({
      model: modifyFields(model, { denial: () => Denial.Idle() }),
      commands: [LoadApproval({ approvalId: model.approvalId, delayMillis: 0 })],
    }),
    FailedDenyApproval: ({ error }) => ({ model: modifyFields(model, { denial: () => Denial.Failed({ error }) }) }),
    ClickedReload: () => ({
      model: modifyFields(model, { state: () => ApprovalState.Loading() }),
      commands: [LoadApproval({ approvalId: model.approvalId, delayMillis: 0 })],
    }),
  })

// VIEW

/** World IdP's sign-in for this approval: a full navigation, so the browser follows the 302 to World. */
const worldAuthorizeUrl = (approvalId: string) => `/api/world/authorize?approval=${encodeURIComponent(approvalId)}`

const actions = (model: Model, approval: ApprovalView, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const denying = Denial.guards.Denying(model.denial)
  return h.div(
    [h.Class('approval-actions')],
    [
      approval.worldConfigured
        ? h.a(
            [h.Href(worldAuthorizeUrl(approval.id)), h.Class('primary-action')],
            [format(locale, 'approval.approveWithWorld', {})],
          )
        : h.p([h.Role('alert')], [format(locale, 'approval.notConfigured', {})]),
      h.button(
        [h.Type('button'), h.Class('secondary-action'), h.Disabled(denying), h.OnClick(Message.ClickedDeny())],
        [format(locale, 'approval.deny', {})],
      ),
      Denial.guards.Failed(model.denial)
        ? h.p([h.Role('alert')], [format(locale, 'common.errorDetail', { message: model.denial.error })])
        : h.empty,
    ],
  )
}

const approvalView = (model: Model, approval: ApprovalView, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('approval')],
    [
      h.p([h.Class('lead')], [format(locale, 'approval.explainer', {})]),
      h.dl(
        [],
        [
          h.dt([], [format(locale, 'approval.item', {})]),
          h.dd([], [`${approval.item ?? '—'} · ${approval.robotName ?? '—'}`]),
          h.dt([], [format(locale, 'approval.amount', {})]),
          h.dd([], [`${usdc(approval.amount)} USDC`]),
          h.dt([], [format(locale, 'approval.payee', {})]),
          h.dd([h.Class('chip-address')], [approval.payee]),
          h.dt([], [format(locale, 'approval.invoice', {})]),
          h.dd([], [approval.invoiceId]),
        ],
      ),
      h.p([h.Role('status')], [format(locale, 'approval.status', { status: approval.status })]),
      approval.error === null ? h.empty : h.p([h.Class('hint')], [approval.error]),
      answerable(approval.status) ? actions(model, approval, locale, h) : h.empty,
      h.a(
        [h.Href(robotConsoleRouter({ robotId: approval.robotId })), h.Class('secondary-action')],
        [format(locale, 'robots.openConsole', {})],
      ),
    ],
  )

/** `/wallet/approvals/:id`: approval for a restricted or over-limit item, answered once in World App (spec §9). */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  ownerMain(
    format(locale, 'approval.title', {}),
    ApprovalState.match(model.state, {
      Loading: () => loadingView(locale, h),
      SignedOut: () => signedOutView(locale, h),
      Failed: ({ error }) => failedView(error, Message.ClickedReload(), locale, h),
      Loaded: ({ approval }) => approvalView(model, approval, locale, h),
    }),
    h,
  ),
)
