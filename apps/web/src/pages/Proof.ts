import { EpisodeEvidence } from '@ethmumbai/protocol/Errand'
import { AnchorChecks, anchorChecks, ChainRecord, ProofPointer } from '@ethmumbai/protocol/Proof'
import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import type * as HttpClient from 'effect/http/HttpClient'
import { downloadEpisode, frameSha256, loadProofPointer, readChainRecord } from '../api/Proofs.ts'

// One public proof (`/app/proofs/:episodeId`, no sign-in): the Worker names the root, the episode itself is downloaded
// from 0G Storage by that root, and Verify re-checks it in the reader's browser against EpisodeLog on 0G Chain and
// against each frame's bytes on 0G Storage.

// MODEL

export const ProofState = defineTaggedUnion({
  Loading: {},
  Loaded: { pointer: ProofPointer, evidence: EpisodeEvidence },
  Failed: { error: Schema.String },
})

/** One frame's check: downloaded from 0G Storage by its root and hashed here (`downloaded` null when it did not come). */
const FrameCheck = Schema.Struct({
  sha256: Schema.String,
  rootHash: Schema.String,
  downloaded: Schema.NullOr(Schema.String),
})
type FrameCheck = typeof FrameCheck.Type

export const VerifyResult = Schema.Struct({
  record: Schema.NullOr(ChainRecord),
  checks: AnchorChecks,
  frames: Schema.Array(FrameCheck),
})
export type VerifyResult = typeof VerifyResult.Type

export const Verify = defineTaggedUnion({
  Idle: {},
  Running: {},
  Done: { result: VerifyResult },
  Failed: { error: Schema.String },
})

export const Model = Schema.Struct({ episodeId: Schema.String, state: ProofState, verify: Verify })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadProof: { pointer: ProofPointer, evidence: EpisodeEvidence },
  FailedLoadProof: { error: Schema.String },
  ClickedReload: {},
  ClickedVerify: {},
  SucceededVerify: { result: VerifyResult },
  FailedVerify: { error: Schema.String },
})
export type Message = typeof Message.Type

// COMMAND

/** The Worker's pointer, then the episode itself from 0G Storage by that root. */
const LoadProof = Command.define('LoadProof', {
  args: { episodeId: Schema.String },
  messages: [Message.SucceededLoadProof, Message.FailedLoadProof],
  execute: ({ episodeId }) =>
    loadProofPointer(episodeId).pipe(
      Effect.flatMap((pointer) =>
        downloadEpisode(pointer.anchors.indexerUrl, pointer.rootHash).pipe(
          Effect.map((evidence) => Message.SucceededLoadProof({ pointer, evidence })),
        ),
      ),
      Effect.catch((failure) => Effect.succeed(Message.FailedLoadProof({ error: failure.error }))),
    ),
})

/** The frames the anchored JSON names with a 0G root (frames without one were not on 0G when it was anchored). */
const framesOnZeroG = (evidence: EpisodeEvidence) =>
  (evidence.observations ?? []).flatMap((frame) =>
    frame.rootHash === undefined ? [] : [{ sha256: frame.sha256, rootHash: frame.rootHash }],
  )

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const VerifyOnZeroG = Command.define('VerifyOnZeroG', {
  args: { pointer: ProofPointer, evidence: EpisodeEvidence },
  messages: [Message.SucceededVerify, Message.FailedVerify],
  execute: ({ pointer, evidence }) => {
    const { episodeLog, rpcUrl, indexerUrl } = pointer.anchors
    if (episodeLog === null)
      return Effect.succeed(Message.FailedVerify({ error: 'this server names no EpisodeLog contract' }))
    const frames = Effect.forEach(
      framesOnZeroG(evidence),
      (frame) =>
        frameSha256(indexerUrl, frame.rootHash).pipe(
          Effect.map((downloaded): FrameCheck => ({ ...frame, downloaded })),
          Effect.orElseSucceed((): FrameCheck => ({ ...frame, downloaded: null })),
        ),
      { concurrency: 3 },
    )
    return Effect.all([readChainRecord(rpcUrl, episodeLog, pointer.episodeId), frames]).pipe(
      Effect.map(([record, checkedFrames]) =>
        Message.SucceededVerify({
          result: {
            record,
            checks: anchorChecks(pointer.episodeId, pointer.rootHash, evidence, record),
            frames: checkedFrames,
          },
        }),
      ),
      Effect.catch((failure) => Effect.succeed(Message.FailedVerify({ error: failure.error }))),
    )
  },
})

// INIT

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient>

export const init = (episodeId: string): UpdateReturn => ({
  model: { episodeId, state: ProofState.Loading(), verify: Verify.Idle() },
  commands: [LoadProof({ episodeId })],
})

// UPDATE

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadProof: ({ pointer, evidence }) => ({
      model: modifyFields(model, { state: () => ProofState.Loaded({ pointer, evidence }) }),
    }),
    FailedLoadProof: ({ error }) => ({ model: modifyFields(model, { state: () => ProofState.Failed({ error }) }) }),
    ClickedReload: () => ({
      model: modifyFields(model, { state: () => ProofState.Loading(), verify: () => Verify.Idle() }),
      commands: [LoadProof({ episodeId: model.episodeId })],
    }),
    ClickedVerify: () => {
      const { state } = model
      if (!ProofState.guards.Loaded(state) || Verify.guards.Running(model.verify)) return { model }
      return {
        model: modifyFields(model, { verify: () => Verify.Running() }),
        commands: [VerifyOnZeroG({ pointer: state.pointer, evidence: state.evidence })],
      }
    },
    SucceededVerify: ({ result }) => ({ model: modifyFields(model, { verify: () => Verify.Done({ result }) }) }),
    FailedVerify: ({ error }) => ({ model: modifyFields(model, { verify: () => Verify.Failed({ error }) }) }),
  })
