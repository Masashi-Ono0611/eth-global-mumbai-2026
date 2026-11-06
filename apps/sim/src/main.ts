import { ChipEvent } from '@ethmumbai/chip/client'
import { background, explorerTx, jsonInit, ownerFetch } from './api.ts'
import { callLabel } from './brain.ts'
import { vqBridge } from './bridge.ts'
import { type SimChipEvent, SimChipLifecycle, startSimChip, takePairCode } from './chip/browserChip.ts'
import { describePlace, describeScene } from './facts.ts'
import { runInvoices } from './invoices.ts'
import { runLive } from './live.ts'
import { runNav } from './nav.ts'
import { ENTRANCE } from './scene.ts'
import { mountPanel, type Panel } from './ui.ts'

// The simulator page, `/sim/?robot=<id>#pair=CODE`: Pollen's engine boots from its own script tag (index.html); this
// entry mounts the owner's panel, starts the browser chip (pairing once with the fragment's code, resuming after),
// and, once the duck stands, puts it at the entrance, lights the stall screens and runs the 0G nav executor.

const robotId = new URLSearchParams(window.location.search).get('robot')
const pairCode = takePairCode()

const LABELS: Readonly<Record<string, string>> = {
  LeaseOk: 'lease ok',
  LeaseExpired: 'lease expired',
  PollFailed: 'poll failed, retrying',
  ResponseRejected: 'the Worker rejected a chip response',
  ResponseFailed: 'a chip response failed',
}

const paymentLine = (panel: Panel, event: Extract<ChipEvent, { readonly _tag: 'Payment' }>) => {
  const reason = event.reason === undefined ? '' : `: ${event.reason}`
  const tx = event.txHash === undefined ? undefined : explorerTx(event.txHash)
  panel.chipLog(`payment ${event.status}${reason}`, tx)
}

/** Pairing and lifecycle events: true when `event` was one. */
const lifecycle = (panel: Panel, event: SimChipEvent) => {
  if (SimChipLifecycle.$is('Stopped')(event)) {
    panel.chipStatus('chip stopped', 'bad')
    panel.chipLog(`${event.reason}: open the simulator again from the wallet`)
    return true
  }
  const resumed = SimChipLifecycle.$is('Resumed')(event)
  if (!SimChipLifecycle.$is('Paired')(event) && !resumed) return false
  panel.chipStatus('chip paired', 'ok')
  panel.chipLog(`${resumed ? 'resumed' : 'paired'} as ${event.address.slice(0, 10)}…`)
  return true
}

const chipEvent = (panel: Panel) => (event: SimChipEvent) => {
  if (lifecycle(panel, event)) return
  if (ChipEvent.$is('Signed')(event)) return panel.chipLog(`signed the payment for ${event.invoiceId}`)
  if (ChipEvent.$is('Refused')(event)) return panel.chipLog(`refused ${event.invoiceId}: ${event.code}`)
  if (ChipEvent.$is('Payment')(event)) return paymentLine(panel, event)
  const { _tag: tag } = event
  panel.chipLog(LABELS[tag] ?? tag)
}

const start = async (robot: string) => {
  const world = vqBridge.ready()
  const panel = mountPanel(robot, (intentId) => {
    background(ownerFetch(`/api/robots/${encodeURIComponent(robot)}/intents/${intentId}/stop`, jsonInit('POST', {})))
    background(world.then(({ body }) => body.stop()))
  })
  const chip = startSimChip({ origin: window.location.origin, pairCode, slot: robot, onEvent: chipEvent(panel) }).catch(
    (error: unknown) => {
      panel.chipStatus('chip failed', 'bad')
      panel.chipLog(error instanceof Error ? error.message : 'the chip did not start')
      return null
    },
  )
  const ready = await world
  while (!ready.body.ready()) await new Promise((resolve) => setTimeout(resolve, 500))
  ready.body.teleport(ENTRANCE)
  // `?debug=1`: the sim world on `window.vqDebug`, for driving the duck from a browser console or Playwright.
  if (new URLSearchParams(window.location.search).get('debug') === '1')
    Object.defineProperty(window, 'vqDebug', { value: { ...ready, describePlace, describeScene } })
  panel.navStatus('the duck is at the entrance')
  runInvoices(ready.cafe, ({ stall, invoiceId }) => panel.chipLog(`${stall} invoice ${invoiceId} paid: gate open`))
  const paired = await chip
  if (paired === null) return
  const live = runLive(ready, paired, panel.chipLog)
  runNav(ready, paired, {
    intent: (intent) => {
      live.active()
      panel.intent(intent)
      panel.navStatus(`errand: “${intent.instruction}”`)
    },
    turn: () => undefined,
    calling: (call) => panel.navStatus(`doing ${callLabel(call)}`),
    say: panel.say,
    status: panel.navStatus,
    ended: (_, reason) => {
      live.ended()
      panel.ended(reason)
    },
  })
}

if (robotId === null) {
  const panel = mountPanel('', () => undefined)
  panel.chipStatus('no robot', 'bad')
  panel.navStatus('Open the simulator from the wallet: Add robot → Simulator → Open simulator.')
} else background(start(robotId))
