import {
  IntentView,
  isOpenIntent,
  NavPlace,
  type NavCall,
  type NavResult,
  NavTurnResponse,
} from '@ethmumbai/protocol/Intent'
import { Option, Schema } from 'effect'
import { background, jsonInit, request } from './api.ts'
import type { SimWorld } from './bridge.ts'
import type { SimChip } from './chip/browserChip.ts'
import { describePlace, describeScene } from './facts.ts'

// The nav executor: the sim's half of the 0G navigation loop (plan step 4). It polls the chip route for the robot's
// open intent, then loops one Worker turn at a time: post the previous calls' results and the scene as text, receive
// the next calls, execute them in order. 0G (glm-5.3, in the Worker) decides every step; this file only carries them
// out. `look` returns text facts from scene state, never pixels; `scan_qr` reports only that the chip-signed scan was
// posted, and the Worker substitutes the errand's real outcome.

export interface NavObserver {
  readonly intent: (intent: IntentView) => void
  readonly turn: (response: NavTurnResponse) => void
  readonly calling: (call: NavCall) => void
  readonly say: (text: string) => void
  readonly status: (text: string) => void
  readonly ended: (intentId: string, reason: string) => void
}

const IDLE_POLL_MS = 2000
const SIGHTING_FRESH_MS = 1500
const SCAN_WAIT_MS = 8000
const WAIT_MAX_S = 60
/** The Worker's global cap (two turns in flight): keep the duck still and retry after these pauses. */
const BUSY_RETRY_MS = [5000, 10_000, 20_000]
const WAIT_POLL_MS = 2000

const GoToArgs = Schema.Struct({ place: NavPlace })
const SayArgs = Schema.Struct({ text: Schema.String })
const WaitArgs = Schema.Struct({ seconds: Schema.Finite })
const FinishArgs = Schema.Struct({ summary: Schema.String })

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** `GET /api/chips/:robotId/intent`: the newest open intent, or 204 (which `request` reports as not ok). */
const openIntent = async (chip: SimChip) => {
  const reply = await request(chip.chipFetch, `/api/chips/${chip.robotId}/intent`, IntentView)
  return reply.ok ? reply.value : null
}

/**
 * `wait`: the Worker answers it with the errand's state at the next turn and does not hold the request, so the sim
 * does the waiting, up to WAIT_MAX_S, and returns early once the errand behind the intent changes state.
 */
const waitFor = async (chip: SimChip, intentId: string, seconds: number) => {
  const started = Date.now()
  const before = (await openIntent(chip))?.episodeState ?? null
  const until = started + Math.min(seconds, WAIT_MAX_S) * 1000
  while (Date.now() < until) {
    await sleep(WAIT_POLL_MS)
    const now = await openIntent(chip)
    if (now === null || now.id !== intentId || (now.episodeState ?? null) !== before) break
  }
  return Math.round((Date.now() - started) / 1000)
}

type Outcome = { readonly result: Record<string, unknown>; readonly end?: string }

const goTo = async (world: SimWorld, args: Record<string, unknown>): Promise<Outcome> => {
  const parsed = Schema.decodeUnknownOption(GoToArgs)(args)
  if (Option.isNone(parsed)) return { result: { error: 'unknown place' } }
  const { place } = parsed.value
  const walk = await world.body.walkTo(world.cafe.places[place])
  if (walk.fell) return { result: { arrived: false, place, fell: true }, end: 'the duck fell and did not get up' }
  return { result: { arrived: walk.arrived, place, seconds: walk.seconds, distanceToTarget: walk.distanceToTarget } }
}

const scanQr = async (world: SimWorld, chip: SimChip): Promise<Outcome> => {
  const sighting = world.camera.sighting(SIGHTING_FRESH_MS) ?? (await world.camera.nextSighting(SCAN_WAIT_MS))
  if (sighting === null) return { result: { seen: null } }
  const jpeg = await world.camera.crop(sighting)
  const scan = await chip.signScan(sighting.invoiceId, jpeg, sighting.capturedAt)
  const response = await chip.chipFetch(`/api/chips/${chip.robotId}/scans`, jsonInit('POST', scan)).catch(() => null)
  return { result: { posted: sighting.invoiceId, httpStatus: response?.status ?? 0 } }
}

