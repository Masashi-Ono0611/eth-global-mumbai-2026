# 0G measurements for Vitaquack (decide call, uploader, Galileo)

Measured 2026-11-05 to 2026-11-06 (Masashi, from a separate 0G PoC) against the same 0G Router and Galileo this repo uses.
Everything here was run for real unless it is under "Not verified". Probe script: `docs/research/spikes/zg-decide-probe.mjs.txt`
(it copies `decideRequestBody` from `packages/server/src/robot/ZeroGClient.ts` byte for byte and posts it to several models;
run it with `node --env-file=<file with OG_ROUTER_API_KEY> zg-decide-probe.mjs`).

## 1. Decide call: which model, and one change to the request

Team request body as is (forced `decide` tool call, `temperature: 0`, structured input), 2 scenarios (chai → expect `pay`,
cigarettes → expect `ask_human`) x 2 repeats = 4 calls per model. **n = 4 per model: a smoke test, not a benchmark.**

| `APP_ZG_MODEL` | Verifiability (catalog) | Median / max latency | Correct | Note |
|---|---|---|---|---|
| `0gm-1.0-35b-a3b` | TeeML (TDX, dstack) | 6.3 s / 6.7 s | 4/4 | thinking is on by default |
| `0gm-1.0-35b-a3b` + `chat_template_kwargs: {"enable_thinking": false}` | TeeML | **3.2 s / 3.3 s** | 4/4 | **recommended** |
| `qwen3-vl-plus` | none flagged | 3.5 s / 3.7 s | 4/4 | good fallback, no extra field needed |
| `qwen3.8-flash` | none | 4.8 s / 9.0 s | 3/4 | 9.0 s is close to the 10 s timeout; with `enable_thinking: false` it was 2.2 s, 4/4 |
| `glm-5.3` | TeeML | **10.9 s / 12.0 s** | 4/4 | 2 of 4 calls exceeded the 10 s timeout, so the errand would `safe_stop`; with thinking off 3.4 s but 2/4 correct (`walk_away` instead of `ask_human`) |
| `deepseek-v4-flash-vision-exp` | none | 1.3 s | 0/4 | HTTP 400 "rejected by an internal MaaS component" for `tools` + forced `tool_choice` |

- **Proposal (not part of this PR; `decideRequestBody` is pinned by `ZeroGClient.test.ts` and spec §6):** `APP_ZG_BASE_URL=https://router-api.0g.ai/v1`, `APP_ZG_MODEL=0gm-1.0-35b-a3b`, and add
  `chat_template_kwargs: { enable_thinking: false }` to the body for that model. It halves the latency and keeps
  the "sealed inference" story. Keep `qwen3-vl-plus` as the second choice.
- **Availability warning (2026-11-06 06:45 UTC):** `0gm-1.0-35b-a3b` has **one provider** (`provider_count: 1`). It returned
  HTTP 502 `provider_error` on every call for several minutes and `/v1/providers?model=0gm-1.0-35b-a3b` reported
  `is_healthy: false`, while `qwen3-vl-plus` kept answering 200. A 502 ends the errand in `safe_stop`, as designed, but for
  the live demo keep `qwen3-vl-plus` ready as `APP_ZG_MODEL` and check `/v1/providers?model=...` (public, no key) first.
- Cost per decision: about **$0.00005 to $0.00015** (`x_0g_trace.billing.total_cost_usd_micro` 49 to 149). $5 of credit is
  tens of thousands of decisions.
- The reply carries `x_0g_trace.request_id` and `provider`. The `ZG-Res-Key` header (your `chatId`) was present for
  `0gm-1.0-35b-a3b` and absent for `qwen3-vl-plus`; `chat_id` being nullable is correct.
