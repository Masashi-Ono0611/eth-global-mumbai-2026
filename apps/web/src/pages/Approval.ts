import { format, type Locale } from '@ethmumbai/i18n'
import { Effect, Schema } from 'effect'
import { Command, Submodel, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import type * as HttpClient from 'effect/http/HttpClient'
import { getJson, isSignedOut, postJson } from '../api/Http.ts'
import { loadErrand, terminalStates, worldAuthorizeUrl } from '../api/Robot.ts'
import { explorerTx, usdc } from '../api/Wallet.ts'
import { robotConsoleRouter } from '../route.ts'
import { failedView, loadingView, signedOutView } from './Shared.ts'
import { duck } from '../Duck.ts'

// MODEL

const ApprovalView = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  error: Schema.NullOr(Schema.String),
  item: Schema.NullOr(Schema.String),
  robotName: Schema.NullOr(Schema.String),
  robotId: Schema.String,
  episodeId: Schema.String,
  invoiceId: Schema.String,
  payee: Schema.String,
  amount: Schema.String,
  closesAt: Schema.Number,
  /** Why it needs the owner: a restricted item, over the per-payment cap (and the cap), or a payee off the allowlist. */
  reasons: Schema.Struct({
    restricted: Schema.Boolean,
    overCap: Schema.Boolean,
    offList: Schema.Boolean,
    perPaymentCap: Schema.NullOr(Schema.String),
  }),
  worldConfigured: Schema.Boolean,
})
type ApprovalView = typeof ApprovalView.Type

type Why = 'restricted' | 'overCap' | 'offList' | 'other'
/** The page names the strongest reason: a restricted item, then an amount over the limit, then an unknown payee. */
const whyOf = ({ reasons }: ApprovalView): Why => {
  if (reasons.restricted) return 'restricted'
  if (reasons.overCap) return 'overCap'
  return reasons.offList ? 'offList' : 'other'
}

const ApprovalState = defineTaggedUnion({
  Loading: {},
  SignedOut: {},
  Loaded: { approval: ApprovalView },
  Failed: { error: Schema.String },
})
const Denial = defineTaggedUnion({ Idle: {}, Denying: {}, Failed: { error: Schema.String } })
const ErrandEnd = { state: Schema.String, txHash: Schema.NullOr(Schema.String), reason: Schema.NullOr(Schema.String) }
/** Once the approval is answered, the page follows its errand to the end (paid, denied or the failure). */
const Follow = defineTaggedUnion({
  Idle: {},
  Following: { attempts: Schema.Number, robotId: Schema.String, episodeId: Schema.String },
  Ended: ErrandEnd,
  GaveUp: {},
})
export const Model = Schema.Struct({ approvalId: Schema.String, state: ApprovalState, denial: Denial, follow: Follow })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadApproval: { approval: ApprovalView },
  FailedLoadApproval: { error: Schema.String, signedOut: Schema.Boolean },
  ClickedDeny: {},
  SucceededDenyApproval: {},
  FailedDenyApproval: { error: Schema.String },
  ClickedReload: {},
  FollowedErrand: ErrandEnd,
  FailedFollowErrand: {},
})
export type Message = typeof Message.Type

// COMMAND

const answerable = (status: string) => status === 'requested' || status === 'opened'
const POLL_MILLIS = 3000
/** The errand is read every 2 s for up to 2 minutes after the answer. */
const FOLLOW_MILLIS = 2000
const FOLLOW_ATTEMPTS = 60

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

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const FollowErrand = Command.define('FollowErrand', {
  args: { robotId: Schema.String, episodeId: Schema.String, delayMillis: Schema.Number },
  messages: [Message.FollowedErrand, Message.FailedFollowErrand],
  execute: ({ robotId, episodeId, delayMillis }) =>
    Effect.sleep(delayMillis).pipe(
      Effect.andThen(loadErrand(robotId, episodeId)),
      Effect.map(({ episode, payment }) =>
        Message.FollowedErrand({ state: episode.state, txHash: payment?.txHash ?? null, reason: episode.result }),
      ),
      Effect.catch(() => Effect.succeed(Message.FailedFollowErrand())),
    ),
})

// INIT

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient>

export const init = (approvalId: string): UpdateReturn => ({
  model: { approvalId, state: ApprovalState.Loading(), denial: Denial.Idle(), follow: Follow.Idle() },
  commands: [LoadApproval({ approvalId, delayMillis: 0 })],
})

// UPDATE

