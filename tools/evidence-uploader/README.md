# Evidence uploader

Drains the Worker's finished errands (episodes) to **0G Storage** and records each one in **`EpisodeLog`** on 0G Chain
(Galileo, chain id 16602), as spec §6 describes. It runs on netcup, outside Cloudflare: the Worker never holds the
storage key.

```bash
heavy --wait bun tools/evidence-uploader/main.ts --once --server https://<app origin>   # one pass, exit 1 if any failed
bun tools/evidence-uploader/main.ts --server https://<app origin> --interval 15         # keep draining
```

Per pending episode it prints one line: `episode <id> rootHash <0x…> storageTx <0x…> logTx <0x…>`, then
`GET <server>/api/evidence/<id>` shows the same values.

## What it does

1. `GET /api/evidence/pending` (bearer `APP_EVIDENCE_TOKEN`) claims up to 10 episodes (`pending`, retryable `failed`,
   or `uploading` for more than 5 minutes).
2. Uploads each of the episode's chip-signed camera frames that has no 0G root yet: `GET
   /api/evidence/<id>/frames/<sha256>` (the exact JPEG bytes from R2, re-hashed against the signed digest), the bytes
   to 0G Storage as they are (plain, public by root: proof of the robot's work), then `POST
   /api/evidence/<id>/frames/<sha256> {rootHash, storageTx}`; the Worker answers the episode JSON with that root in its
   `observations[]`, and that JSON is what step 3 uploads.
3. Uploads the episode JSON (`{episodeId, robotId, item, decisions[], outcome, requestIds[]}`) with
   `@0gfoundation/0g-storage-ts-sdk` 1.2.13 (`MemData` → `Indexer.upload`, turbo indexer) and keeps the Merkle root and
   the flow submission tx.
4. Calls `EpisodeLog.record(episodeId, rootHash, requestIdsHash)`, unless `records(keccak256(episodeId))` already holds
   it (then the earlier tx is looked up from its `EpisodeRecorded` event; a different root is an error, never a second
   record).
5. `POST /api/evidence/<id>/uploaded {rootHash, storageTx, logTx}`; on any error `POST /api/evidence/<id>/failed
   {error}` (retried up to 5 attempts).
6. Backfill: `GET /api/evidence/frames/pending` lists frames still without a root (errands from before frames went to
   0G, or a failed frame upload) and uploads them the same way; an episode already on 0G keeps its anchored JSON, the
   root goes onto the frame only. Per frame it prints `frame <episodeId>/<sha256> rootHash <0x…> storageTx <0x…>`.

Anyone can download a frame by root: `https://indexer-storage-testnet-turbo.0g.ai/file?root=<rootHash>`.

## Configuration

Read from the repo root's `.env.main.local` (mode 600), then the process environment. Values `pending` count as
missing; a missing required value stops the uploader with `not configured: <NAME>` and nothing is uploaded.

| Name                                                                                                                      | Required | Default                                       |
| ------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------- |
| `--server` / `EVIDENCE_SERVER_URL`                                                                                        | yes      | —                                             |
| `APP_EVIDENCE_TOKEN` (or `EVIDENCE_TOKEN`)                                                                                | yes      | —                                             |
| `APP_ZG_STORAGE_PRIVATE_KEY` (or `ZG_STORAGE_PRIVATE_KEY`): a Galileo account with gas for storage fees and the record tx | yes      | —                                             |
| `APP_EPISODE_LOG_ADDRESS` (or `EPISODE_LOG_ADDRESS`)                                                                      | yes      | —                                             |
| `ZG_STORAGE_INDEXER`                                                                                                      | no       | `https://indexer-storage-testnet-turbo.0g.ai` |
| `ZG_CHAIN_RPC`                                                                                                            | no       | `https://evmrpc-testnet.0g.ai`                |

The token and the key are never printed. Explorers: roots on <https://storagescan-galileo.0g.ai>, transactions on
<https://chainscan-galileo.0g.ai>.
