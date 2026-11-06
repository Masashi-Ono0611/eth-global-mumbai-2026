import { Option } from 'effect'
import {
  Command,
  change,
  click,
  expect,
  given,
  label,
  role,
  scene,
  selector,
  text,
  withViewInputs,
} from 'foldkit/scene'
import { describe, test } from 'vitest'
import type { EpisodeAudit, EpisodeSummary, ReplayResult, VerifyResult } from '../src/api/Episodes.ts'
import * as Episode from '../src/pages/Episode.ts'
import { episodeView } from '../src/pages/EpisodeView.ts'
import * as Episodes from '../src/pages/Episodes.ts'

const txHash = `0x${'ab'.repeat(32)}`
const rootHash = `0x${'0c'.repeat(32)}`
const logTx = `0x${'d1'.repeat(32)}`
const zeroG = 'router-api.0g.ai/qwen3-vl-plus@0x000000003f486c7198d6203568a98d02b91f8044'
const orb = 'https://world.org/oidc/acr/orb'
const at = 1_793_957_061_000
const inputs: { readonly locale: 'en'; readonly timeZone: string } = { locale: 'en', timeZone: 'UTC' }

const summary = (id: string, robotId: string, overrides: Partial<EpisodeSummary> = {}): EpisodeSummary => ({
  id,
  robotId,
  robotName: robotId === 'r1' ? 'Duck' : 'Goose',
  item: 'cigarettes',
  state: 'paid',
  result: null,
  createdAt: at,
  endedAt: at + 90_000,
  decision: { action: 'ask_human', reason: 'restricted', requestId: 'req-1', provider: zeroG, latencyMs: 3151 },
  payment: { status: 'settled', txHash },
  approval: { status: 'consumed', world: { acr: orb, amr: ['pop', 'user', 'mfa'] } },
  evidence: { status: 'uploaded', rootHash, logTx },
  ...overrides,
})

describe('/wallet/episodes', () => {
  const view = withViewInputs(Episodes.view, inputs)()

  test('lists every errand with its brain, payment, World approval and evidence, and filters by robot', () => {
    const loaded = Episodes.update(
      Episodes.update(
        Episodes.init(Option.none()).model,
        Episodes.Message.SucceededLoadRobots({
          robots: [
            { id: 'r1', name: 'Duck' },
            { id: 'r2', name: 'Goose' },
          ],
        }),
      ).model,
      Episodes.Message.SucceededLoadEpisodes({
        episodes: [
          summary('ep1', 'r1'),
          summary('ep2', 'r2', {
            item: 'chai',
            state: 'safe_stop',
            decision: { action: 'pay', reason: null, requestId: null, provider: 'litellm.example/m', latencyMs: 9 },
            payment: null,
            approval: null,
            evidence: null,
          }),
        ],
      }),
    ).model
    scene(
      { update: Episodes.update, view },
      given(loaded),
      expect(role('heading', { name: 'Episodes' })).toExist(),
      expect(role('columnheader', { name: 'Decision' })).toExist(),
      expect(text('0G: ask you first')).toExist(),
      expect(text('The rehearsal brain (not 0G): pay')).toExist(),
      expect(role('link', { name: 'settled' })).toHaveAttr('href', `https://explorer.arc.io/tx/${txHash}`),
      expect(text('consumed · orb')).toExist(),
      expect(role('link', { name: 'Inspect' })).toHaveAttr('href', '/wallet/episodes/ep1'),
      change(label('Robot'), 'r2'),
      Command.expectExact(Episodes.LoadEpisodes({ robotId: 'r2' })),
      Command.resolve(
        Episodes.LoadEpisodes,
        Episodes.Message.SucceededLoadEpisodes({ episodes: [summary('ep2', 'r2', { item: 'chai' })] }),
      ),
      expect(role('link', { name: 'Inspect' })).toHaveAttr('href', '/wallet/episodes/ep2'),
      change(label('Robot'), ''),
      Command.expectExact(Episodes.LoadEpisodes({ robotId: null })),
      Command.resolve(Episodes.LoadEpisodes, Episodes.Message.SucceededLoadEpisodes({ episodes: [] })),
      expect(text('No errands yet.')).toExist(),
    )
  })

  test("a robot's own list starts filtered to it and a failed read can be retried", () => {
    const started = Episodes.init(Option.some('r9'))
    scene(
      { update: Episodes.update, view },
      given(
        Episodes.update(started.model, Episodes.Message.FailedLoadEpisodes({ error: 'offline', signedOut: false }))
          .model,
      ),
      expect(label('Robot')).toHaveValue('r9'),
      expect(role('alert')).toHaveText('Something went wrong: offline'),
      click(role('button', { name: 'Retry' })),
      Command.expectExact(Episodes.LoadEpisodes({ robotId: 'r9' })),
      Command.resolve(Episodes.LoadEpisodes, Episodes.Message.SucceededLoadEpisodes({ episodes: [] })),
      expect(text('No errands yet.')).toExist(),
    )
  })
})

