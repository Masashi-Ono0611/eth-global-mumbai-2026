import type { RefusalCode } from '@ethmumbai/protocol/Chip'
import type { Hex } from '@ethmumbai/protocol/Hex'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { Effect } from 'effect'
import type { ChipRequestRow } from './Requests.ts'

/** What the chip reports back about the payment its signature paid for (§8 responses). */
export type PaymentReport =
  | { readonly status: 'settled'; readonly txHash: Hex }
  | { readonly status: 'failed'; readonly reason: string }

/**
 * The chip protocol's seam to the Robot Agent: the chip routes never decide an errand themselves. The robot module
 * implements these (lazy timeouts on every poll, inline settlement after a signature, the refusal outcome).
 */
export interface ChipHooks {
  readonly tick: (robotId: string) => Effect.Effect<void, never, RuntimeContext>
  readonly signed: (request: ChipRequestRow, signature: Hex) => Effect.Effect<PaymentReport, never, RuntimeContext>
  readonly refused: (
    request: ChipRequestRow,
    code: RefusalCode,
    detail: string,
  ) => Effect.Effect<void, never, RuntimeContext>
}

/** Before an errand engine is wired: nothing ticks, and a signature has no payment to settle. */
export const noErrands: ChipHooks = {
  tick: () => Effect.void,
  signed: () => Effect.succeed({ status: 'failed', reason: 'no errand for this request' }),
  refused: () => Effect.void,
}
