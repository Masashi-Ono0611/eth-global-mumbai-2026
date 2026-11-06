import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk'
import { Contract, JsonRpcProvider, keccak256, toUtf8Bytes, Wallet } from 'ethers'
import { makeEvidenceApi, type Pending } from './api.ts'

// Drains the Worker's pending episode evidence to 0G Storage (Galileo, turbo indexer) and records each upload in
// EpisodeLog on 0G Chain 16602 (spec §6). Each episode's chip-signed camera frames go to 0G Storage first, as plain
// JPEG bytes (proof of the robot's work), so the episode JSON names their roots; frames of episodes uploaded earlier
// are backfilled on every pass. Runs on netcup, outside Cloudflare:
//   bun tools/evidence-uploader/main.ts [--once] [--server https://…] [--interval 15]
// Configuration comes from the repo's `.env.main.local`, then the process environment. Keys and the token are never
// printed. Without a storage key the uploader stops with "not configured", it never fakes an upload.

const root = `${import.meta.dir}/../..`

const readEnvFile = async (path: string): Promise<Record<string, string>> => {
  const text = await readFile(path, 'utf8').catch(() => '')
  const entries = text
    .split('\n')
    .map((line) => /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line))
    .flatMap((match): Array<[string, string]> =>
      match?.[1] === undefined ? [] : [[match[1], (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2')]],
    )
  const values: Record<string, string> = Object.fromEntries(entries)
  return values
}

const flag = (name: string) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const fileEnv = await readEnvFile(`${root}/.env.main.local`)
const setting = (...names: string[]) => {
  for (const name of names) {
    const value = fileEnv[name] ?? process.env[name]
    if (value !== undefined && value !== '' && value !== 'pending') return value
  }
  return undefined
}

const required = (value: string | undefined, name: string) => {
  if (value === undefined) {
    console.error(`not configured: ${name}`)
    process.exit(2)
  }
  return value
}

const config = {
  server: required(flag('--server') ?? setting('EVIDENCE_SERVER_URL', 'APP_ORIGIN'), 'EVIDENCE_SERVER_URL').replace(
    /\/+$/,
    '',
  ),
  token: required(setting('APP_EVIDENCE_TOKEN', 'EVIDENCE_TOKEN'), 'APP_EVIDENCE_TOKEN'),
  storageKey: required(setting('APP_ZG_STORAGE_PRIVATE_KEY', 'ZG_STORAGE_PRIVATE_KEY'), 'APP_ZG_STORAGE_PRIVATE_KEY'),
  episodeLog: required(setting('APP_EPISODE_LOG_ADDRESS', 'EPISODE_LOG_ADDRESS'), 'APP_EPISODE_LOG_ADDRESS'),
  indexer: setting('ZG_STORAGE_INDEXER') ?? 'https://indexer-storage-testnet-turbo.0g.ai',
  rpc: setting('ZG_CHAIN_RPC') ?? 'https://evmrpc-testnet.0g.ai',
  once: process.argv.includes('--once'),
  intervalSeconds: Number(flag('--interval') ?? '15'),
}

const EPISODE_LOG_ABI = [
  'function record(string episodeId, bytes32 rootHash, bytes32 requestIdsHash)',
  'function records(bytes32 episodeKey) view returns (bytes32 rootHash, bytes32 requestIdsHash, address recorder, uint64 recordedAt)',
  'event EpisodeRecorded(address indexed recorder, bytes32 indexed episodeKey, string episodeId, bytes32 rootHash, bytes32 requestIdsHash, uint64 recordedAt)',
  'error AlreadyRecorded(bytes32 episodeKey)',
]

const provider = new JsonRpcProvider(config.rpc, 16602)
const signer = new Wallet(config.storageKey, provider)
const episodeLog = new Contract(config.episodeLog, EPISODE_LOG_ABI, signer)
const indexer = new Indexer(config.indexer)

const evidence = makeEvidenceApi(config.server, config.token)

/** Bytes to 0G Storage; the storage SDK returns the Merkle root and the flow submission tx. */
const store = async (bytes: Uint8Array) => {
  const data = new MemData(bytes)
  const [, treeError] = await data.merkleTree()
  if (treeError !== null) throw new Error(`merkle tree: ${treeError.message}`)
  const [result, uploadError] = await indexer.upload(data, config.rpc, signer)
  if (uploadError !== null) throw new Error(`0G Storage upload: ${uploadError.message}`)
  const stored =
    'rootHash' in result
      ? { rootHash: result.rootHash, storageTx: result.txHash }
      : { rootHash: result.rootHashes[0] ?? '', storageTx: result.txHashes[0] ?? '' }
  if (!/^0x[0-9a-fA-F]{64}$/.test(stored.rootHash) || !/^0x[0-9a-fA-F]{64}$/.test(stored.storageTx))
    throw new Error('0G Storage returned no root hash or no submission tx')
  return stored
}

const episodeKey = (episodeId: string) => keccak256(toUtf8Bytes(episodeId))

const recordedRoot = async (episodeId: string) => {
  const existing: unknown = await episodeLog.getFunction('records').staticCall(episodeKey(episodeId))
  if (!Array.isArray(existing) || BigInt(String(existing[3])) === 0n) return undefined
  return String(existing[0])
}

/** The tx of an earlier `record` (a previous run recorded it, then failed to report back): from its event. */
const earlierRecordTx = async (episodeId: string) => {
  const latest = await provider.getBlockNumber()
  const events = await episodeLog.queryFilter(
    episodeLog.filters.EpisodeRecorded?.(null, episodeKey(episodeId)) ?? 'EpisodeRecorded',
    Math.max(0, latest - 50_000),
    latest,
  )
  const hash = events.at(-1)?.transactionHash
  if (hash === undefined)
    throw new Error(`EpisodeLog recorded ${episodeId} but its tx is outside the last 50 000 blocks`)
  return hash
}

/** `EpisodeLog.record` once per episode: an episode already on chain is never sent twice. */
const record = async (episode: Pending, rootHash: string) => {
  const existing = await recordedRoot(episode.episodeId)
  if (existing !== undefined) {
    if (existing.toLowerCase() !== rootHash.toLowerCase())
      throw new Error(`EpisodeLog already holds another root for ${episode.episodeId}`)
    return earlierRecordTx(episode.episodeId)
  }
  const tx = await episodeLog.getFunction('record').send(episode.episodeId, rootHash, episode.requestIdsHash)
  const receipt = await tx.wait(1)
  if (receipt === null || receipt.status !== 1) throw new Error(`EpisodeLog.record reverted (${tx.hash})`)
  return tx.hash
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 400)

const sha256Hex = (bytes: Uint8Array) => `0x${createHash('sha256').update(bytes).digest('hex')}`

/** One frame: its exact bytes from R2, checked against the signed digest, to 0G Storage, then its root reported. */
const uploadFrame = async (episodeId: string, sha256: string) => {
  const bytes = await evidence.readFrame(episodeId, sha256)
  if (sha256Hex(bytes) !== sha256.toLowerCase()) throw new Error(`frame ${sha256} does not hash to its digest`)
  const stored = await store(bytes)
  const payloadJson = await evidence.markFrameUploaded(episodeId, sha256, stored)
  console.log(`frame ${episodeId}/${sha256} rootHash ${stored.rootHash} storageTx ${stored.storageTx}`)
  return payloadJson
}

type FrameRef = { readonly sha256: string; readonly rootHash?: string }

const isFrameRef = (entry: unknown): entry is FrameRef =>
  typeof entry === 'object' && entry !== null && 'sha256' in entry && typeof entry.sha256 === 'string'

/** The frames an episode's evidence JSON names, with their 0G root once they have one. */
const frameRefs = (payloadJson: string): FrameRef[] => {
  const parsed: unknown = JSON.parse(payloadJson)
  const observations: unknown =
    typeof parsed === 'object' && parsed !== null && 'observations' in parsed ? parsed.observations : []
  const entries: unknown[] = Array.isArray(observations) ? observations : []
  return entries.filter(isFrameRef)
}

/** The episode's frames not yet on 0G go first; the JSON to store is the one that names every frame's root. */
const withFramesOnZeroG = async (episode: Pending) => {
  let payloadJson = episode.payloadJson
  for (const frame of frameRefs(payloadJson).filter((entry) => entry.rootHash === undefined)) {
    const patched = await uploadFrame(episode.episodeId, frame.sha256)
    if (patched !== null) payloadJson = patched
  }
  return payloadJson
}

const uploadOne = async (episode: Pending) => {
  try {
    const payloadJson = await withFramesOnZeroG(episode)
    const { rootHash, storageTx } = await store(new TextEncoder().encode(payloadJson))
    const logTx = await record(episode, rootHash)
    await evidence.markUploaded(episode.episodeId, { rootHash, storageTx, logTx })
    console.log(`episode ${episode.episodeId} rootHash ${rootHash} storageTx ${storageTx} logTx ${logTx}`)
    return true
  } catch (error) {
    const reason = errorText(error)
    console.error(`episode ${episode.episodeId} failed: ${reason}`)
    await evidence
      .markFailed(episode.episodeId, reason)
      .catch((reportError: unknown) =>
        console.error(`episode ${episode.episodeId}: could not record the failure: ${errorText(reportError)}`),
      )
    return false
  }
}

/** Frames still without a root: errands from before frames went to 0G, or one whose frame upload failed. */
const backfillFrames = async () => {
  const frames = await evidence.pendingFrames()
  const results = []
  for (const frame of frames)
    results.push(
      await uploadFrame(frame.episodeId, frame.sha256).then(
        () => true,
        (error: unknown) => {
          console.error(`frame ${frame.episodeId}/${frame.sha256} failed: ${errorText(error)}`)
          return false
        },
      ),
    )
  return results.every(Boolean)
}

const drain = async () => {
  const pending = await evidence.claimPending()
  if (pending.length === 0) console.log('no pending evidence')
  const results = []
  for (const episode of pending) results.push(await uploadOne(episode))
  results.push(await backfillFrames())
  return results.every(Boolean)
}

console.log(`uploader ${signer.address} → EpisodeLog ${config.episodeLog} on 16602, server ${config.server}`)
if (config.once) process.exit((await drain()) ? 0 : 1)
for (;;) {
  await drain().catch((error: unknown) => console.error(`drain failed: ${errorText(error)}`))
  await Bun.sleep(config.intervalSeconds * 1000)
}
