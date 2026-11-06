# Evidence uploader

Uploads the Worker's finished errands (episodes) to 0G Storage and records each one in `EpisodeLog` on 0G Chain
(Galileo, chain id 16602), as spec §6 describes. It runs on netcup, outside Cloudflare, so the Worker never holds the
storage key. Uploaded episodes appear on the public proof pages at <https://vitaquack.com/app/proofs>.

```bash
heavy --wait bun tools/evidence-uploader/main.ts --once --server https://<app origin>   # one pass, exit 1 if any failed
bun tools/evidence-uploader/main.ts --server https://<app origin> --interval 15         # keep draining
```

For each pending episode it prints one line, `episode <id> rootHash <0x…> storageTx <0x…> logTx <0x…>`. After that,
`GET <server>/api/evidence/<id>` returns the same values.

## Running on netcup

Since 7 Nov 2026 the uploader runs as the systemd service `vitaquack-evidence-uploader` on netcup, from this
checkout (`~/code/eth-global-mumbai-2026`, user `kristjan`). The unit file is
[`vitaquack-evidence-uploader.service`](vitaquack-evidence-uploader.service) and starts with the box. Before that it
was started by hand in a terminal, and on 6 Nov it hung for 2 h when a reverted 0G Storage tx left the SDK waiting.

```bash
systemctl status vitaquack-evidence-uploader          # running?
journalctl -u vitaquack-evidence-uploader -f          # live log (one line per episode / frame)
sudo systemctl restart vitaquack-evidence-uploader    # after changing main.ts
# install or update the unit:
sudo install -m 644 tools/evidence-uploader/vitaquack-evidence-uploader.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now vitaquack-evidence-uploader
```

- Any exit restarts it after 10 s. A 0G Storage upload that runs past 4 minutes makes it exit on purpose (code 3),
  because the SDK's wait cannot be cancelled. The Worker hands the unfinished claim out again after 5 minutes.
- It runs the working tree as it is, so a restart picks up whatever is on disk in this checkout.
- Secrets are read from `.env.main.local` (see Configuration). Nothing secret is in the unit file or the journal.

## What it does

1. `GET /api/evidence/pending` (bearer `APP_EVIDENCE_TOKEN`) claims up to 10 episodes (`pending`, retryable `failed`,
   or `uploading` for more than 5 minutes).
2. Uploads each of the episode's chip-signed camera frames that has no 0G root yet: `GET
   /api/evidence/<id>/frames/<sha256>` (the exact JPEG bytes from R2, re-hashed against the signed digest), the bytes
   to 0G Storage unchanged (plain and public by root, as proof of the robot's work), then `POST
   /api/evidence/<id>/frames/<sha256> {rootHash, storageTx}`. The Worker answers with the episode JSON, which now has
   that root in its `observations[]`. Step 3 uploads that JSON.
3. Uploads the episode JSON (`{episodeId, robotId, item, decisions[], outcome, requestIds[]}`) with
   `@0gfoundation/0g-storage-ts-sdk` 1.2.13 (`MemData` → `Indexer.upload`, turbo indexer) and keeps the Merkle root and
   the flow submission tx.
4. Calls `EpisodeLog.record(episodeId, rootHash, requestIdsHash)`, unless `records(keccak256(episodeId))` already holds
   it (then the earlier tx is looked up from its `EpisodeRecorded` event; a different root is an error, never a second
   record).
5. `POST /api/evidence/<id>/uploaded {rootHash, storageTx, logTx}`. On any error it sends `POST
   /api/evidence/<id>/failed {error}`, and the episode is retried up to 5 attempts.
6. Backfill: `GET /api/evidence/frames/pending` lists frames still without a root (errands from before frames went to
   0G, or a failed frame upload) and uploads them the same way. An episode already on 0G keeps its anchored JSON, and
   the root is recorded on the frame only. Per frame it prints `frame <episodeId>/<sha256> rootHash <0x…> storageTx <0x…>`.

Anyone can download a frame by root: `https://indexer-storage-testnet-turbo.0g.ai/file?root=<rootHash>`.

## Configuration

Values are read from the repo root's `.env.main.local` (mode 600), then the process environment. A value of
`pending` counts as missing. A missing required value stops the uploader with `not configured: <NAME>` before anything
is uploaded.

| Name                                                                                                                      | Required | Default                                       |
| ------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------- |
| `--server` / `EVIDENCE_SERVER_URL`                                                                                        | yes      | none                                          |
| `APP_EVIDENCE_TOKEN` (or `EVIDENCE_TOKEN`)                                                                                | yes      | none                                          |
| `APP_ZG_STORAGE_PRIVATE_KEY` (or `ZG_STORAGE_PRIVATE_KEY`): a Galileo account with gas for storage fees and the record tx | yes      | none                                          |
| `APP_EPISODE_LOG_ADDRESS` (or `EPISODE_LOG_ADDRESS`)                                                                      | yes      | none                                          |
| `ZG_STORAGE_INDEXER`                                                                                                      | no       | `https://indexer-storage-testnet-turbo.0g.ai` |
| `ZG_CHAIN_RPC`                                                                                                            | no       | `https://evmrpc-testnet.0g.ai`                |

The token and the key are never printed. Explorers: roots on <https://storagescan-galileo.0g.ai>, transactions on
<https://chainscan-galileo.0g.ai>.
