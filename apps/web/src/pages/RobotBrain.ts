import { RadioGroup } from '@foldkit/ui'
import { Option, Schema } from 'effect'

// The dock's brain choice (Kris, 7 Nov): which 0G model answers the owner's next messages, picked by hand, never an
// automatic fallback. The Worker lists the models it allows (its ZG_MODEL first); what answered is recorded per call.

/** One option per model the Worker allows. */
export const BrainRadioGroup = RadioGroup.create()

export const initBrainPicker = () => RadioGroup.init({ id: 'brain' })

/** A request's `model`: the owner's pick, or null for the Worker's ZG_MODEL. */
export const RequestModel = Schema.NullOr(Schema.String)

export const requestModel = (maybeBrain: Option.Option<string>) => Option.getOrNull(maybeBrain)
