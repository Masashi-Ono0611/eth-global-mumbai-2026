import { format } from '@ethmumbai/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import {
  clockTime,
  type EpisodeAudit,
  type Observation,
  observationImage,
  storageScan,
  storageScanTx,
} from '../api/Episodes.ts'
import { type Message, type Model, Verify } from './Episode.ts'
import { card, fields, type Inputs, mutedClassName, stackClassName } from './EpisodeParts.ts'

// STYLES

/** The thumbnail beside its facts; on a phone the facts wrap under it. */
const observationRowClassName = 'flex w-full flex-wrap items-start gap-4'
/** Small on purpose: it proves what the chip saw, it is not a gallery. */
/** Inner radius 12 px inside the card's 22 px with its 16 px padding would be too tight, so the photo keeps the
 *  control radius; a pure-black 10 % outline keeps its edge clean. */
const thumbnailClassName =
  'size-28 shrink-0 rounded-control bg-paper object-contain outline outline-1 -outline-offset-1 outline-black/10'

type Check = 'verified' | 'hash' | 'signer' | 'unchecked'
const checkClassName: Readonly<Record<Check, string>> = {
  verified: 'text-paid',
  hash: 'text-error',
  signer: 'text-error',
  unchecked: 'text-muted',
}

/** Verify's answer for this crop: both checks pass, which one failed, or Verify has not run (or predates the check). */
const checkOf = (model: Model, observation: Observation): Check => {
  if (!Verify.guards.Done(model.verify)) return 'unchecked'
  const found = model.verify.result.observations?.find((entry) => entry.sha256 === observation.sha256)
  if (found === undefined) return 'unchecked'
  if (!found.hashMatches) return 'hash'
  return found.signerMatches ? 'verified' : 'signer'
}

type FrameCheck = 'matches' | 'differs' | 'missing'
/** Verify's download of the frame back from 0G Storage: null before Verify, or before the frame was uploaded. */
const frameCheckOf = (model: Model, observation: Observation): FrameCheck | null => {
  if (!Verify.guards.Done(model.verify)) return null
  const zeroG = model.verify.result.observations?.find((entry) => entry.sha256 === observation.sha256)?.zeroG
  if (zeroG === undefined || zeroG === null) return null
  if (!zeroG.downloaded) return 'missing'
  return zeroG.hashMatches ? 'matches' : 'differs'
}

/** Where the frame is on 0G Storage (public, plain bytes): the upload's link, "saving" until the uploader stored it,
 *  nothing on Workers that predate it. */
const frameOnZeroG = (model: Model, observation: Observation, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const { rootHash, storageTx } = observation
  if (rootHash === undefined) return h.empty
  if (rootHash === null) return h.p([h.Class(mutedClassName)], [format(locale, 'proof.frameSaving', {})])
  const check = frameCheckOf(model, observation)
  return h.div(
    [h.Class(stackClassName)],
    [
      h.a(
        [h.Href(storageTx === undefined || storageTx === null ? storageScan(rootHash) : storageScanTx(storageTx))],
        [format(locale, 'proof.frameOnZeroG', {})],
      ),
      check === null
        ? h.empty
        : h.p(
            [h.Class(check === 'matches' ? 'text-paid' : 'text-error')],
            [format(locale, 'episode.frameCheck', { check })],
          ),
    ],
  )
}

const shortHex = (hex: string) => (hex.length > 18 ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : hex)

const observationView = (
  model: Model,
  audit: EpisodeAudit,
  observation: Observation,
  inputs: Inputs,
  h: HtmlBuilder<Message>,
): Html => {
  const { locale } = inputs
  const check = checkOf(model, observation)
  return h.div(
    [h.Class(observationRowClassName)],
    [
      h.img([
        h.Src(observationImage(audit.episode.id, observation.sha256)),
        h.Alt(format(locale, 'episode.observationAlt', {})),
        h.Loading('lazy'),
        h.Decoding('async'),
        h.Class(thumbnailClassName),
      ]),
      h.div(
        [h.Class(stackClassName)],
        [
          fields(
            [
              ['capturedAt', clockTime(observation.capturedAt, locale, inputs.timeZone)],
              ['sha256', shortHex(observation.sha256)],
              [
                'signer',
                format(locale, 'episode.signedBy', {
                  chip: audit.episode.chipAddress === null ? '—' : shortHex(audit.episode.chipAddress),
                }),
              ],
            ],
            locale,
            h,
          ),
          h.p([h.Class(checkClassName[check])], [format(locale, 'episode.observationCheck', { check })]),
          frameOnZeroG(model, observation, inputs, h),
        ],
      ),
    ],
  )
}

/** "What the robot saw": the chip-signed QR crops of this errand; absent when the robot scanned nothing. */
export const observationCard = (model: Model, audit: EpisodeAudit, inputs: Inputs, h: HtmlBuilder<Message>): Html =>
  audit.observations.length === 0
    ? h.empty
    : card(
        'observation',
        inputs.locale,
        [
          h.p([h.Class(mutedClassName)], [format(inputs.locale, 'episode.observationNote', {})]),
          ...audit.observations.map((observation) => observationView(model, audit, observation, inputs, h)),
        ],
        h,
      )
