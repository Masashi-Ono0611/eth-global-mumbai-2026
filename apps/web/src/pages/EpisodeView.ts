import { format, type Locale } from '@ethmumbai/i18n'
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
import { isZeroGDecision } from '../api/Robot.ts'
import { explorerTx } from '../api/Wallet.ts'
import { episodesRouter, robotConsoleRouter } from '../route.ts'
import { AuditState, Message, type Model, Replay, Verify } from './Episode.ts'
import { observationCard } from './ObservationCard.ts'
import { failedView, loadingView, ownerMain, signedOutView } from './Shared.ts'
import {
  actionRowClassName,
  alertTextClassName,
  auditButtonClassName,
  auditLayoutClassName,
  card,
  checkListClassName,
  fields,
  inputDetailsClassName,
  link,
  none,
  replayBoxClassName,
  stackClassName,
  timelineListClassName,
} from './EpisodeParts.ts'
import type { Inputs } from './EpisodeParts.ts'

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
    Failed: ({ error }) =>
      h.p([h.Role('alert'), h.Class(alertTextClassName)], [format(locale, 'common.errorDetail', { message: error })]),
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
        ? h.p([h.Class('hint')], [format(locale, 'episode.replaySame', { same: result.same ? 'yes' : 'no' })])
        : h.empty,
    ],
  )
}

const decisionView = (decision: AuditDecision, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
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
    ],
  )

const decisionCard = (model: Model, audit: EpisodeAudit, locale: Locale, h: HtmlBuilder<Message>): Html =>
  card(
    'decision',
    locale,
    [
      ...(audit.decisions.length === 0
        ? [none('decision', locale, h)]
        : audit.decisions.map((decision) => decisionView(decision, locale, h))),
      audit.decisions.length === 0
        ? h.empty
        : h.button(
            [
              h.Type('button'),
              h.Class(auditButtonClassName),
              h.Disabled(Replay.guards.Running(model.replay)),
              h.OnClick(Message.ClickedReplay()),
            ],
            [format(locale, 'episode.action', { action: 'replay' })],
          ),
      h.p([h.Class('hint')], [format(locale, 'episode.replayNote', {})]),
      replayView(model, locale, h),
    ],
    h,
  )

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
                [format(locale, 'console.chipState', { status: request.status, refusal: request.refusal_code ?? '—' })],
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
          h.button(
            [
              h.Type('button'),
              h.Class(auditButtonClassName),
              h.Disabled(Verify.guards.Running(model.verify)),
              h.OnClick(Message.ClickedVerify()),
            ],
            [
              format(locale, 'episode.action', {
                action: Verify.guards.Running(model.verify) ? 'verifying' : 'verify',
              }),
            ],
          ),
          Verify.match(model.verify, {
            Idle: () => h.empty,
            Running: () => h.empty,
            Failed: ({ error }) =>
              h.p(
                [h.Role('alert'), h.Class(alertTextClassName)],
                [format(locale, 'common.errorDetail', { message: error })],
              ),
            Done: ({ result }) => verifyResultView(result, locale, h),
          }),
        ],
    h,
  )
}

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
              entry.detail === null ? '' : ` · ${entry.detail}`,
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
      h.p(
        [h.Class('lead')],
        [
          format(locale, 'episode.meta', {
            robot: episode.robotName,
            started: clockTime(episode.createdAt, locale, timeZone),
          }),
        ],
      ),
      h.p([h.Role('status')], [format(locale, 'robot.state', { state: episode.state })]),
      episode.result === null
        ? h.empty
        : h.p([h.Class('hint')], [format(locale, 'console.reason', { reason: episode.result })]),
      timelineCard(audit, inputs, h),
      observationCard(model, audit, inputs, h),
      decisionCard(model, audit, locale, h),
      chipCard(audit, locale, h),
      paymentCard(audit, locale, h),
      approvalCard(audit, locale, h),
      evidenceCard(model, audit, locale, h),
      h.div(
        [h.Class(actionRowClassName)],
        [
          h.a([h.Href(episodesRouter()), h.Class('secondary-action')], [format(locale, 'episodes.title', {})]),
          h.a(
            [h.Href(robotConsoleRouter({ robotId: episode.robotId })), h.Class('secondary-action')],
            [format(locale, 'robots.openConsole', {})],
          ),
        ],
      ),
    ],
  )
}

/** `/wallet/episodes/:id`: one errand after the fact, every recorded step with what proves it. */
export const episodeView = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) =>
  ownerMain(
    AuditState.guards.Loaded(model.state)
      ? format(inputs.locale, 'episode.title', { item: model.state.audit.episode.item })
      : format(inputs.locale, 'episodes.title', {}),
    AuditState.match(model.state, {
      Loading: () => loadingView(inputs.locale, h),
      SignedOut: () => signedOutView(inputs.locale, h),
      Failed: ({ error }) => failedView(error, Message.ClickedReload(), inputs.locale, h),
      Loaded: ({ audit }) => auditView(model, audit, inputs, h),
    }),
    h,
  ),
)
