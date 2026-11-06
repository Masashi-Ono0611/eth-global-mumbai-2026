import { ChipEvent, ChipFailure, pair, serve, signScan } from '@ethmumbai/chip/client'
import { loadOrCreateKey, makeSigner } from '@ethmumbai/chip/signer'
import type { Hex } from '@ethmumbai/protocol/Hex'
import type { ScanRequest } from '@ethmumbai/protocol/Scan'
import { Data, Effect, Fiber, Option } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { makeIdbState } from './idbState.ts'

// The sim robot's chip, in the sim tab (spec §8; Spike B option b): the unchanged apps/chip policy and signer over an
// IndexedDB state. It pairs with `#pair=CODE` or resumes, long-polls, refuses or signs every sign request and answers
// it, exactly as the Radxa does. The chip token stays in here: callers get `chipFetch`, which only reaches this
// robot's own `/api/chips/<robotId>/…` routes. Events carry no key, token or signature.

/** Lifecycle events on top of the chip's own `ChipEvent`s. */
export type SimChipLifecycle = Data.TaggedEnum<{
  Paired: { readonly robotId: string; readonly address: Hex }
  Resumed: { readonly robotId: string; readonly address: Hex }
  /** The poll loop ended (the chip token was rejected: pair again from the wallet's link). */
  Stopped: { readonly reason: string }
}>
export const SimChipLifecycle = Data.taggedEnum<SimChipLifecycle>()
export type SimChipEvent = ChipEvent | SimChipLifecycle

export interface SimChipOptions {
  /** The PUBLIC app origin (`window.location.origin`), never the API Worker's own URL: invoices live under it. */
  readonly origin: string
  /** The one-time code from `#pair=CODE` (see {@link takePairCode}); absent → resume the stored pairing. */
  readonly pairCode?: string | undefined
  /** Which IndexedDB chip to use; pass the sim's `?robot=` id. One key per robot (D1 keeps chip addresses unique). */
  readonly slot?: string | undefined
  readonly onEvent: (event: SimChipEvent) => void
}

export interface SimChip {
  readonly robotId: string
  readonly address: Hex
  /** Hash the JPEG crop and sign its `scanMessage` (EIP-191): the body for `POST /api/chips/<robotId>/scans`. */
  readonly signScan: (invoiceId: string, jpeg: Uint8Array, capturedAt: number) => Promise<ScanRequest>
  /** `fetch` with the chip token, for this robot's chip routes only: `path` must start `/api/chips/<robotId>/`. */
  readonly chipFetch: (path: string, init?: RequestInit) => Promise<Response>
  /** Stop polling; the lease lapses on the Worker and the robot reads as offline. */
  readonly stop: () => void
}

/** Read `#pair=CODE` and drop it from the address bar, so a reload resumes instead of re-pairing a spent code. */
export const takePairCode = () => {
  const code = /^#pair=([A-Z0-9]{8})$/.exec(window.location.hash)?.[1]
  if (code !== undefined) window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return code
}

const start = Effect.fnUntraced(function* (options: SimChipOptions) {
  const emit = (event: SimChipEvent) =>
    Effect.try({ try: () => options.onEvent(event), catch: () => undefined }).pipe(Effect.ignore)
  const state = yield* makeIdbState(options.slot ?? 'default')
  const key = yield* loadOrCreateKey(state)
  const signer = makeSigner(key.privateKey)
  const pairing =
    options.pairCode === undefined
      ? Option.getOrUndefined(yield* state.readPairing)
      : yield* pair(options.origin, options.pairCode, signer)
  if (pairing === undefined)
    return yield* new ChipFailure({ message: 'not paired: open the simulator from the wallet’s Add robot link' })
  if (options.pairCode !== undefined) {
    yield* state.writePairing(pairing)
    yield* emit(SimChipLifecycle.Paired({ robotId: pairing.robotId, address: signer.address }))
  } else yield* emit(SimChipLifecycle.Resumed({ robotId: pairing.robotId, address: signer.address }))
  if (pairing.server !== options.origin)
    return yield* new ChipFailure({ message: `paired with ${pairing.server}, not ${options.origin}` })
  const fiber = yield* serve(pairing, signer, state, emit).pipe(
    Effect.catch((error) =>
      emit(SimChipLifecycle.Stopped({ reason: error instanceof ChipFailure ? error.message : String(error) })),
    ),
    Effect.provide(FetchHttpClient.layer),
    Effect.forkDetach,
  )
  return { pairing, signer, fiber }
})

/** The handle the sim UI holds; built outside the Effect, its methods run their own effects. */
const handle = ({ pairing, signer, fiber }: Effect.Success<ReturnType<typeof start>>): SimChip => {
  const prefix = `/api/chips/${pairing.robotId}/`
  return {
    robotId: pairing.robotId,
    address: signer.address,
    signScan: (invoiceId, jpeg, capturedAt) =>
      Effect.runPromise(signScan(pairing, signer, invoiceId, jpeg, Math.trunc(capturedAt))),
    chipFetch: (path, init) => {
      if (!path.startsWith(prefix) || path.includes('..'))
        return Promise.reject(new Error(`chipFetch is for ${prefix}… only`))
      const headers = new Headers(init?.headers)
      headers.set('authorization', `Bearer ${pairing.chipToken}`)
      return fetch(`${pairing.server}${path}`, { ...init, headers })
    },
    stop: () => {
      Effect.runFork(Fiber.interrupt(fiber))
    },
  }
}

/** Start the sim chip: pair or resume, then poll and sign in the background until `stop()`. */
export const startSimChip = (options: SimChipOptions): Promise<SimChip> =>
  Effect.runPromise(start(options).pipe(Effect.map(handle), Effect.provide(FetchHttpClient.layer)))
