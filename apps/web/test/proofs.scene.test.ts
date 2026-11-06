import type { EpisodeEvidence } from '@ethmumbai/protocol/Errand'
import type { ProofPointer, ProofSummary } from '@ethmumbai/protocol/Proof'
import { Command, click, expect, given, role, scene, text, withViewInputs } from 'foldkit/scene'
import { describe, test } from 'vitest'
import * as Proof from '../src/pages/Proof.ts'
import { proofView } from '../src/pages/ProofView.ts'
import * as Proofs from '../src/pages/Proofs.ts'

const inputs: { readonly locale: 'en'; readonly timeZone: string } = { locale: 'en', timeZone: 'UTC' }
const rootHash = `0x${'11'.repeat(32)}` as const
const frameRoot = `0x${'0c'.repeat(32)}` as const
const frameSha = `0x${'23'.repeat(32)}` as const
const logTx = `0x${'d1'.repeat(32)}` as const
const payTx = `0x${'ab'.repeat(32)}` as const
const indexerUrl = 'https://indexer-storage-testnet-turbo.0g.ai'
const anchors = {
  chainId: 16602,
  episodeLog: '0x4C947E6D794C78d0F684e46EFC97f712E51a206A',
  rpcUrl: 'https://evmrpc-testnet.0g.ai',
  indexerUrl,
}

const summary = (episodeId: string, overrides: Partial<ProofSummary> = {}): ProofSummary => ({
  episodeId,
  item: 'chai',
  state: 'paid',
  action: 'pay',
  model: 'glm-5.3',
  teeProofs: 1,
  frames: 1,
  rootHash,
  logTx,
  paymentTx: payTx,
  uploadedAt: 1_793_979_208,
  ...overrides,
})

describe('/proofs', () => {
  const view = withViewInputs(Proofs.view, inputs)()

  test('lists every published errand with its 0G decision, and loads older ones on request', () => {
    scene(
      { update: Proofs.update, view },
      given(
        Proofs.update(
          Proofs.init().model,
          Proofs.Message.SucceededLoadProofs({ proofs: [summary('ep1')], next: '1793979208.ep1', appended: false }),
        ).model,
      ),
      expect(role('heading', { name: 'Proofs on 0G' })).toExist(),
      expect(text('Paid on Arc')).toExist(),
      expect(text('glm-5.3: pay')).toExist(),
      expect(text('TEE proof attached')).toExist(),
      expect(text('1 camera frame')).toExist(),
      expect(role('link', { name: 'Check the proof: Chai' })).toHaveAttr('href', '/app/proofs/ep1'),
      click(role('button', { name: 'Older proofs' })),
      Command.expectExact(Proofs.LoadProofs({ after: '1793979208.ep1' })),
      Command.resolve(
        Proofs.LoadProofs,
        Proofs.Message.SucceededLoadProofs({
          proofs: [summary('ep0', { item: 'samosa', state: 'walked_away', action: 'walk_away', paymentTx: null })],
          next: null,
          appended: true,
        }),
      ),
      expect(role('link', { name: 'Check the proof: Chai' })).toExist(),
      expect(text('Walked away, nothing paid')).toExist(),
      expect(role('button', { name: 'Older proofs' })).not.toExist(),
    )
  })
})

const episodeId = 'jg2wabvwez4mxe22ecnfjvigbq'
const pointer: ProofPointer = { anchors, episodeId, rootHash, storageTx: null, logTx, uploadedAt: 1_793_979_208 }
const evidence: EpisodeEvidence = {
  episodeId,
  robotId: 'ctprzi5ygx2ma4gtwxrjdjof6i',
  item: 'chai',
  decisions: [
    {
      step: 1,
      model: 'glm-5.3',
      requestId: 'req-1',
      chatId: null,
      provider: null,
      latencyMs: 900,
      promptSha256: `0x${'aa'.repeat(32)}` as const,
      action: 'pay',
      reason: 'Known merchant, within budget',
      outcome: 'paid',
    },
  ],
  outcome: { state: 'paid', txHash: payTx },
  requestIds: ['req-1'],
  observations: [
    {
      sha256: frameSha,
      bytes: 8683,
      capturedAt: 1_793_972_248_007,
      chipSig: `0x${'5'.repeat(130)}` as const,
      rootHash: frameRoot,
    },
  ],
}

describe('/proofs/:id', () => {
  const view = withViewInputs(proofView, inputs)()
  const loaded = Proof.update(
    Proof.init(episodeId).model,
    Proof.Message.SucceededLoadProof({ pointer, evidence }),
  ).model

  test('shows the episode as 0G Storage holds it: the decision, the Arc payment and the frame from 0G', () => {
    scene(
      { update: Proof.update, view },
      given(loaded),
      expect(role('heading', { name: 'Proof: Chai' })).toExist(),
      expect(text('Known merchant, within budget')).toExist(),
      expect(text('req-1')).toExist(),
      expect(role('link', { name: 'Payment on Arc' })).toHaveAttr('href', `https://explorer.arc.io/tx/${payTx}`),
      expect(role('img', { name: "The QR code the robot's camera read, as its chip signed it" })).toHaveAttr(
        'src',
        `${indexerUrl}/file?root=${frameRoot}`,
      ),
      expect(role('link', { name: logTx })).toHaveAttr('href', `https://chainscan-galileo.0g.ai/tx/${logTx}`),
      expect(role('link', { name: 'All proofs' })).toHaveAttr('href', '/app/proofs'),
    )
  })

  test('Verify checks 0G in the browser and says which checks failed', () => {
    scene(
      { update: Proof.update, view },
      given(loaded),
      click(role('button', { name: 'Verify against 0G' })),
      Command.expectExact(Proof.VerifyOnZeroG({ pointer, evidence })),
      Command.resolve(
        Proof.VerifyOnZeroG,
        Proof.Message.SucceededVerify({
          result: {
            record: { rootHash, requestIdsHash: `0x${'20'.repeat(32)}`, recorder: anchors.episodeLog, recordedAt: 1 },
            checks: { recorded: true, rootMatches: true, requestIdsMatch: true, sameEpisode: true },
            frames: [{ sha256: frameSha, rootHash: frameRoot, downloaded: frameSha }],
          },
        }),
      ),
      expect(role('status')).toHaveText('Every check passed.'),
      expect(text("The record's root is the root this file was downloaded by")).toExist(),
      expect(text('Frame downloaded from 0G Storage: its SHA-256 matches what the chip signed')).toExist(),
      click(role('button', { name: 'Verify against 0G' })),
      Command.resolve(
        Proof.VerifyOnZeroG,
        Proof.Message.SucceededVerify({
          result: {
            record: null,
            checks: { recorded: false, rootMatches: false, requestIdsMatch: false, sameEpisode: true },
            frames: [{ sha256: frameSha, rootHash: frameRoot, downloaded: null }],
          },
        }),
      ),
      expect(role('status')).toHaveText('Some checks failed.'),
      expect(text('Frame did not download from 0G Storage')).toExist(),
      click(role('button', { name: 'Verify against 0G' })),
      Command.resolve(Proof.VerifyOnZeroG, Proof.Message.FailedVerify({ error: '0G Chain did not answer' })),
      expect(role('alert')).toHaveText('Something went wrong: 0G Chain did not answer'),
    )
  })
})
