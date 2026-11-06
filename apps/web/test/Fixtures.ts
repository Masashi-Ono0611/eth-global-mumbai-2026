/** Shared fixtures for the page scene tests: API shapes as the Worker answers them. */
import type { EpisodeSummary } from '../src/api/Episodes.ts'

export const address = '0x1234567890abcdef1234567890ABCDEF12345678'
export const payee = '0x000000000000000000000000000000000000c0de'
export const txHash = `0x${'ab'.repeat(32)}`
export const grant = {
  id: 'grantgrantgrantgrantgranta',
  status: 'active',
  dailyCap: '1000000',
  perPaymentCap: '300000',
  allowlist: [payee],
  expiresAt: 4_000_000_000,
}
export const pairedRobot = {
  id: 'robotrobotrobotrobotrobota',
  name: 'Duck',
  status: 'paired',
  chipAddress: '0x00000000000000000000000000000000000c41f0',
  pairingCode: null,
  pairingExpiresAt: null,
  lease: { until: null, online: true },
  grant: null,
}

export const detail = (state: string, paid: boolean) => ({
  episode: { id: 'e1', item: 'chai', state, result: null, invoice_id: 'i1' },
  decisions: [
    {
      id: 'd1',
      step: 1,
      model: 'zg-model',
      request_id: 'req-1',
      chat_id: 'chat-1',
      latency_ms: 812,
      provider: 'router-api.0g.ai/zg-model@0x00000000000000000000000000000000000000f0',
      action: 'pay',
      reason: 'under the cap',
      outcome: null,
      error: null,
    },
  ],
  chipRequest: { id: 'c1', status: paid ? 'signed' : 'delivered', refusal_code: null },
  payment: paid ? { status: 'paid', txHash, invoice: { id: 'i1', amount: '100000', payTo: payee } } : null,
  evidence: null,
})

export const activityRow = (id: string, item: string, state: string, amount: string, tx: string | null) => ({
  id,
  robotId: pairedRobot.id,
  robotName: 'Duck',
  item,
  state,
  createdAt: 0,
  amount,
  txHash: tx,
})
export const summary = (id: string, item: string, state: string, reason: string): EpisodeSummary => ({
  id,
  robotId: pairedRobot.id,
  robotName: 'Duck',
  item,
  state,
  result: null,
  createdAt: 0,
  endedAt: null,
  decision: { action: 'pay', reason, requestId: 'req-1', provider: 'router-api.0g.ai/m', latencyMs: 900 },
  payment: null,
  approval: null,
  evidence: null,
})
