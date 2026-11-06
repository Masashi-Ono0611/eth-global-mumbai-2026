import { format, type Locale } from '@ethmumbai/i18n'
import { clsx } from 'clsx'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import {
  type AuditDecision,
  chainScan,
  clockTime,
  type EpisodeAudit,
  type ReplayResult,
  storageScan,
  type VerifyResult,
} from '../api/Episodes.ts'
import { isZeroGDecision, terminalStates } from '../api/Robot.ts'
import { explorerTx } from '../api/Wallet.ts'
import { episodesRouter, proofRouter, robotConsoleRouter, walletRouter } from '../route.ts'
import { AuditState, Message, type Model, Replay, Verify } from './Episode.ts'
import { observationCard } from './ObservationCard.ts'
import { teeView } from './TeeBadge.ts'
import { failedView, loadingView, signedOutView } from './Shared.ts'
import {
  alertLine,
  alertTextClassName,
  auditButtonClassName,
  auditLayoutClassName,
  backClassName,
  card,
  checkListClassName,
  fields,
  inputDetailsClassName,
  link,
  mutedClassName,
  none,
  replayBoxClassName,
  stackClassName,
  timelineListClassName,
  titleClassName,
} from './EpisodeParts.ts'
import type { Inputs } from './EpisodeParts.ts'
import { busyLabel } from '../Busy.ts'

const stateRowClassName = 'flex flex-wrap items-center gap-x-2 gap-y-1'
const statePillClassName = 'inline-flex min-h-8 items-center rounded-full px-3 text-[0.9rem] font-semibold'

const brainOf = (provider: string | null, locale: Locale) =>
  format(locale, isZeroGDecision(provider) ? 'console.brainZeroG' : 'console.brainRehearsal', {})

/** The exact structured input the brain received, pretty-printed (it is JSON the server stored verbatim). */
const prettyInput = (inputJson: string) => {
  try {
    return JSON.stringify(JSON.parse(inputJson), null, 2)
  } catch {
    return inputJson
  }
}

const replayView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  Replay.match(model.replay, {
    Idle: () => h.empty,
    Running: () => h.p([h.Role('status')], [format(locale, 'episode.action', { action: 'replaying' })]),
    Failed: ({ error }) => alertLine(error, locale, h),
    Done: ({ result }) => replayResultView(result, locale, h),
  })

const replayResultView = (result: ReplayResult, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const { replay } = result
  return h.div(
    [h.Class(replayBoxClassName)],
    [
      replay.ok
        ? h.p(
            [h.Role('status')],
            [
              format(locale, 'episode.replayResult', {
                brain: brainOf(replay.provider, locale),
                action: replay.action,
                reason: replay.reason,
              }),
            ],
          )
        : h.p(
            [h.Role('alert'), h.Class(alertTextClassName)],
            [format(locale, 'common.errorDetail', { message: replay.error })],
          ),
      replay.ok
        ? fields(
            [
              ['requestId', replay.requestId],
              ['brain', replay.provider],
              ['latency', `${replay.latencyMs} ms`],
            ],
            locale,
            h,
          )
        : h.empty,
      replay.ok
        ? h.p([h.Class(mutedClassName)], [format(locale, 'episode.replaySame', { same: result.same ? 'yes' : 'no' })])
        : h.empty,
    ],
  )
}

const decisionView = (model: Model, decision: AuditDecision, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  return h.div(
    [h.Class(stackClassName)],
    [
      h.p(
        [],
        [
          format(locale, 'console.decision', {
            brain: brainOf(decision.provider, locale),
            action: decision.action,
            reason: decision.reason ?? decision.error ?? '—',
          }),
        ],
      ),
      fields(
        [
          ['requestId', decision.request_id],
          ['brain', decision.provider],
          ['latency', decision.latency_ms === null ? null : `${decision.latency_ms} ms`],
          ['promptHash', decision.prompt_sha256],
          ['outcome', decision.outcome],
          ['error', decision.error],
        ],
        locale,
        h,
      ),
      decision.input_json === null
        ? h.empty
        : h.details(
            [h.Class(inputDetailsClassName)],
            [h.summary([], [format(locale, 'episode.input', {})]), h.pre([], [prettyInput(decision.input_json)])],
          ),
      teeView(model, decision, inputs, h),
    ],
  )
}

const decisionCard = (model: Model, audit: EpisodeAudit, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  return card(
    'decision',
    locale,
    [
      ...(audit.decisions.length === 0
        ? [none('decision', locale, h)]
        : audit.decisions.map((decision) => decisionView(model, decision, inputs, h))),
      audit.decisions.length === 0
        ? h.empty
        : h.button(
            [
              h.Type('button'),
              h.Class(auditButtonClassName),
              h.Disabled(Replay.guards.Running(model.replay)),
              h.OnClick(Message.ClickedReplay()),
            ],
            busyLabel(Replay.guards.Running(model.replay), format(locale, 'episode.action', { action: 'replay' }), h),
          ),
      h.p([h.Class(mutedClassName)], [format(locale, 'episode.replayNote', {})]),
      replayView(model, locale, h),
    ],
    h,
  )
}

