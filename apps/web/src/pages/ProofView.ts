import { format, type Locale } from '@ethmumbai/i18n'
import type { EpisodeEvidence } from '@ethmumbai/protocol/Errand'
import type { ProofPointer } from '@ethmumbai/protocol/Proof'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { chainScan, clockTime, storageScan, storageScanTx } from '../api/Episodes.ts'
import { storageFile } from '../api/Proofs.ts'
import { explorerTx, itemName } from '../api/Wallet.ts'
import { busyLabel } from '../Busy.ts'
import { proofsRouter } from '../route.ts'
import {
  alertLine,
  auditButtonClassName,
  auditCardClassName,
  auditLayoutClassName,
  backClassName,
  checkListClassName,
  definitionList,
  type Inputs,
  mutedClassName,
  stackClassName,
  titleClassName,
} from './EpisodeParts.ts'
import { Message, type Model, ProofState, Verify, type VerifyResult } from './Proof.ts'
import { failedView, loadingView } from './Shared.ts'

// STYLES

const frameListClassName = 'm-0 grid w-full list-none gap-3 p-0'
/** A crop is the QR's box plus a margin, about square: the space is reserved before the image arrives from 0G. */
const frameImageClassName =
  'block aspect-square w-44 rounded-control bg-paper object-contain outline outline-1 -outline-offset-1 outline-black/10'
const decisionListClassName = 'm-0 grid w-full list-none gap-3 p-0'

// VIEW

type Card = 'decision' | 'payment' | 'frames' | 'anchor'
type Field =
  | 'model'
  | 'requestId'
  | 'action'
  | 'reason'
  | 'tee'
  | 'rootHash'
  | 'episodeLog'
  | 'logTx'
  | 'storageTx'
  | 'sha256'
  | 'capturedAt'
  | 'recordedAt'
  | 'recorder'

const MONO: ReadonlySet<Field> = new Set<Field>(['requestId', 'rootHash', 'episodeLog', 'sha256', 'recorder'])

const card = (kind: Card, locale: Locale, content: ReadonlyArray<Html>, h: HtmlBuilder<Message>): Html =>
  h.section([h.Class(auditCardClassName)], [h.h2([], [format(locale, 'proofs.card', { card: kind })]), ...content])

const fields = (
  rows: ReadonlyArray<readonly [Field, string | Html | null]>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html =>
  definitionList(
    rows.map(([field, value]) => [format(locale, 'proofs.field', { field }), value, MONO.has(field)] as const),
    h,
  )

const link = (href: string, label: string, h: HtmlBuilder<Message>): Html => h.a([h.Href(href)], [label])

const decisionCard = (evidence: EpisodeEvidence, locale: Locale, h: HtmlBuilder<Message>): Html =>
  card(
    'decision',
    locale,
    [
      evidence.decisions.length === 0
        ? h.p([h.Class(mutedClassName)], [format(locale, 'proofs.noDecision', {})])
        : h.ol(
            [h.Class(decisionListClassName)],
            evidence.decisions.map((decision) =>
              h.keyed('li')(
                `decision-${decision.step}`,
                [],
                [
                  fields(
                    [
                      ['action', format(locale, 'proofs.action', { action: decision.action })],
                      ['reason', decision.reason],
                      ['model', decision.model],
                      ['requestId', decision.requestId],
                      [
                        'tee',
                        decision.tee === undefined
                          ? null
                          : format(locale, 'proofs.teeYes', { signer: decision.tee.signer }),
                      ],
                    ],
                    locale,
                    h,
                  ),
                ],
              ),
            ),
          ),
    ],
    h,
  )

const paymentCard = (evidence: EpisodeEvidence, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const { txHash } = evidence.outcome
  return card(
    'payment',
    locale,
    [
      h.p([h.Class('font-semibold')], [format(locale, 'proofs.state', { state: evidence.outcome.state })]),
      txHash === undefined
        ? h.p([h.Class(mutedClassName)], [format(locale, 'proofs.noPayment', {})])
        : link(explorerTx(txHash), format(locale, 'proofs.paymentTx', {}), h),
    ],
    h,
  )
}

/** The chip-signed frames, loaded straight from 0G Storage by their roots. */
const framesCard = (evidence: EpisodeEvidence, pointer: ProofPointer, inputs: Inputs, h: HtmlBuilder<Message>) => {
  const { locale, timeZone } = inputs
  const frames = (evidence.observations ?? []).flatMap((frame) =>
    frame.rootHash === undefined ? [] : [{ ...frame, rootHash: frame.rootHash }],
  )
  return card(
    'frames',
    locale,
    [
      frames.length === 0
        ? h.p([h.Class(mutedClassName)], [format(locale, 'proofs.noFrames', {})])
        : h.ul(
            [h.Class(frameListClassName)],
            frames.map((frame) =>
              h.keyed('li')(
                frame.sha256,
                [h.Class(stackClassName)],
                [
                  h.img([
                    h.Src(storageFile(pointer.anchors.indexerUrl, frame.rootHash)),
                    h.Alt(format(locale, 'proofs.frameAlt', {})),
                    h.Loading('lazy'),
                    h.Decoding('async'),
                    h.Class(frameImageClassName),
                  ]),
                  fields(
                    [
                      ['capturedAt', clockTime(frame.capturedAt, locale, timeZone)],
                      ['sha256', frame.sha256],
                      ['rootHash', link(storageScan(frame.rootHash), frame.rootHash, h)],
                    ],
                    locale,
                    h,
                  ),
                ],
              ),
            ),
          ),
    ],
    h,
  )
}

const allPassed = (result: VerifyResult) =>
  Object.values(result.checks).every(Boolean) && result.frames.every((frame) => frame.downloaded === frame.sha256)

const verifyResultView = (result: VerifyResult, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale, timeZone } = inputs
  const checks = ['recorded', 'rootMatches', 'requestIdsMatch', 'sameEpisode'] as const
  return h.div(
    [h.Class(stackClassName)],
    [
      h.p(
        [h.Role('status'), h.Class('font-semibold')],
        [format(locale, 'proofs.allPassed', { passed: allPassed(result) ? 'yes' : 'no' })],
      ),
      h.ul(
        [h.Class(checkListClassName)],
        [
          ...checks.map((check) =>
            h.keyed('li')(
              check,
              [h.DataAttribute('match', result.checks[check] ? 'yes' : 'no')],
              [format(locale, 'proofs.check', { check })],
            ),
          ),
          ...result.frames.map((frame) =>
            h.keyed('li')(
              `frame-${frame.sha256}`,
              [h.DataAttribute('match', frame.downloaded === frame.sha256 ? 'yes' : 'no')],
              [
                format(locale, 'proofs.frameCheck', {
                  result:
                    frame.downloaded === null ? 'missing' : frame.downloaded === frame.sha256 ? 'matches' : 'differs',
                }),
              ],
            ),
          ),
        ],
      ),
      result.record === null
        ? h.empty
        : fields(
            [
              ['recordedAt', clockTime(result.record.recordedAt * 1000, locale, timeZone)],
              ['recorder', result.record.recorder],
            ],
            locale,
            h,
          ),
    ],
  )
}

