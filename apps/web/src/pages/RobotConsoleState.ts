import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { IntentView } from '@ethmumbai/protocol/Intent'
import { ConsoleRobot, ErrandDetail } from '../api/Robot.ts'
import { EpisodeSummary } from '../api/Episodes.ts'
import { Catalogue } from '../api/Wallet.ts'

// The robot conversation's state unions, kept apart from RobotConsole.ts (its update) for its line limit.

export const ConsoleState = defineTaggedUnion({
  Loading: {},
  SignedOut: {},
  Loaded: {
    robot: ConsoleRobot,
    catalogue: Catalogue,
    /** The robot's errands, oldest first: the conversation's history. */
    history: Schema.Array(EpisodeSummary),
    /** What each errand paid or asked for (USDC base units), by errand id. */
    amounts: Schema.Record(Schema.String, Schema.String),
  },
  Failed: { error: Schema.String },
})
export const Decline = defineTaggedUnion({ Idle: {}, Declining: {}, Failed: { error: Schema.String } })
/** A simulator robot's errand intent: the owner's instruction, while 0G walks the duck to the counter (sim-plan.md). */
export const Intent = defineTaggedUnion({
  Idle: {},
  Sending: { instruction: Schema.String },
  Open: { intent: IntentView, stopping: Schema.Boolean },
  Failed: { error: Schema.String },
})
export type Intent = typeof Intent.Type
export const Errand = defineTaggedUnion({
  Idle: {},
  Running: {
    episodeId: Schema.String,
    maybeDetail: Schema.Option(ErrandDetail),
    maybeApprovalUrl: Schema.Option(Schema.String),
  },
})
export type Errand = typeof Errand.Type
