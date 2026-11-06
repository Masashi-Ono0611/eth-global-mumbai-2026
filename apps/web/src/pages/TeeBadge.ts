import { format } from '@ethmumbai/i18n'
import { TeeProof } from '@ethmumbai/protocol/Errand'
import { Option, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { clockTime } from '../api/Episodes.ts'
import { type Message, type Model, Verify } from './Episode.ts'
import { fields, type Inputs, inputDetailsClassName, mutedClassName, stackClassName } from './EpisodeParts.ts'

// STYLES

type TeeState = 'sealed' | 'unchecked' | 'mismatch' | 'none'
const teeClassName: Readonly<Record<TeeState, string>> = {
  sealed: 'font-medium text-online',
  unchecked: 'text-muted',
  mismatch: 'text-error',
  none: 'text-muted',
}

const decodeTee = Schema.decodeUnknownOption(Schema.fromJsonString(TeeProof))

/**
 * The decision's TeeML proof (`decisions.tee_json`), if the brain gave one: sealed once Verify confirms the signature
 * belongs to the provider's TEE signer, unchecked before Verify, a mismatch when it does not, and "not TEE-verifiable"
 * for a brain that publishes no proof (the router's qwen provider) or a proof that does not parse.
 */
const teeState = (model: Model, proof: Option.Option<TeeProof>): TeeState => {
  if (Option.isNone(proof)) return 'none'
  if (!Verify.guards.Done(model.verify) || model.verify.result.tee === undefined) return 'unchecked'
  return model.verify.result.tee.signerMatches ? 'sealed' : 'mismatch'
}

const shortHex = (hex: string) => (hex.length > 18 ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : hex)
const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 12)}…` : id)

/**
 * What the proof means (from the real sample): "0G chat <chatId> was answered inside this registered TEE". The signed
 * text hashes the encrypted request and response, so the badge names the chat, not "this exact reply".
 */
export const teeView = (
  model: Model,
  decision: { readonly tee_json: string | null; readonly chat_id: string | null },
  inputs: Inputs,
  h: HtmlBuilder<Message>,
): Html => {
  const { locale } = inputs
  const proof = decision.tee_json === null ? Option.none<TeeProof>() : decodeTee(decision.tee_json)
  const state = teeState(model, proof)
  const badge = h.p(
    [h.Class(teeClassName[state])],
    [format(locale, 'episode.tee', { state, chat: shortId(decision.chat_id ?? '—') })],
  )
  return Option.match(proof, {
    onNone: () => badge,
    onSome: ({ signer, text, fetchedAt }) =>
      h.div(
        [h.Class(stackClassName)],
        [
          badge,
          fields(
            [
              ['teeSigner', shortHex(signer)],
              ['teeFetched', clockTime(fetchedAt, locale, inputs.timeZone)],
            ],
            locale,
            h,
          ),
          h.details(
            [h.Class(inputDetailsClassName)],
            [
              h.summary([], [format(locale, 'episode.teeText', {})]),
              h.p([h.Class(mutedClassName)], [format(locale, 'episode.teeNote', {})]),
              fields([['teeSigner', signer]], locale, h),
              h.pre([], [text]),
            ],
          ),
        ],
      ),
  })
}