const audit: EpisodeAudit = {
  episode: {
    id: 'ep1',
    robotId: 'r1',
    robotName: 'Duck',
    item: 'cigarettes',
    state: 'paid',
    result: null,
    requestIdsHash: `0x${'77'.repeat(32)}`,
    createdAt: at,
    endedAt: at + 90_000,
  },
  invoice: { id: 'inv1', pay_to: '0x0166', amount: '500000', restricted: true, status: 'paid' },
  decisions: [
    {
      id: 'd1',
      step: 1,
      model: 'qwen3-vl-plus',
      request_id: 'req-1',
      chat_id: 'chat-1',
      provider: zeroG,
      latency_ms: 3151,
      prompt_sha256: 'f'.repeat(64),
      input_json: '{"requested":"cigarettes","catalogue":{"amount":"500000"}}',
      action: 'ask_human',
      reason: 'Restricted item the owner asked for',
      outcome: 'paid',
      outcome_ref: null,
      error: null,
      created_at: at + 3000,
    },
  ],
  chipRequests: [{ id: 'c1', kind: 'sign_payment', status: 'signed', refusal_code: null, leaf_hash: '0xleaf' }],
  payments: [{ status: 'settled', tx_hash: txHash, gas_used: '446279', fail_reason: null, payer: '0x83B1' }],
  approvals: [
    {
      id: 'a1',
      status: 'consumed',
      error: null,
      auth_time: 1_793_957_146,
      world: { acr: orb, amr: ['pop', 'user', 'mfa'] },
    },
  ],
  evidence: {
    status: 'uploaded',
    root_hash: rootHash,
    storage_tx: null,
    log_tx: logTx,
    request_ids_hash: `0x${'77'.repeat(32)}`,
    error: null,
  },
  timeline: [
    { at, kind: 'errand_started', detail: 'cigarettes' },
    { at: at + 3000, kind: 'decision', detail: 'ask_human' },
    { at: at + 90_000, kind: 'payment_settled', detail: txHash },
  ],
}

const verified: VerifyResult = {
  episodeId: 'ep1',
  stored: { rootHash, requestIdsHash: audit.episode.requestIdsHash, storageTx: null, logTx, uploadStatus: 'uploaded' },
  onChain: { rootHash, requestIdsHash: `0x${'78'.repeat(32)}`, recorder: '0xc6fF', recordedAt: 1_793_957_300 },
  matches: { rootHash: true, requestIdsHash: false },
  links: {
    storagescan: `https://storagescan-galileo.0g.ai/file/${rootHash}`,
    chainscan: `https://chainscan-galileo.0g.ai/tx/${logTx}`,
  },
  downloadCheckedBy: 'uploader',
}

const replayed: ReplayResult = {
  episodeId: 'ep1',
  binding: false,
  original: { action: 'ask_human', reason: 'Restricted item the owner asked for', requestId: 'req-1', provider: zeroG },
  replay: {
    ok: true,
    action: 'ask_human',
    reason: 'Still restricted',
    requestId: 'req-2',
    provider: zeroG,
    latencyMs: 2100,
  },
  same: true,
}