const execute = async (
  world: SimWorld,
  chip: SimChip,
  intentId: string,
  call: NavCall,
  observer: NavObserver,
): Promise<Outcome> => {
  switch (call.name) {
    case 'go_to':
      return goTo(world, call.args)
    case 'look': {
      const [x, y] = world.body.pose()
      return { result: describePlace(world, world.cafe.placeAt(x, y)) }
    }
    case 'say': {
      const text = Option.match(Schema.decodeUnknownOption(SayArgs)(call.args), {
        onNone: () => '',
        onSome: (args) => args.text.slice(0, 160),
      })
      observer.say(text)
      return { result: { said: true } }
    }
    case 'wait': {
      const seconds = Option.match(Schema.decodeUnknownOption(WaitArgs)(call.args), {
        onNone: () => 1,
        onSome: (args) => args.seconds,
      })
      return { result: { waited: await waitFor(chip, intentId, seconds) } }
    }
    case 'scan_qr':
      return scanQr(world, chip)
    case 'finish': {
      const summary = Option.match(Schema.decodeUnknownOption(FinishArgs)(call.args), {
        onNone: () => 'Done.',
        onSome: (args) => args.summary,
      })
      observer.say(summary)
      return { result: { finished: true }, end: 'finished' }
    }
  }
}

/** One Worker turn; a `429` (the global turn cap or 0G's overload) is retried after growing pauses. */
const postTurn = async (chip: SimChip, intentId: string, results: ReadonlyArray<NavResult>, scene: string) => {
  const path = `/api/chips/${chip.robotId}/intents/${intentId}/turn`
  const send = () => request(chip.chipFetch, path, NavTurnResponse, jsonInit('POST', { results, scene }))
  let reply = await send()
  for (const pause of BUSY_RETRY_MS) {
    if (reply.ok || reply.status !== 429) return reply
    await sleep(pause)
    reply = await send()
  }
  return reply
}

const runCalls = async (
  world: SimWorld,
  chip: SimChip,
  intentId: string,
  calls: ReadonlyArray<NavCall>,
  observer: NavObserver,
) => {
  const results: NavResult[] = []
  for (const call of calls) {
    observer.calling(call)
    const outcome = await execute(world, chip, intentId, call, observer).catch((error: unknown): Outcome => ({
      result: { error: error instanceof Error ? error.message : 'failed' },
    }))
    results.push({ callId: call.id, result: outcome.result })
    if (outcome.end !== undefined) return { results, end: outcome.end }
  }
  return { results, end: undefined }
}

/** Drive one intent until the Worker says it is no longer open, 0G finishes, or the duck can't go on. */
const runIntent = async (world: SimWorld, chip: SimChip, intent: IntentView, observer: NavObserver) => {
  let results: ReadonlyArray<NavResult> = []
  for (;;) {
    observer.status('0G is thinking…')
    const reply = await postTurn(chip, intent.id, results, describeScene(world))
    if (!reply.ok) return observer.ended(intent.id, `turn refused (${reply.status}): ${reply.error}`)
    observer.turn(reply.value)
    if (!isOpenIntent(reply.value.state)) {
      // The Worker ends the intent on `finish`; the duck still says its last lines.
      const spoken = reply.value.calls.filter((call) => call.name === 'say' || call.name === 'finish')
      await runCalls(world, chip, intent.id, spoken, observer)
      return observer.ended(intent.id, reply.value.reason ?? reply.value.state)
    }
    if (reply.value.calls.length === 0) {
      results = []
      await sleep(1000)
      continue
    }
    const ran = await runCalls(world, chip, intent.id, reply.value.calls, observer)
    if (ran.end === 'finished') return observer.ended(intent.id, 'finished')
    if (ran.end !== undefined) {
      // Report the fatal result (a fall) so the Worker records it and stops the intent; then stop here.
      await postTurn(chip, intent.id, ran.results, describeScene(world))
      world.body.stop()
      return observer.ended(intent.id, ran.end)
    }
    results = ran.results
  }
}

/** Poll for the robot's open intent and run each one once. */
export const runNav = (world: SimWorld, chip: SimChip, observer: NavObserver) => {
  const handled = new Set<string>()
  const control = { stopped: false }
  const loop = async () => {
    while (!control.stopped) {
      const intent = await openIntent(chip)
      if (intent !== null && isOpenIntent(intent.state) && !handled.has(intent.id)) {
        handled.add(intent.id)
        observer.intent(intent)
        await runIntent(world, chip, intent, observer)
        observer.status('idle')
      }
      await sleep(IDLE_POLL_MS)
    }
  }
  background(loop())
  return {
    stop: () => {
      control.stopped = true
    },
  }
}
