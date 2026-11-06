import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import type * as HttpClient from 'effect/http/HttpClient'
import {
  EpisodeAudit,
  loadEpisodeAudit,
  ReplayResult,
  replayDecision,
  VerifyResult,
  verifyEpisode,
} from '../api/Episodes.ts'
import { isSignedOut } from '../api/Http.ts'

// MODEL

export const AuditState = defineTaggedUnion({
  Loading: {},
  SignedOut: {},
  Loaded: { audit: EpisodeAudit },
  Failed: { error: Schema.String },
})
/** One owner action on the evidence or the decision: idle, running, its answer, or why it failed. */
export const Verify = defineTaggedUnion({
  Idle: {},
  Running: {},
  Done: { result: VerifyResult },
  Failed: { error: Schema.String },
})
export const Replay = defineTaggedUnion({
  Idle: {},
  Running: {},
  Done: { result: ReplayResult },
  Failed: { error: Schema.String },
})
export const Model = Schema.Struct({ episodeId: Schema.String, state: AuditState, verify: Verify, replay: Replay })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadAudit: { audit: EpisodeAudit },
  FailedLoadAudit: { error: Schema.String, signedOut: Schema.Boolean },
  ClickedReload: {},
  ClickedVerify: {},
  SucceededVerify: { result: VerifyResult },
  FailedVerify: { error: Schema.String },
  ClickedReplay: {},
  SucceededReplay: { result: ReplayResult },
  FailedReplay: { error: Schema.String },
})
export type Message = typeof Message.Type

// COMMAND

const LoadAudit = Command.define('LoadAudit', {
  args: { episodeId: Schema.String },
  messages: [Message.SucceededLoadAudit, Message.FailedLoadAudit],
  execute: ({ episodeId }) =>
    loadEpisodeAudit(episodeId).pipe(
      Effect.map((audit) => Message.SucceededLoadAudit({ audit })),
      Effect.catch((failure) =>
        Effect.succeed(Message.FailedLoadAudit({ error: failure.error, signedOut: isSignedOut(failure) })),
      ),
    ),
})

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const VerifyEvidence = Command.define('VerifyEvidence', {
  args: { episodeId: Schema.String },
  messages: [Message.SucceededVerify, Message.FailedVerify],
  execute: ({ episodeId }) =>
    verifyEpisode(episodeId).pipe(
      Effect.map((result) => Message.SucceededVerify({ result })),
      Effect.catch((failure) => Effect.succeed(Message.FailedVerify({ error: failure.error }))),
    ),
})

/** @internal Exported for the scene tests; the page update is its only production caller. */
export const ReplayDecision = Command.define('ReplayDecision', {
  args: { episodeId: Schema.String },
  messages: [Message.SucceededReplay, Message.FailedReplay],
  execute: ({ episodeId }) =>
    replayDecision(episodeId).pipe(
      Effect.map((result) => Message.SucceededReplay({ result })),
      Effect.catch((failure) => Effect.succeed(Message.FailedReplay({ error: failure.error }))),
    ),
})

// INIT

type UpdateReturn = Update.Return<Model, Message, HttpClient.HttpClient>

export const init = (episodeId: string): UpdateReturn => ({
  model: { episodeId, state: AuditState.Loading(), verify: Verify.Idle(), replay: Replay.Idle() },
  commands: [LoadAudit({ episodeId })],
})

// UPDATE

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match(message, {
    SucceededLoadAudit: ({ audit }) => ({ model: modifyFields(model, { state: () => AuditState.Loaded({ audit }) }) }),
    FailedLoadAudit: ({ error, signedOut }) => ({
      model: modifyFields(model, {
        state: () => (signedOut ? AuditState.SignedOut() : AuditState.Failed({ error })),
      }),
    }),
    ClickedReload: () => ({
      model: modifyFields(model, { state: () => AuditState.Loading() }),
      commands: [LoadAudit({ episodeId: model.episodeId })],
    }),
    ClickedVerify: () =>
      Verify.guards.Running(model.verify)
        ? { model }
        : {
            model: modifyFields(model, { verify: () => Verify.Running() }),
            commands: [VerifyEvidence({ episodeId: model.episodeId })],
          },
    SucceededVerify: ({ result }) => ({ model: modifyFields(model, { verify: () => Verify.Done({ result }) }) }),
    FailedVerify: ({ error }) => ({ model: modifyFields(model, { verify: () => Verify.Failed({ error }) }) }),
    ClickedReplay: () =>
      Replay.guards.Running(model.replay)
        ? { model }
        : {
            model: modifyFields(model, { replay: () => Replay.Running() }),
            commands: [ReplayDecision({ episodeId: model.episodeId })],
          },
    SucceededReplay: ({ result }) => ({ model: modifyFields(model, { replay: () => Replay.Done({ result }) }) }),
    FailedReplay: ({ error }) => ({ model: modifyFields(model, { replay: () => Replay.Failed({ error }) }) }),
  })
