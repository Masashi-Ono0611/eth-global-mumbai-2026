import { format, type Locale } from '@ethmumbai/i18n'
import { ProofSummary } from '@ethmumbai/protocol/Proof'
import { Effect, Schema } from 'effect'
import { Command, Submodel, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import type * as HttpClient from 'effect/http/HttpClient'
import { clockTime } from '../api/Episodes.ts'
import { listProofs } from '../api/Proofs.ts'
import { explorerTx, itemName } from '../api/Wallet.ts'
import { busyLabel } from '../Busy.ts'
import { proofRouter } from '../route.ts'
import { auditButtonClassName, type Inputs } from './EpisodeParts.ts'
import { failedView, loadingView } from './Shared.ts'

// STYLES

const pageClassName = 'grid gap-4 px-1 pt-4 pb-12'
const titleClassName = 'font-display text-[1.7rem] leading-tight font-bold text-balance'
const mutedClassName = 'text-[0.92rem] text-muted text-pretty'
const listClassName = 'm-0 grid list-none gap-2 p-0 transition-opacity duration-150 starting:opacity-0'
const rowClassName = 'grid gap-1.5 rounded-card bg-surface p-4 wrap-break-word'
const rowTopClassName = 'flex items-baseline justify-between gap-3'
const itemClassName = 'min-w-0 font-display text-lg leading-tight font-bold'
const timeClassName = 'shrink-0 text-[0.8rem] text-muted tabular-nums'
const linksClassName =
  'flex flex-wrap gap-x-4 gap-y-1 pt-1 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:font-semibold [&_a]:text-paid [&_a]:decoration-paid/40'
const teeClassName =
  'ml-1.5 inline-flex items-center rounded-full bg-paid/10 px-1.5 align-middle text-[0.72rem] font-semibold text-paid'

// MODEL

const ListState = defineTaggedUnion({
  Loading: {},
  Loaded: { proofs: Schema.Array(ProofSummary), next: Schema.NullOr(Schema.String), loadingMore: Schema.Boolean },
  Failed: { error: Schema.String },
})
export const Model = Schema.Struct({ state: ListState })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadProofs: {
    proofs: Schema.Array(ProofSummary),
    next: Schema.NullOr(Schema.String),
    appended: Schema.Boolean,
  },
  FailedLoadProofs: { error: Schema.String },
  ClickedReload: {},
  ClickedMore: {},
})
export type Message = typeof Message.Type

// COMMAND

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const LoadProofs = Command.define('LoadProofs', {
  args: { after: Schema.NullOr(Schema.String) },
  messages: [Message.SucceededLoadProofs, Message.FailedLoadProofs],
  execute: ({ after }) =>
    listProofs(after).pipe(
      Effect.map(({ proofs, next }) => Message.SucceededLoadProofs({ proofs, next, appended: after !== null })),
      Effect.catch((failure) => Effect.succeed(Message.FailedLoadProofs({ error: failure.error }))),
    ),
})

// INIT

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient>

export const init = (): UpdateReturn => ({
  model: { state: ListState.Loading() },
  commands: [LoadProofs({ after: null })],
})

// UPDATE

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadProofs: ({ proofs, next, appended }) => ({
      model: modifyFields(model, {
        state: (state) =>
          ListState.Loaded({
            proofs: appended && ListState.guards.Loaded(state) ? [...state.proofs, ...proofs] : proofs,
            next,
            loadingMore: false,
          }),
      }),
    }),
    FailedLoadProofs: ({ error }) => ({ model: modifyFields(model, { state: () => ListState.Failed({ error }) }) }),
    ClickedReload: () => ({
      model: modifyFields(model, { state: () => ListState.Loading() }),
      commands: [LoadProofs({ after: null })],
    }),
    ClickedMore: () => {
      const { state } = model
      if (!ListState.guards.Loaded(state) || state.next === null || state.loadingMore) return { model }
      return {
        model: modifyFields(model, { state: () => ListState.Loaded({ ...state, loadingMore: true }) }),
        commands: [LoadProofs({ after: state.next })],
      }
    },
  })

// VIEW

const row = (proof: ProofSummary, inputs: Inputs, h: HtmlBuilder<Message>): Html => {
  const { locale, timeZone } = inputs
  const item = itemName(proof.item)
  return h.keyed('li')(
    proof.episodeId,
    [h.Class(rowClassName)],
    [
      h.div(
        [h.Class(rowTopClassName)],
        [
          h.p([h.Class(itemClassName)], [item]),
          h.time([h.Class(timeClassName)], [clockTime(proof.uploadedAt * 1000, locale, timeZone)]),
        ],
      ),
      h.p([h.Class('font-semibold')], [format(locale, 'proofs.state', { state: proof.state })]),
      h.p(
        [h.Class(mutedClassName)],
        [
          proof.action === null || proof.model === null
            ? format(locale, 'proofs.noDecision', {})
            : format(locale, 'proofs.decided', { model: proof.model, action: proof.action }),
          proof.teeProofs > 0 ? h.span([h.Class(teeClassName)], [format(locale, 'proofs.teeAttached', {})]) : h.empty,
        ],
      ),
      proof.frames === 0
        ? h.empty
        : h.p([h.Class(mutedClassName)], [format(locale, 'proofs.frames', { count: proof.frames })]),
      h.div(
        [h.Class(linksClassName)],
        [
          h.a(
            [
              h.Href(proofRouter({ episodeId: proof.episodeId })),
              h.AriaLabel(format(locale, 'proofs.openFor', { item })),
            ],
            [format(locale, 'proofs.open', {})],
          ),
          proof.paymentTx === null
            ? h.empty
            : h.a([h.Href(explorerTx(proof.paymentTx))], [format(locale, 'proofs.paymentTx', {})]),
        ],
      ),
    ],
  )
}

const listView = (
  proofs: ReadonlyArray<ProofSummary>,
  next: string | null,
  loadingMore: boolean,
  inputs: Inputs,
  h: HtmlBuilder<Message>,
): Html =>
  proofs.length === 0
    ? h.p([h.Class(mutedClassName)], [format(inputs.locale, 'proofs.empty', {})])
    : h.div(
        [h.Class('grid gap-3')],
        [
          h.ul(
            [h.Class(listClassName)],
            proofs.map((proof) => row(proof, inputs, h)),
          ),
          next === null
            ? h.empty
            : h.button(
                [
                  h.Type('button'),
                  h.Class(`${auditButtonClassName} justify-self-center`),
                  h.Disabled(loadingMore),
                  h.OnClick(Message.ClickedMore()),
                ],
                busyLabel(loadingMore, format(inputs.locale, 'proofs.more', {}), h),
              ),
        ],
      )

const intro = (locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.h1([h.Class(titleClassName)], [format(locale, 'proofs.title', {})]),
  h.p([h.Class(mutedClassName)], [format(locale, 'proofs.explainer', {})]),
]

/** `/app/proofs`: every errand published to 0G, for anyone, newest first. */
export const view = Submodel.defineView<Model, Message, Inputs>((model, inputs, h) =>
  h.main(
    [h.Id('main'), h.Class(pageClassName)],
    [
      ...intro(inputs.locale, h),
      ListState.match(model.state, {
        Loading: () => loadingView(inputs.locale, h),
        Failed: ({ error }) => failedView(error, Message.ClickedReload(), inputs.locale, h),
        Loaded: ({ proofs, next, loadingMore }) => listView(proofs, next, loadingMore, inputs, h),
      }),
    ],
  ),
)
