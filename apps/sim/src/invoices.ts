import { Invoice } from '@ethmumbai/protocol/Invoice'
import { background, InvoiceStatusReply, jsonInit, ownerFetch, request } from './api.ts'
import type { Cafe, Stall, StallId } from './scene.ts'

// The merchant screens. Each stall shows a real invoice minted through the public merchant API, as the till does
// (`POST /api/merchants/duck-cafe/invoices {itemId}`), as the short robot-facing QR `VQ1:<INVOICEID>`. An invoice is
// re-minted a minute before it expires. The stall's gate polls the signed status read and opens on `paid` (the first
// read reports `paid`, later ones `used`: either means this invoice was paid).

const MERCHANT = 'duck-cafe'
const POLL_MS = 3000
const REMINT_BEFORE_S = 60
const OPEN_MS = 10_000
const RETRY_MS = 10_000

export interface PaidEvent {
  readonly stall: StallId
  readonly invoiceId: string
}

interface ScreenState {
  invoice: { readonly id: string; readonly expiresAt: number } | null
  /** Invoices this stall showed that a scan may still be paying (an approval can outlast a re-mint). */
  readonly watched: Set<string>
  openUntil: number
  retryAt: number
}

const nonce = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

const mint = async (stall: Stall, state: ScreenState) => {
  const reply = await request(
    ownerFetch,
    `/api/merchants/${MERCHANT}/invoices`,
    Invoice,
    jsonInit('POST', { itemId: stall.id }),
  )
  if (!reply.ok) {
    state.retryAt = Date.now() + RETRY_MS
    stall.setScreen({ kind: 'text', text: reply.status === 503 ? 'till offline' : 'no invoice', tone: 'idle' })
    return
  }
  state.invoice = { id: reply.value.id, expiresAt: reply.value.expiresAt }
  state.watched.add(reply.value.id)
  // Upper case fits QR alphanumeric mode: 30 characters stay a version 2 code, the size Spike A measured decoding
  // from 0.22-0.62 m (lower case is byte mode, version 3, with fewer pixels per module).
  stall.setScreen({ kind: 'qr', payload: `VQ1:${reply.value.id.toUpperCase()}` })
}

const statusOf = async (invoiceId: string) => {
  const reply = await request(
    ownerFetch,
    `/api/invoices/${encodeURIComponent(invoiceId)}/status?nonce=${nonce()}`,
    InvoiceStatusReply,
  )
  return reply.ok ? reply.value.status : null
}

export const runInvoices = (cafe: Cafe, onPaid: (event: PaidEvent) => void) => {
  const states = new Map<StallId, ScreenState>(
    cafe.stalls.map((stall) => [stall.id, { invoice: null, watched: new Set(), openUntil: 0, retryAt: 0 }]),
  )
  const open = (stall: Stall, state: ScreenState, invoiceId: string) => {
    state.openUntil = Date.now() + OPEN_MS
    state.invoice = null
    stall.gate.open = true
    cafe.exitGate.open = true
    stall.setScreen({ kind: 'text', text: 'PAID ✓', tone: 'paid' })
    onPaid({ stall: stall.id, invoiceId })
  }
  const step = async (stall: Stall, state: ScreenState) => {
    const now = Date.now()
    if (state.openUntil > now) return
    stall.gate.open = false
    for (const invoiceId of state.watched) {
      const status = await statusOf(invoiceId)
      if (status === 'paid' || status === 'used') {
        state.watched.delete(invoiceId)
        return open(stall, state, invoiceId)
      }
      if (status === 'expired') state.watched.delete(invoiceId)
    }
    const stale = state.invoice === null || state.invoice.expiresAt - REMINT_BEFORE_S <= now / 1000
    if (stale && state.retryAt <= now) await mint(stall, state)
  }
  const control = { stopped: false }
  const loop = async () => {
    while (!control.stopped) {
      for (const stall of cafe.stalls) {
        const state = states.get(stall.id)
        if (state !== undefined) await step(stall, state)
      }
      cafe.exitGate.open = [...states.values()].some((state) => state.openUntil > Date.now())
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
  }
  background(loop())
  return {
    stop: () => {
      control.stopped = true
    },
  }
}