const startFollowing = (model: Model, approval: ApprovalView): UpdateReturn => ({
  model: modifyFields(model, {
    follow: () => Follow.Following({ attempts: 0, robotId: approval.robotId, episodeId: approval.episodeId }),
  }),
  commands: [FollowErrand({ robotId: approval.robotId, episodeId: approval.episodeId, delayMillis: 0 })],
})

/** Another read in 2 s while the errand runs; after 2 minutes the page stops and points at the console. */
const followAgain = (model: Model): UpdateReturn => {
  if (!Follow.guards.Following(model.follow)) return { model }
  const { attempts, robotId, episodeId } = model.follow
  return attempts + 1 >= FOLLOW_ATTEMPTS
    ? { model: modifyFields(model, { follow: () => Follow.GaveUp() }) }
    : {
        model: modifyFields(model, { follow: () => Follow.Following({ attempts: attempts + 1, robotId, episodeId }) }),
        commands: [FollowErrand({ robotId, episodeId, delayMillis: FOLLOW_MILLIS })],
      }
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadApproval: ({ approval }) => {
      const loaded = modifyFields(model, { state: () => ApprovalState.Loaded({ approval }) })
      if (answerable(approval.status))
        return { model: loaded, commands: [LoadApproval({ approvalId: model.approvalId, delayMillis: POLL_MILLIS })] }
      return Follow.guards.Idle(model.follow) ? startFollowing(loaded, approval) : { model: loaded }
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
      model: modifyFields(model, {
        state: () => ApprovalState.Loading(),
        follow: (follow) => (Follow.guards.GaveUp(follow) ? Follow.Idle() : follow),
      }),
      commands: [LoadApproval({ approvalId: model.approvalId, delayMillis: 0 })],
    }),
    FollowedErrand: ({ state, txHash, reason }) =>
      terminalStates.has(state)
        ? { model: modifyFields(model, { follow: () => Follow.Ended({ state, txHash, reason }) }) }
        : followAgain(model),
    FailedFollowErrand: () => followAgain(model),
  })

// VIEW

/** World IdP's sign-in for this approval: a full navigation, so the browser follows the 302 to World. */

// STYLES

const mainClassName = 'grid gap-4 px-1 pt-4 pb-8'
const backClassName =
  'inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-full bg-surface px-3.5 font-semibold no-underline transition-transform active:scale-[0.96]'
const cardClassName = 'grid gap-3 rounded-[24px_24px_24px_8px] bg-duck px-4 pt-4 pb-4'
const whoClassName = 'flex items-center gap-2.5'
const faceClassName = 'grid size-12 shrink-0 place-items-center rounded-full bg-ink'
const titleClassName = 'font-display text-[1.7rem] leading-tight font-bold text-balance'
const amountClassName = 'font-display text-5xl leading-none font-extrabold tracking-[-0.02em]'
const unitClassName = 'ml-1.5 text-lg font-bold tracking-normal'
const whyClassName = 'text-[1.02rem] leading-snug'
const detailsClassName =
  'rounded-card bg-surface px-4 text-[0.95rem] [&_dd]:mb-2 [&_dd]:break-all [&_dt]:text-muted [&_summary]:min-h-11 [&_summary]:cursor-pointer [&_summary]:py-3 [&_summary]:font-semibold'
const actionsClassName = 'grid grid-cols-[1fr_auto] gap-2'
const approveClassName =
  'inline-flex min-h-12 items-center justify-center rounded-control bg-black px-3 font-semibold text-surface no-underline transition-transform active:scale-[0.96]'
const denyClassName =
  'min-h-12 cursor-pointer rounded-control bg-surface px-6 font-semibold transition-transform active:scale-[0.96] disabled:opacity-60'
const statusClassName = 'rounded-card bg-surface px-4 py-3 font-semibold'
const hintClassName = 'mt-1 block text-[0.92rem] font-normal text-muted'
const arcLinkClassName = 'font-semibold text-paid'

// VIEW

const actions = (model: Model, approval: ApprovalView, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const denying = Denial.guards.Denying(model.denial)
  return h.div(
    [h.Class(actionsClassName)],
    [
      approval.worldConfigured
        ? h.a([h.Href(worldAuthorizeUrl(approval.id)), h.Class(approveClassName)], [format(locale, 'home.approve', {})])
        : h.p([h.Role('alert')], [format(locale, 'approval.notConfigured', {})]),
      h.button(
        [h.Type('button'), h.Class(denyClassName), h.Disabled(denying), h.OnClick(Message.ClickedDeny())],
        [format(locale, denying ? 'home.declining' : 'home.decline', {})],
      ),
      Denial.guards.Failed(model.denial)
        ? h.p([h.Role('alert')], [format(locale, 'common.errorDetail', { message: model.denial.error })])
        : h.empty,
    ],
  )
}