/** Once the errand has ended, a request still queued was never picked up, and one still delivered when the errand timed
 *  out never got an answer: say that, not that the chip is still waiting or signing. */
const chipStatus = (status: string, episodeState: string) =>
  !terminalStates.has(episodeState)
    ? status
    : status === 'queued'
      ? 'unclaimed'
      : status === 'delivered' && episodeState === 'expired'
        ? 'expired'
        : status

const chipCard = (audit: EpisodeAudit, locale: Locale, h: HtmlBuilder<Message>): Html =>
  card(
    'chip',
    locale,
    audit.chipRequests.length === 0
      ? [none('chip', locale, h)]
      : audit.chipRequests.map((request) =>
          h.div(
            [],
            [
              h.p(
                [],
                [
                  format(locale, 'console.chipState', {
                    status: chipStatus(request.status, audit.episode.state),
                    refusal: request.refusal_code ?? '—',
                  }),
                ],
              ),
              fields([['leafHash', request.leaf_hash]], locale, h),
            ],
          ),
        ),
    h,
  )

const paymentCard = (audit: EpisodeAudit, locale: Locale, h: HtmlBuilder<Message>): Html =>
  card(
    'payment',
    locale,
    audit.payments.length === 0
      ? [none('payment', locale, h)]
      : audit.payments.map((payment) =>
          h.div(
            [],
            [
              fields(
                [
                  ['status', payment.status],
                  ['reason', payment.fail_reason],
                  ['gas', payment.gas_used],
                  ['payer', payment.payer],
                ],
                locale,
                h,
              ),
              payment.tx_hash === null
                ? h.empty
                : link(explorerTx(payment.tx_hash), format(locale, 'console.paymentTx', {}), h),
            ],
          ),
        ),
    h,
  )

const approvalCard = (audit: EpisodeAudit, locale: Locale, h: HtmlBuilder<Message>): Html =>
  card(
    'approval',
    locale,
    audit.approvals.length === 0
      ? [none('approval', locale, h)]
      : audit.approvals.map((approval) =>
          h.div(
            [],
            [
              h.p([], [format(locale, 'approval.status', { status: approval.status })]),
              fields(
                [
                  ['reason', approval.error],
                  ['acr', approval.world?.acr ?? null],
                  ['amr', approval.world === null ? null : approval.world.amr.join(', ')],
                ],
                locale,
                h,
              ),
            ],
          ),
        ),
    h,
  )

const MATCHED: ReadonlyArray<'rootHash' | 'requestIdsHash'> = ['rootHash', 'requestIdsHash']

const verifyResultView = (result: VerifyResult, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class(stackClassName)],
    [
      result.onChain === null
        ? h.p([h.Role('status')], [format(locale, 'episode.notOnChain', {})])
        : h.ul(
            [h.Role('status'), h.Class(checkListClassName)],
            MATCHED.map((field) =>
              h.li(
                [h.DataAttribute('match', result.matches[field] ? 'yes' : 'no')],
                [format(locale, 'episode.verifyMatch', { field, matches: result.matches[field] ? 'yes' : 'no' })],
              ),
            ),
          ),
      result.onChain === null
        ? h.empty
        : fields(
            [
              ['recorder', result.onChain.recorder],
              ['recordedAt', String(result.onChain.recordedAt)],
            ],
            locale,
            h,
          ),
      result.links.storagescan === null
        ? h.empty
        : link(result.links.storagescan, format(locale, 'console.storage', {}), h),
      result.links.chainscan === null
        ? h.empty
        : link(result.links.chainscan, format(locale, 'console.episodeLog', {}), h),
    ],
  )

const evidenceCard = (model: Model, audit: EpisodeAudit, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const { evidence } = audit
  return card(
    'evidence',
    locale,
    evidence === null
      ? [none('evidence', locale, h)]
      : [
          fields(
            [
              ['status', evidence.status],
              ['rootHash', evidence.root_hash],
              ['requestIdsHash', evidence.request_ids_hash],
              ['error', evidence.error],
            ],
            locale,
            h,
          ),
          evidence.root_hash === null
            ? h.empty
            : link(storageScan(evidence.root_hash), format(locale, 'console.storage', {}), h),
          evidence.log_tx === null
            ? h.empty
            : link(chainScan(evidence.log_tx), format(locale, 'console.episodeLog', {}), h),
          evidence.status === 'uploaded'
            ? link(proofRouter({ episodeId: model.episodeId }), format(locale, 'episode.publicProof', {}), h)
            : h.empty,
          h.button(
            [
              h.Type('button'),
              h.Class(auditButtonClassName),
              h.Disabled(Verify.guards.Running(model.verify)),
              h.OnClick(Message.ClickedVerify()),
            ],
            busyLabel(
              Verify.guards.Running(model.verify),
              format(locale, 'episode.action', {
                action: Verify.guards.Running(model.verify) ? 'verifying' : 'verify',
              }),
              h,
            ),
          ),
          Verify.match(model.verify, {
            Idle: () => h.empty,
            Running: () => h.empty,
            Failed: ({ error }) => alertLine(error, locale, h),
            Done: ({ result }) => verifyResultView(result, locale, h),
          }),
        ],
    h,
  )
}

