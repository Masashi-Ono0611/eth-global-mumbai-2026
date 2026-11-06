import { format, type Locale } from '@ethmumbai/i18n'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { type ConsoleRobot, type Decision, type ErrandDetail, invoiceIdFrom, isZeroGDecision } from '../api/Robot.ts'
import { chainScan, storageScan } from '../api/Episodes.ts'
import { type Catalogue, explorerTx, usdc } from '../api/Wallet.ts'
import { ConsoleState, Errand, isLive, Message, type Model } from './RobotConsole.ts'
import { robotEpisodesRouter, robotsRouter } from '../route.ts'
import { failedView, signedOutView } from './Shared.ts'

// VIEW

const robotHeader = (view: ConsoleRobot, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('robot-header')],
    [
      h.p(
        [h.Class(view.lease.online ? 'online' : 'offline'), h.Role('status')],
        [format(locale, view.lease.online ? 'console.leaseOnline' : 'console.leaseOffline', {})],
      ),
      view.grant === null
        ? h.p([h.Class('hint')], [format(locale, 'console.noGrant', {})])
        : h.p(
            [],
            [
              format(locale, 'robots.grantTerms', {
                daily: usdc(view.grant.dailyCap),
                perPayment: usdc(view.grant.perPaymentCap),
                status: view.grant.status,
              }),
            ],
          ),
    ],
  )

/** Optional: the invoice the gate shows (its id or its payment URL); empty = the counter's open invoice for the item. */
const invoiceField = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('auth-form invoice-field')],
    [
      h.label([h.For('gate-invoice')], [format(locale, 'console.gateInvoice', {})]),
      h.input([
        h.Id('gate-invoice'),
        h.Type('text'),
        h.Value(model.invoiceInput),
        h.Placeholder(format(locale, 'console.gateInvoiceHint', {})),
        h.OnInput((value) => Message.UpdatedInvoiceInput({ value })),
      ]),
      model.invoiceInput.trim().length > 0 && invoiceIdFrom(model.invoiceInput) === null
        ? h.p([h.Role('alert'), h.Class('form-error')], [format(locale, 'console.gateInvoiceInvalid', {})])
        : h.empty,
    ],
  )

const itemButtons = (catalogue: Catalogue, busy: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('item-buttons')],
    catalogue.items.map((item) =>
      h.keyed('button')(
        item.itemId,
        [
          h.Type('button'),
          h.Class(item.restricted ? 'secondary-action restricted' : 'primary-action'),
          h.Disabled(busy),
          h.OnClick(Message.ClickedStartErrand({ item: item.itemId })),
        ],
        [format(locale, 'console.buy', { item: item.name, amount: usdc(item.amount) })],
      ),
    ),
  )

const decisionRow = (decision: Decision, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.keyed('li')(
    decision.id,
    [h.Class('decision')],
    [
      h.p(
        [],
        [
          format(locale, 'console.decision', {
            brain: format(
              locale,
              isZeroGDecision(decision.provider) ? 'console.brainZeroG' : 'console.brainRehearsal',
              {},
            ),
            action: decision.action,
            reason: decision.reason ?? '—',
          }),
        ],
      ),
      h.p(
        [h.Class('hint')],
        [
          format(locale, 'console.requestId', {
            requestId: decision.request_id ?? '—',
            model: decision.provider ?? decision.model,
            latency: decision.latency_ms ?? 0,
          }),
        ],
      ),
      decision.error === null ? h.empty : h.p([h.Class('form-error')], [decision.error]),
    ],
  )

const link = (href: string, label: string, h: HtmlBuilder<Message>): Html =>
  h.a([h.Href(href), h.Class('tx-link')], [label])

const errandDetailView = (detail: ErrandDetail, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('errand-detail')],
    [
      h.p(
        [h.Class(`state state-${detail.episode.state}`), h.Role('status')],
        [format(locale, 'console.errandState', { item: detail.episode.item, state: detail.episode.state })],
      ),
      detail.episode.result === null || detail.episode.state === 'paid'
        ? h.empty
        : h.p([h.Class('hint')], [format(locale, 'console.reason', { reason: detail.episode.result })]),
      h.ul(
        [h.Class('decision-list')],
        detail.decisions.map((decision) => decisionRow(decision, locale, h)),
      ),
      detail.chipRequest === null
        ? h.empty
        : h.p(
            [h.Class(`chip-state chip-${detail.chipRequest.status}`)],
            [
              format(locale, 'console.chipState', {
                status: detail.chipRequest.status,
                refusal: detail.chipRequest.refusal_code ?? '—',
              }),
            ],
          ),
      detail.payment === null || detail.payment.txHash === null
        ? h.empty
        : link(explorerTx(detail.payment.txHash), format(locale, 'console.paymentTx', {}), h),
      detail.evidence === null
        ? h.empty
        : h.div(
            [h.Class('evidence')],
            [
              h.p([], [format(locale, 'console.evidence', { status: detail.evidence.status })]),
              detail.evidence.rootHash === null
                ? h.empty
                : link(storageScan(detail.evidence.rootHash), format(locale, 'console.storage', {}), h),
              detail.evidence.logTx === null
                ? h.empty
                : link(chainScan(detail.evidence.logTx), format(locale, 'console.episodeLog', {}), h),
            ],
          ),
    ],
  )

const errandView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Errand.match(model.errand, {
    Idle: () => h.empty,
    Starting: ({ item }) => h.p([h.Role('status')], [format(locale, 'console.starting', { item })]),
    Refused: ({ error }) =>
      h.p([h.Role('alert'), h.Class('form-error')], [format(locale, 'common.errorDetail', { message: error })]),
    Running: ({ maybeDetail, maybeApprovalUrl }) =>
      h.section(
        [h.Class('errand')],
        [
          Option.match(maybeApprovalUrl, {
            onNone: () => h.empty,
            onSome: (url) =>
              h.a([h.Href(url), h.Class('primary-action')], [format(locale, 'console.openApproval', {})]),
          }),
          Option.match(maybeDetail, {
            onNone: () => h.p([h.Role('status')], [format(locale, 'common.loading', {})]),
            onSome: (detail) => errandDetailView(detail, locale, h),
          }),
        ],
      ),
  })

/** `/robot/:id`: lease, grant, "buy" buttons, the errand's decisions (with 0G request ids), payment and evidence. */
export const robotConsoleView = Submodel.defineView<Model, Message, { readonly locale: Locale }>(
  (model, { locale }, h) =>
    h.main(
      [h.Id('main'), h.Class('owner-page')],
      ConsoleState.match(model.state, {
        Loading: () => [h.p([h.Role('status')], [format(locale, 'common.loading', {})])],
        SignedOut: () => [signedOutView(locale, h)],
        Failed: ({ error }) => [failedView(error, Message.ClickedRefresh(), locale, h)],
        Loaded: ({ robot, catalogue }) => [
          h.h1([], [robot.robot.name]),
          robotHeader(robot, locale, h),
          invoiceField(model, locale, h),
          itemButtons(catalogue, isLive(model.errand) || robot.grant === null, locale, h),
          errandView(model, locale, h),
          h.button(
            [h.Type('button'), h.Class('secondary-action'), h.OnClick(Message.ClickedRefresh())],
            [format(locale, 'common.refresh', {})],
          ),
          h.a([h.Href(robotsRouter()), h.Class('secondary-action')], [format(locale, 'robots.title', {})]),
          h.a(
            [h.Href(robotEpisodesRouter({ robotId: model.robotId })), h.Class('secondary-action')],
            [format(locale, 'episodes.title', {})],
          ),
        ],
      }),
    ),
)
