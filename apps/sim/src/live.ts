import { background, jsonInit } from './api.ts'
import type { SimWorld } from './bridge.ts'
import type { SimChip } from './chip/browserChip.ts'

// The live view (Kris, 6 Nov): while the duck is out on an errand, once a second the head camera's whole frame is
// encoded as a JPEG, signed by the browser chip (`frameMessage`, never a scan) and posted to `…/frames`, where the
// owner's conversation picks up the latest one. The frame is never decision input: 0G only ever gets text facts.

const EVERY_MS = 1000
/** Keep sending this long after the errand's intent ends, so the owner sees the outcome (the gate opening). */
const LINGER_MS = 20_000

export interface LiveFeed {
  /** The duck is out: start (or keep) sending. */
  readonly active: () => void
  /** The errand ended: keep sending for a little while, then stop. */
  readonly ended: () => void
}

/** Send frames while active; a 404 (LIVE_ENABLED off on this deploy) stops the feed for this tab, a 429 skips one. */
export const runLive = (world: SimWorld, chip: SimChip, log: (line: string) => void): LiveFeed => {
  const state = { activeUntil: 0, off: false, sent: 0 }
  const send = async () => {
    const shot = await world.camera.snapshot()
    if (shot === null) return
    const body = await chip.signFrame(shot.jpeg, shot.capturedAt)
    const response = await chip.chipFetch(`/api/chips/${chip.robotId}/frames`, jsonInit('POST', body))
    if (response.status === 404) {
      state.off = true
      return log('live view is off on this deploy')
    }
    if (response.status !== 201) return
    state.sent += 1
    if (state.sent === 1) log(`live view: sending frames (${Math.round(shot.jpeg.byteLength / 1024)} KB each)`)
  }
  const loop = async () => {
    while (!state.off) {
      const started = Date.now()
      if (started < state.activeUntil) await send().catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, EVERY_MS - (Date.now() - started))))
    }
  }
  background(loop())
  return {
    active: () => {
      state.activeUntil = Number.POSITIVE_INFINITY
    },
    ended: () => {
      state.activeUntil = Date.now() + LINGER_MS
    },
  }
}