- **`tee_verified` is never in the trace**, even with `verify_tee: true` and `X-0G-Provider-Trust-Mode: private` (HTTP 200).
  The catalog flags `0gm-1.0-35b-a3b`, `glm-5.3` and `whisper-large-v3` as TeeML (9 TeeML models on 2026-11-06). Earlier
  on 2026-11-05 the catalog showed none, so it changes. **Do not write "TEE verified" in the submission** unless the
  `ZG-Res-Key` signature is checked independently (`broker.inference.processResponse`); we have not done that.
- The Router rejects `response_format: json_object` for some models (`qwen3.8-flash`: 400 `model_not_capable`). Your forced
  tool call avoids that problem.

## 2. Evidence uploader (`tools/evidence-uploader/main.ts`): one bug, rest consistent

- **Bug (fixed in this PR):** `uploadOne` reports a failure with `api('/api/evidence/<id>/failed', { method: 'POST', body: JSON.stringify({ error }) })`,
  but `api(path, body)` takes the body itself and stringifies it. The server receives
  `{"method":"POST","body":"{\"error\":\"boom\"}"}` (reproduced with a fake `fetch`), which has no top-level `error`, so
  `/failed` answers 400. The `.catch(() => undefined)` hides it. Effect: a failed episode stays `uploading` until the
  300 s reclaim, and the error text is never stored. Fix: `api(path, { error: reason })`.
- Checked and consistent: upload via `MemData` → `merkleTree()` → `indexer.upload(data, rpc, signer)` returns
  `{ rootHash, txHash }` (we use the same call); `requestIdsHash = keccak256(utf8(requestIds.join(',')))` matches
  `EpisodeLog.record`; skipping `record` when the episode is already on chain is the right idempotence.
- SDK pitfalls we hit: `@0gfoundation/0g-storage-ts-sdk` 1.2.13 needs **exactly `ethers@6.13.1`** (6.17 gives an npm
  ERESOLVE); the SDK needs Node (it imports `fs`/`crypto`), so the uploader cannot run in Workers.

## 3. 0G Storage and 0G Chain on Galileo: proven path

- Galileo chain id 16602, RPC `https://evmrpc-testnet.0g.ai`, turbo indexer `https://indexer-storage-testnet-turbo.0g.ai`.
- Real episodes uploaded, downloaded with `indexer.download(root, path, true)` (Merkle proof checked), root recomputed from
  the bytes, and compared with the on-chain record. Example (41 real 0G decisions): root
  `0xff51b8d65e9437f1f93d8a5919d497af61a6a9be90d147eb2eb30d690242ce36`, storage tx `0x88353202…794a`, registry tx
  `0xf3a1b9f7…8382`. Anyone can fetch that root with the SDK without a key.
- A contract compiled with `solc 0.8.24`, `evm_version = paris` deployed and ran on Galileo (our `EpisodeRegistry` at
  `0xC8BE29f9238b6A1194CFa3E43c4FC56c37D86Ac4`, similar to your `EpisodeLog`). Your `paris` + solc 0.8.23 setup is the same
  class, so `DeployZg.s.sol` should work.
- Faucet: the event link `https://faucet.0g.ai/?promo=ETHMUMBAI-26` works; the plain faucet had a cooldown. A private
  browser window was needed once.

## 4. Not verified

- TEE verification of a response (see section 1).
- 0G audio: `whisper-large-v3` is back in the catalog (TeeML) but we did not retry it; all 6 `minimax-speech` models
  returned upstream 401 on 2026-11-05.
- Your `tools/evidence-uploader` itself was not run (we only read it).
- The gas an upload plus `record` costs on Galileo: not measured.

## 5. Changes in this PR

- This document and `docs/research/spikes/zg-decide-probe.mjs.txt`.
- `tools/evidence-uploader/main.ts`: the `/failed` report sends `{ error }` (one line). Not run against a live server; the shape
  was reproduced with a fake `fetch` (see section 2).
- Not changed: `decideRequestBody` / `APP_ZG_MODEL` (your call; see the proposal in section 1).
