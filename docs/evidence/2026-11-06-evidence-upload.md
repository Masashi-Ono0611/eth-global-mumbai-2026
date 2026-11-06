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

# First real-0G decisions on 0G Storage + EpisodeLog — 2026-11-06 12:43–12:45 IST

Release `563edcb` (router brain live). Three `--once` runs of the uploader drained the whole backlog: 26 episodes, 0
failures, then `no pending evidence`. The run logs contain no storage key, evidence token or 0G API key (checked
mechanically). The uploader wallet went from ≈ 2.49 to 2.446 0G.

**7 of the 26 were decided by 0G Compute.** Each decision's `provider` reads
`router-api.0g.ai/qwen3-vl-plus@0x000000003f486c7198d6203568a98d02b91f8044` (the 0G router and the provider it routed
to), and each `requestId` is the router's `x_0g_trace.request_id`. These are the episodes of browser run 7
(`2026-11-06-deployed-browser.md`) and e2e runs 9–10 (`2026-11-06-deployed-e2e.md`). World was the stub issuer in
all of them (rehearsal), so "approved"/"denied" below is the stub's answer.

| Episode | Item → errand | 0G decision → outcome (router request id, latency) | Arc tx / approval | 0G Storage root | Storage tx | EpisodeLog.record tx |
| --- | --- | --- | --- | --- | --- | --- |
| `aln2b7m3chuuohzpm4iynkirgm` | chai → paid | pay → paid (`5ca4a212-1beb-4243-adc7-158156e7c9f4`, 2647 ms) | [`0xa18da6c6…814a`](https://explorer.arc.io/tx/0xa18da6c6aa0b5963839d53133c72dc0e75616450779e534efedc6d687090814a) | `0xac43d8a46ecd28fe0596599298630594626b40719f051e99742b59f81a4d82dd` | [`0x9e6e5b92…ba02`](https://chainscan-galileo.0g.ai/tx/0x9e6e5b92305260a5497333564ea31fbce6af8083b913270c974fefa837e6ba02) | [`0xd5b631b8…261b`](https://chainscan-galileo.0g.ai/tx/0xd5b631b87c388563d4fb750194149b8a24cab2af323c1e34224611e9fb38261b) |
| `uekjj7u4g3zsokmc2b3svt3wmu` | cigarettes → paid | ask_human → paid (`d230ef16-35ed-4e03-96cf-4ac173b9d21d`, 1974 ms) | [`0xedeaf0e0…0548`](https://explorer.arc.io/tx/0xedeaf0e06604c93a226f731a7499a9be7096813f209d6bac9ff96a8cb0790548), approval `odbm4gosmsbdt3qx6b2rgjklni` | `0x941e7adfa960247dc765b5eff426fd80200ae0670d0219e1532be9f758626b75` | [`0x2ab2c473…b5fa`](https://chainscan-galileo.0g.ai/tx/0x2ab2c47329a3fdf9db50a1b491375c0e832c1a32991f808e528aa5efcd10b5fa) | [`0xb3356c6d…cf09`](https://chainscan-galileo.0g.ai/tx/0xb3356c6d0a3d79df4e2f51923b7bbad09c678b37c5f5d8ae66830e305302cf09) |
| `k7gpiroqimjxhl3u2cle5zyh3a` | cigarettes → denied | ask_human → denied (`7dcb97bb-f577-433f-a7b6-60e5aa8cdd64`, 2419 ms) | nothing signed or paid | `0x0ab938dc1a356cb9a90356a67d7a66f90e9ef82af563a4e0f576e547037afe90` | [`0xf2103a96…3f92`](https://chainscan-galileo.0g.ai/tx/0xf2103a966a5bf724318c62f48057f9770bbca340504988851df28128b6633f92) | [`0xc9e84b22…a4b0`](https://chainscan-galileo.0g.ai/tx/0xc9e84b222e6e99a5a62b9482c759bb47ee9a51a9f3c2ff45c639b66302d2a4b0) |
| `h2ldvuf3ytnskmcos2nagzadfm` | chai after revoke → failed | pay → failed (`1b6b2840-b760-4421-9d1e-163e58160f37`, 2038 ms) | refused by Arc (`CannotUseADisabledDelegation`, run 7) | `0xd2f8a83b853758f493a1f6d44514a08afb5f1c81f7d1a53ab393f389dc5bbf0c` | [`0x2a36f9fe…e618`](https://chainscan-galileo.0g.ai/tx/0x2a36f9feffc56364b99787b61555199482e0cd05850cd00856bdbdade450e618) | [`0x9076d513…c5f`](https://chainscan-galileo.0g.ai/tx/0x9076d513c71e1382f7e3f6bc8ee6d22fb1c510dc18885a5d36ddf113353adc5f) |
| `64xccb53sv3stqqbecpeiy5g2q` | chai → paid (gate paid → used) | pay → paid (`642ed186-c4ba-422d-8f20-128ce8381da0`, 3766 ms) | [`0xd8d27c74…0f0b`](https://explorer.arc.io/tx/0xd8d27c74839180841d8a31b5c775524fa46a03d3694ffe400f42d021e7ba0f0b) | `0x8ed68e4a1e5980db1aa9f2cba8394ee334756ad2bf72747fcafa7fda00479388` | [`0xf484926b…a9d6`](https://chainscan-galileo.0g.ai/tx/0xf484926b66d7900c99bbfcf245236ab121b885433f929297a235850fb9a0a9d6) | [`0x57709be3…58b7`](https://chainscan-galileo.0g.ai/tx/0x57709be312ad4f0c82df1eee235fb92d6116f42e901d37ad6815f18ce5d958b7) |
| `cjdyozc77efciakfbk3mb4mnim` | cigarettes → paid | ask_human → paid (`3cf1326d-45da-45b7-9c67-b3f4e5eaa9c8`, 2076 ms) | [`0x33f30e0f…42b3`](https://explorer.arc.io/tx/0x33f30e0f6abeec0fa42faeacf8c5d81812f787788a1646a79a2b377d23aa42b3), approval `6povd4yqj4nk75wsmjdz5wrg2m` | `0x4789bd49158740d5263a59ae470f64f40292711fbdb65c1588344bd484819c08` | [`0x648cc99f…0656`](https://chainscan-galileo.0g.ai/tx/0x648cc99fceababca35580d260a43b9d9a94a2b8d2decd72e74b0662037c20656) | [`0xc12c2c9b…6e70`](https://chainscan-galileo.0g.ai/tx/0xc12c2c9bb94ecd5a7e0a913945c86f414834457d62dcc99fdc2ec74b64376e70) |
| `ipgyznpi5pjkx4dbbcdn72djcu` | cigarettes → denied | ask_human → denied (`0a5aa416-55c3-4767-a231-ea6b60975f2c`, 1888 ms) | nothing signed or paid | `0x296f3f5fce10170815fb7d599d0c1ab912a162a5d5c697d063a25e5fe45bb354` | [`0x2ef72a5c…858f`](https://chainscan-galileo.0g.ai/tx/0x2ef72a5c32e33327f4957aaa430155e5b6b67926fdaf8ab6d86177f6b973858f) | [`0x11836df1…1baf`](https://chainscan-galileo.0g.ai/tx/0x11836df19a4cf614bb10c701bf11fa00fbf6c98fb56581eaa6e201ef3f8e1baf) |

Checks, for each of the seven:
- `GET $APP/api/evidence/<id>` → `status: "uploaded"` with the three values above.
- On Galileo, `EpisodeLog.records(keccak256(id))` holds that root. Its `requestIdsHash` equals `keccak256(<router request id>)`, recomputed. Both transactions have status 1 (blocks 64127927–64128178).
- `Indexer.download(root)` from the turbo indexer, with proof, returns exactly the payload the app serves.
- **`decisions[0].outcome` is populated** (`paid`, `denied`, `failed`) in every one: the `4d4d1fc` ordering fix is
  deployed. Uploaded at 12:43:08–12:45:02 IST.

## The other 19 (rehearsal brain, labelled)

19 more episodes, uploaded in the same runs, were decided by the **LiteLLM rehearsal brain**, not 0G. Their `provider`
reads `litellm-production-f53d.up.railway.app/deepseek-v4.1-flash` and their request ids are `chatcmpl-…`: 6 paid,
1 failed, 7 walked away, 1 denied and 4 safe_stop (undecodable answers, before `563edcb`). They are on 0G Storage and
in `EpisodeLog` like the others, and their JSON names the brain. One of them, `z4ttr5zmvvkwx7is3kzmoriaaq`, predates
the fix and shows `outcome: null`, like the first upload above. Per-episode roots and transactions:
`GET $APP/api/evidence/<id>`.