/** A hash in the timeline is shortened (the cards below show it whole); anything else is shown as it is. */
const shortDetail = (detail: string) =>
  /^0x[0-9a-f]{40,}$/i.test(detail) ? `${detail.slice(0, 10)}…${detail.slice(-6)}` : detail

const timelineCard = (audit: EpisodeAudit, inputs: Inputs, h: HtmlBuilder<Message>): Html =>
  card(
    'timeline',
    inputs.locale,
    [
      h.ol(
        [h.Class(timelineListClassName)],
        // The timeline is read once and never reordered in place, so its rows need no keys.
        audit.timeline.map((entry) =>
          h.li(
            [],
            [
              h.time([], [clockTime(entry.at, inputs.locale, inputs.timeZone)]),
              ' ',
              format(inputs.locale, 'episode.event', { kind: entry.kind }),
              entry.detail === null ? '' : ` · ${shortDetail(entry.detail)}`,
            ],
          ),
        ),
      ),
    ],
    h,
  )

const auditView = (model: Model, audit: EpisodeAudit, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale, timeZone } = inputs
  const { episode } = audit
  return h.div(
    [h.Class(auditLayoutClassName)],
    [
      h.a(
        [h.Href(robotConsoleRouter({ robotId: episode.robotId })), h.Class(backClassName)],
        [h.span([h.AriaHidden(true)], ['‹']), format(locale, 'episode.back', { robot: episode.robotName })],
      ),
      h.h1([h.Class(titleClassName)], [format(locale, 'episode.title', { item: episode.item })]),
      h.p(
        [h.Class(mutedClassName)],
        [
          format(locale, 'episode.meta', {
            robot: episode.robotName,
            started: clockTime(episode.createdAt, locale, timeZone),
          }),
        ],
      ),
      // How it ended at a glance: a pill in the outcome's colour, the recorded reason beside it.
      h.p(
        [h.Role('status'), h.Class(stateRowClassName)],
        [
          h.span(
            [
              h.Class(
                clsx(
                  statePillClassName,
                  episode.state === 'paid'
                    ? 'bg-paid/12 text-paid'
                    : terminalStates.has(episode.state)
                      ? 'bg-error-soft text-error'
                      : 'bg-surface text-ink',
                ),
              ),
            ],
            [format(locale, 'episodes.state', { state: episode.state })],
          ),
          episode.result === null ? h.empty : h.span([h.Class(mutedClassName)], [episode.result]),
        ],
      ),
      timelineCard(audit, inputs, h),
      observationCard(model, audit, inputs, h),
      decisionCard(model, audit, inputs, h),
      chipCard(audit, locale, h),
      paymentCard(audit, locale, h),
      approvalCard(audit, locale, h),
      evidenceCard(model, audit, locale, h),
      h.a(
        [h.Href(episodesRouter()), h.Class('justify-self-center py-3 font-semibold text-muted')],
        [format(locale, 'episode.allRecords', {})],
      ),
    ],
  )
}

/** The page before its audit arrives: loading, signed out or failed, under the same back link to the wallet. */
const pendingView = (content: Html, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class(auditLayoutClassName)],
    [
      h.a(
        [h.Href(walletRouter()), h.Class(backClassName)],
        [h.span([h.AriaHidden(true)], ['‹']), format(locale, 'episodes.backToWallet', {})],
      ),
      h.h1([h.Class(titleClassName)], [format(locale, 'episodes.title', {})]),
      content,
    ],
  )

/** `/wallet/episodes/:id`: one errand after the fact, every recorded step with what proves it. */
export const episodeView = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) =>
  h.main(
    [h.Id('main')],
    [
      AuditState.match(model.state, {
        Loading: () => pendingView(loadingView(inputs.locale, h), inputs.locale, h),
        SignedOut: () => pendingView(signedOutView(inputs.locale, h), inputs.locale, h),
        Failed: ({ error }) =>
          pendingView(failedView(error, Message.ClickedReload(), inputs.locale, h), inputs.locale, h),
        Loaded: ({ audit }) => auditView(model, audit, inputs, h),
      }),
    ],
  ),
)