describe('/wallet/episodes/:id', () => {
  const view = withViewInputs(episodeView, inputs)()
  const loaded = Episode.update(Episode.init('ep1').model, Episode.Message.SucceededLoadAudit({ audit })).model

  test('shows the timeline and every card: the 0G decision with its exact input, chip, Arc, World and 0G evidence', () => {
    scene(
      { update: Episode.update, view },
      given(loaded),
      expect(role('heading', { name: 'Errand: cigarettes' })).toExist(),
      expect(selector('ol.timeline')).toContainText('Errand started · cigarettes'),
      expect(selector('ol.timeline')).toContainText(`Settled on Arc · ${txHash}`),
      expect(text('0G decided to ask you first: Restricted item the owner asked for')).toExist(),
      expect(text('Input sent to the brain (exact JSON)')).toExist(),
      expect(selector('.audit-input pre')).toContainText('"requested": "cigarettes"'),
      expect(text('The chip signed the payment')).toExist(),
      expect(role('link', { name: 'Payment on Arc' })).toHaveAttr('href', `https://explorer.arc.io/tx/${txHash}`),
      expect(text(orb)).toExist(),
      expect(text('pop, user, mfa')).toExist(),
      expect(role('link', { name: 'EpisodeLog record on 0G Chain' })).toHaveAttr(
        'href',
        `https://chainscan-galileo.0g.ai/tx/${logTx}`,
      ),
      expect(role('link', { name: 'Open console' })).toHaveAttr('href', '/robot/r1'),
    )
  })

  test('Verify compares the stored evidence with its EpisodeLog record; a failure says why', () => {
    scene(
      { update: Episode.update, view },
      given(loaded),
      click(role('button', { name: 'Verify' })),
      Command.expectExact(Episode.VerifyEvidence({ episodeId: 'ep1' })),
      Command.resolve(Episode.VerifyEvidence, Episode.Message.SucceededVerify({ result: verified })),
      expect(text('Root hash: matches the EpisodeLog record on 0G Chain')).toExist(),
      expect(text('Request-ids hash: does not match the EpisodeLog record')).toExist(),
      click(role('button', { name: 'Verify' })),
      Command.resolve(
        Episode.VerifyEvidence,
        Episode.Message.FailedVerify({ error: 'not configured: EPISODE_LOG_ADDRESS' }),
      ),
      expect(role('alert')).toHaveText('Something went wrong: not configured: EPISODE_LOG_ADDRESS'),
    )
  })

  test('Replay asks the brain again (non-binding) and shows the new answer next to the original', () => {
    scene(
      { update: Episode.update, view },
      given(loaded),
      expect(
        text(
          'A replay sends the same input to the brain again. It is non-binding: it never pays and never changes the errand.',
        ),
      ).toExist(),
      click(role('button', { name: 'Replay decision (non-binding)' })),
      Command.expectExact(Episode.ReplayDecision({ episodeId: 'ep1' })),
      Command.resolve(Episode.ReplayDecision, Episode.Message.SucceededReplay({ result: replayed })),
      expect(text('Replay: 0G would ask you first: Still restricted')).toExist(),
      expect(text('req-2')).toExist(),
      expect(text('Same action as the original.')).toExist(),
      expect(text('0G decided to ask you first: Restricted item the owner asked for')).toExist(),
      click(role('button', { name: 'Replay decision (non-binding)' })),
      Command.resolve(
        Episode.ReplayDecision,
        Episode.Message.SucceededReplay({
          result: {
            ...replayed,
            replay: { ok: false, error: '0G call timed out (10 s)', provider: zeroG, latencyMs: 10_000 },
            same: false,
          },
        }),
      ),
      expect(role('alert')).toHaveText('Something went wrong: 0G call timed out (10 s)'),
    )
  })
})
