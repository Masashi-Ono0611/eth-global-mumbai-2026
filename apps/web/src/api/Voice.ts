import { VoiceSay, VoiceTurn } from '@ethmumbai/protocol/Voice'
import { Effect, Schema } from 'effect'
import { getJson, postJson } from './Http.ts'

/** Vita's voice routes (packages/server/src/robot/Voice.ts); `/api/health` reports `voice` once 0G is configured. */

const Health = Schema.Struct({ features: Schema.Struct({ voice: Schema.optionalKey(Schema.Boolean) }) })

/** Whether this release has the voice routes on (`/api/health` reports it; an older Worker has no `voice`). */
export const voiceAvailable = getJson('/api/health', Health).pipe(
  Effect.map((health) => health.features.voice === true),
)

/** One push-to-talk clip (`data:audio/wav;base64,…`): what Vita heard, the turn's kind, Vita's line and its speech. */
export const sendVoiceTurn = (robotId: string, audio: string) =>
  postJson(`/api/robots/${robotId}/voice`, { audio }, VoiceTurn)

/** Vita's line for an intent's current state, built by the Worker from that state. */
export const sayIntent = (robotId: string, intentId: string) =>
  postJson(`/api/robots/${robotId}/voice/say`, { intentId }, VoiceSay)