/** The answer's status, replaced by the errand's end once it has one: paid (with the Arc link), denied or why not. */
const statusLine = (model: Model, approval: ApprovalView, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const answered = h.p([h.Role('status')], [format(locale, 'approval.status', { status: approval.status })])
  const hint = (text: string | null) => (text === null ? h.empty : h.span([h.Class(hintClassName)], [text]))
  return Follow.match(model.follow, {
    Idle: () => h.div([h.Class(statusClassName)], [answered, hint(approval.error)]),
    Following: () =>
      h.div(
        [h.Class(statusClassName)],
        [answered, hint(approval.error), hint(format(locale, 'approval.following', {}))],
      ),
    GaveUp: () =>
      h.div(
        [h.Class(statusClassName)],
        [answered, hint(approval.error), hint(format(locale, 'approval.followStopped', {}))],
      ),
    Ended: ({ state, txHash, reason }) =>
      h.div(
        [h.Class(statusClassName)],
        [
          state === 'paid'
            ? h.p(
                [h.Role('status')],
                [
                  `${format(locale, 'approval.paid', {})} · `,
                  txHash === null
                    ? h.empty
                    : h.a(
                        [h.Href(explorerTx(txHash)), h.Class(arcLinkClassName)],
                        [format(locale, 'approval.viewOnArc', {})],
                      ),
                ],
              )
            : h.p(
                [h.Role('status')],
                [
                  state === 'denied'
                    ? format(locale, 'approval.status', { status: 'denied' })
                    : format(locale, 'approval.errandEnded', { state }),
                ],
              ),
          state === 'paid' ? h.empty : hint(reason ?? approval.error),
        ],
      ),
  })
}

const approvalView = (model: Model, approval: ApprovalView, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const robot = approval.robotName ?? format(locale, 'approval.yourRobot', {})
  return h.div(
    [h.Class('contents')],
    [
      h.a(
        [h.Href(robotConsoleRouter({ robotId: approval.robotId })), h.Class(backClassName)],
        [h.span([h.AriaHidden(true)], ['‹']), format(locale, 'approval.back', { robot })],
      ),
      h.section(
        [h.Class(cardClassName)],
        [
          h.div(
            [h.Class(whoClassName)],
            [
              h.span([h.Class(faceClassName)], [duck('size-9', false, h)]),
              h.h2(
                [h.Class(titleClassName)],
                [format(locale, 'approval.wants', { robot, item: approval.item ?? '—' })],
              ),
            ],
          ),
          h.p([h.Class(amountClassName)], [usdc(approval.amount), h.span([h.Class(unitClassName)], ['USDC'])]),
          h.p(
            [h.Class(whyClassName)],
            [
              format(locale, 'approval.explainer', {
                why: whyOf(approval),
                amount: usdc(approval.amount),
                cap: approval.reasons.perPaymentCap === null ? '—' : usdc(approval.reasons.perPaymentCap),
              }),
            ],
          ),
          answerable(approval.status) ? actions(model, approval, locale, h) : h.empty,
        ],
      ),
      statusLine(model, approval, locale, h),
      h.details(
        [h.Class(detailsClassName)],
        [
          h.summary([], [format(locale, 'approval.details', {})]),
          h.dl(
            [],
            [
              h.dt([], [format(locale, 'approval.payee', {})]),
              h.dd([], [approval.payee]),
              h.dt([], [format(locale, 'approval.invoice', {})]),
              h.dd([], [approval.invoiceId]),
            ],
          ),
        ],
      ),
    ],
  )
}

/** `/wallet/approvals/:id` (World's callback lands here): a restricted item, a payment over the per-payment limit or
 * to an unknown payee, answered once in World App (spec §9). */
export const view = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), h.Class(mainClassName)],
    [
      ApprovalState.guards.Loaded(model.state)
        ? h.h1([h.Class('sr-only')], [format(locale, 'approval.heading', { why: whyOf(model.state.approval) })])
        : h.h1([h.Class(titleClassName)], [format(locale, 'approval.title', {})]),
      ApprovalState.match(model.state, {
        Loading: () => loadingView(locale, h),
        SignedOut: () => signedOutView(locale, h),
        Failed: ({ error }) => failedView(error, Message.ClickedReload(), locale, h),
        Loaded: ({ approval }) => approvalView(model, approval, locale, h),
      }),
    ],
  ),
)
