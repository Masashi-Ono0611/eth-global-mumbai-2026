# First episode on 0G Storage + EpisodeLog — 2026-11-06 12:06 IST

| | |
| --- | --- |
| Release | `636993bc058106e91c99ff4dc2525ffd5465bcdd` (`GET /api/health`) |
| App | <https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev> (`$APP`) |
| EpisodeLog (0G Galileo, 16602) | `0x4C947E6D794C78d0F684e46EFC97f712E51a206A` ([chainscan](https://chainscan-galileo.0g.ai/address/0x4C947E6D794C78d0F684e46EFC97f712E51a206A)) |
| Uploader / storage signer | `0xc6fF8A666f4C7F674C1D129C73b46D61f2891fcD` (`APP_ZG_STORAGE_PRIVATE_KEY`, netcup only) |
| Storage | Galileo turbo indexer `https://indexer-storage-testnet-turbo.0g.ai`, `@0gfoundation/0g-storage-ts-sdk` 1.2.13 |

**The brain was not 0G.** The episode's only decision was made by the labelled rehearsal brain (Kris's LiteLLM, DeepSeek
v4.1 flash): its `provider` field says `litellm-production-f53d.up.railway.app/deepseek-v4.1-flash`. A decision made
on 0G Compute would read `router-api.0g.ai/<model>` or a provider host. What is on 0G here is the **evidence**: the
episode JSON on 0G Storage and its anchor in `EpisodeLog` on 0G Chain.

## Run

```
$ heavy --wait bun tools/evidence-uploader/main.ts --once --server $APP
uploader 0xc6fF8A666f4C7F674C1D129C73b46D61f2891fcD → EpisodeLog 0x4C947E6D794C78d0F684e46EFC97f712E51a206A on 16602, server $APP
… (SDK log) File details - size: 774, numSegments: 1, numChunks: 4
… Submitting transaction with storage fee: 122934579848n
… Tasks created: txSeq 158987 … All tasks processed … Single file upload completed
episode hg2ouddwe2h5j6ekbrsn7grfja rootHash 0x8db4ffc168fc95f364564ab7bee5616090c0b32affd05337ef8f53de222bd5dd storageTx 0x87d1be1ff30212e07ca16aad10d05741422195d5e60f86b137b9449fa99012dc logTx 0xd2fe9e754583c1edd924e322eac76f3976d18d5d9832114c2aa4a1f8cef3aa21
exit 0
```

The run log was checked for the storage key, the evidence token and the 0G API key: none of them appear.

| | |
| --- | --- |
| Episode | `hg2ouddwe2h5j6ekbrsn7grfja` (robot `263eomvmnk2mwdrqbtnebtouni`, "buy chai", state `paid`) |
| Arc payment the episode records | [`0xbbc3b0712715d245b5478f1f539d1503ec64041424b0ad4767c3a8474cdb56b7`](https://explorer.arc.io/tx/0xbbc3b0712715d245b5478f1f539d1503ec64041424b0ad4767c3a8474cdb56b7) |
| Decision request id (= chat id) | `chatcmpl-724ca39b-f7ec-4868-adc5-55a2d82c1876` (LiteLLM's; no 0G trace id) |
| requestIdsHash | `0x573d34b584bdee8277c36b4be8a37be265a79b66b7d145dcd448f0d92a5c4dee` = `keccak256("chatcmpl-724ca39b-f7ec-4868-adc5-55a2d82c1876")` (recomputed) |
| 0G Storage root | `0x8db4ffc168fc95f364564ab7bee5616090c0b32affd05337ef8f53de222bd5dd`, 774 bytes, submission [158987](https://storagescan-galileo.0g.ai/submission/158987) |
| Storage tx | [`0x87d1be1f…12dc`](https://chainscan-galileo.0g.ai/tx/0x87d1be1ff30212e07ca16aad10d05741422195d5e60f86b137b9449fa99012dc): status 1, block 64123466, to the flow contract `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296`, gas 308 579, storage fee 122 934 579 848 neuron |
| `EpisodeLog.record` tx | [`0xd2fe9e75…aa21`](https://chainscan-galileo.0g.ai/tx/0xd2fe9e754583c1edd924e322eac76f3976d18d5d9832114c2aa4a1f8cef3aa21): status 1, block 64123479, gas 93 545 |
| Recorded at | 1793947010 (12:06:50 IST); `uploadedAt` in the app 12:06:58 IST |

## Checks

- `curl $APP/api/evidence/hg2ouddwe2h5j6ekbrsn7grfja` → `status: "uploaded"`, `rootHash`, `storageTx`, `logTx` as
  above, `attempts: 1`, and the payload.
- `EpisodeLog.records(keccak256("hg2ouddwe2h5j6ekbrsn7grfja"))` on Galileo →
  `{rootHash: 0x8db4ffc1…d5dd, requestIdsHash: 0x573d34b5…4dee, recorder: 0xc6fF…1fcD, recordedAt: 1793947010}`.
- `Indexer.download(0x8db4ffc1…d5dd)` from the turbo indexer, with proof → 774 bytes, **byte-for-byte the JSON the app
  serves as the payload** (parsed and re-serialised, then compared: equal).

## The stored episode (as uploaded; immutable)

```json
{"episodeId":"hg2ouddwe2h5j6ekbrsn7grfja","robotId":"263eomvmnk2mwdrqbtnebtouni","item":"chai",
 "decisions":[{"step":1,"model":"deepseek-v4.1-flash","requestId":"chatcmpl-724ca39b-f7ec-4868-adc5-55a2d82c1876",
   "chatId":"chatcmpl-724ca39b-f7ec-4868-adc5-55a2d82c1876",
   "provider":"litellm-production-f53d.up.railway.app/deepseek-v4.1-flash","latencyMs":1882,
   "promptSha256":"e4cdd4f4d599621d7ef8f491655b6cdf8444966b3e007035a08ea4183255803c","action":"pay",
   "reason":"Payee allowlisted, merchant trusted, no approval required, amount 100000 is within per-payment cap and remaining daily budget.",
   "outcome":null}],
 "outcome":{"state":"paid","txHash":"0xbbc3b0712715d245b5478f1f539d1503ec64041424b0ad4767c3a8474cdb56b7"},
 "requestIds":["chatcmpl-724ca39b-f7ec-4868-adc5-55a2d82c1876"]}
```

Known defect in this one record: the decision's `outcome` is `null` although the episode is `paid`. The Worker built
the evidence when the errand entered `paid`, one statement before it wrote the decision's outcome. Fixed after this
upload in `4d4d1fc`: the decision outcome is now written before the evidence is built, with a native assertion. Later episodes
carry `"outcome":"paid"`. The episode's own `outcome.state` and `txHash` were right in this one too.