const anchorCard = (model: Model, pointer: ProofPointer, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const running = Verify.guards.Running(model.verify)
  const { episodeLog } = pointer.anchors
  return card(
    'anchor',
    locale,
    [
      fields(
        [
          ['rootHash', link(storageScan(pointer.rootHash), pointer.rootHash, h)],
          [
            'storageTx',
            pointer.storageTx === null ? null : link(storageScanTx(pointer.storageTx), pointer.storageTx, h),
          ],
          [
            'episodeLog',
            episodeLog === null ? null : link(`https://chainscan-galileo.0g.ai/address/${episodeLog}`, episodeLog, h),
          ],
          ['logTx', pointer.logTx === null ? null : link(chainScan(pointer.logTx), pointer.logTx, h)],
        ],
        locale,
        h,
      ),
      h.p([h.Class(mutedClassName)], [format(locale, 'proofs.verifyNote', {})]),
      h.button(
        [h.Type('button'), h.Class(auditButtonClassName), h.Disabled(running), h.OnClick(Message.ClickedVerify())],
        busyLabel(running, format(locale, 'proofs.verify', { running: running ? 'yes' : 'no' }), h),
      ),
      Verify.match(model.verify, {
        Idle: () => h.empty,
        Running: () => h.empty,
        Failed: ({ error }) => alertLine(error, locale, h),
        Done: ({ result }) => verifyResultView(result, inputs, h),
      }),
    ],
    h,
  )
}

const backLink = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.a(
    [h.Href(proofsRouter()), h.Class(backClassName)],
    [h.span([h.AriaHidden(true)], ['‹']), format(locale, 'proofs.back', {})],
  )

const loadedView = (
  model: Model,
  pointer: ProofPointer,
  evidence: EpisodeEvidence,
  inputs: Inputs,
  h: HtmlBuilder<Message>,
): Html => {
  const { locale, timeZone } = inputs
  return h.div(
    [h.Class(auditLayoutClassName)],
    [
      backLink(locale, h),
      h.h1([h.Class(titleClassName)], [format(locale, 'proofs.pageTitle', { item: itemName(evidence.item) })]),
      h.p(
        [h.Class(mutedClassName)],
        [format(locale, 'proofs.published', { time: clockTime(pointer.uploadedAt * 1000, locale, timeZone) })],
      ),
      h.p([h.Class(mutedClassName)], [format(locale, 'proofs.source', {})]),
      decisionCard(evidence, locale, h),
      paymentCard(evidence, locale, h),
      framesCard(evidence, pointer, inputs, h),
      anchorCard(model, pointer, inputs, h),
    ],
  )
}

/** `/app/proofs/:episodeId`: one errand's proof, read from 0G and checkable against it by anyone. */
export const proofView = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) =>
  h.main(
    [h.Id('main')],
    [
      ProofState.match(model.state, {
        Loading: () =>
          h.div([h.Class(auditLayoutClassName)], [backLink(inputs.locale, h), loadingView(inputs.locale, h)]),
        Failed: ({ error }) =>
          h.div(
            [h.Class(auditLayoutClassName)],
            [backLink(inputs.locale, h), failedView(error, Message.ClickedReload(), inputs.locale, h)],
          ),
        Loaded: ({ pointer, evidence }) => loadedView(model, pointer, evidence, inputs, h),
      }),
    ],
  ),
)
