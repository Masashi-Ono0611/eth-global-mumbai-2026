# 0G readiness for the Physical AI prize: model choice, TEE verification, evidence

Measured 2026-11-06 06:30 to 07:15 UTC (12:00 to 12:45 IST) by Masashi against the same 0G Router and Galileo this repo uses. Everything below
was run for real unless it is listed under "Not verified". Scripts are in `docs/research/spikes/` (`zg-*.mjs.txt`); they
copy the request from `packages/server/src/robot/ZeroGClient.ts` at `main` of 2026-11-06 07:00 UTC (the decision-table
prompt and `promptInput`), checked string for string.

## 1. Prize checklist against what exists now (updated 2026-11-06 07:40 UTC)

| "Must show" (0G Physical AI) | State |
|---|---|
| A 0G call inside the decision loop | **Done.** Runs 7 and 9-10 on the deployed app decided through `router-api.0g.ai` (`qwen3-vl-plus`), with the router's `x_0g_trace.request_id` per decision. |
| An episode log on 0G Storage with a request id per decision | **Done, and re-verified independently** for all 7 real-0G episodes (`aln2b7m3…`, `uekjj7u4…`, `k7gpiroq…`, `h2ldvuf3…`, `64xccb53…`, `cjdyozc7…`, `ipgyznpi…`): per episode, the public `GET /api/evidence/:id` is `uploaded`; its root equals `EpisodeLog.records` on Galileo; the bytes downloaded from 0G Storage with the Merkle proof equal the app's payload; `keccak256(requestIds.join(","))` equals the on-chain `requestIdsHash`; every decision's provider starts with `router-api.0g.ai/` and every request id is a router UUID; the recorder is the uploader. 8 of 8 checks pass for all 7. Negative control: the rehearsal-brain episode `hg2ouddwe2h5j6ekbrsn7grfja` fails the two 0G checks. Script: `docs/research/spikes/zg-verify-episodes.mjs.txt`. |
| A replayable simulation, or a live hardware demo at the 0G booth | Not checked here. The prize text says simulated builds are eligible for every place except the hardware one; the submission should say which of the two we show. |
| A safe-stop fallback if 0G is unreachable (never a faked decision) | Proven against a stub (`RobotAcceptance.ts`) and seen live in the rehearsal runs (5 `safe_stop`). `0gm-1.0-35b-a3b` answering 502 (section 2) is a natural live example. |
| Contract deployment addresses | `EpisodeLog` `0x4C947E6D794C78d0F684e46EFC97f712E51a206A` (Galileo). Explorer source verification not done (optional). |

**The one 0G upgrade left:** the live model `qwen3-vl-plus` cannot carry a TEE claim (its provider is not a registered 0G
service). Setting `APP_ZG_MODEL=glm-5.3` and running one chai and one cigarettes errand would give episodes whose
decisions verify independently in a TEE (section 3), which we can check from outside with the same scripts.

## 2. Which `APP_ZG_MODEL`: measured with the current prompt

4 scenarios (chai → `pay`, restricted cigarettes → `ask_human`, wrong item → `walk_away`, untrusted merchant → `walk_away`),
the team's request body unchanged, reply read like `DecideReply.ts`, a reply over 10 s counted as `safe_stop`.

| Model | Verifiability | Correct | Median / p95 / max latency | safe_stop | Cost per decision |
|---|---|---|---|---|---|
| **`glm-5.3`** | **TeeML, independently verified (section 3)** | **60/60** | 4.1 s / 6.3 s / 6.9 s | 0 | about $0.001 |
| `qwen3-vl-plus` | none (provider not in the 0G service registry) | 60/60 | 2.0 s / 2.7 s / 3.8 s | 0 | about $0.0002 |
| `qwen3.8-flash` | none | 19/20 | 3.6 s / 5.1 s / 5.1 s | 1 (no `decide` call) | about $0.00025 |
| `0gm-1.0-35b-a3b` | TeeML (catalog) | 0/40 | - | **40 (HTTP 502)** | - |

- **Recommendation: `APP_ZG_MODEL=glm-5.3`.** It is the only model that is both reliable with the current prompt and
  verifiably sealed. The worst latency seen (6.9 s) leaves about 3 s under the 10 s timeout. Keep `qwen3-vl-plus` as the
  fallback if latency becomes a problem; it is faster but carries no TEE claim.
- **Avoid `0gm-1.0-35b-a3b` for the demo.** It has one provider; `/v1/providers` reported it healthy while every call
  returned 502.
- Earlier numbers in this file (old one-line prompt) are superseded. With that prompt `glm-5.3` took 10.9 s median and
  missed the 10 s timeout twice in four calls; the decision-table prompt fixed both speed and accuracy.

## 3. TEE: independent verification works for `glm-5.3`

- The router trace never contains `tee_verified`, even with `verify_tee: true`. The independent path does work:
  `broker.inference.processResponse(x_0g_trace.provider, ZG-Res-Key)` from `@0gfoundation/0g-compute-ts-sdk` 0.9.0, with a
  **random, unfunded wallet** on `https://evmrpc.0g.ai`. No deposit or ledger was needed.
- Results: 4 of 4 real `decide` calls on `glm-5.3` (one per scenario) returned `true`; two `glm-5.3` chat ids re-checked
  2 to 3 minutes later still returned `true`; a made-up chat id returned "getting signature error" (negative control);
  `qwen3-vl-plus` returned "Service provider does not exist" (its provider is not a registered 0G service, so it cannot
  carry a TEE claim).
- The Worker already stores `provider` and `chat_id` per decision, which is everything the check needs.
- **Proposal:** run `processResponse` for each decision in `tools/evidence-uploader` (Node, outside Workers) and put
  `teeVerified: true | false | null` next to each decision in the episode JSON before upload, or ship it as a separate
  checker that anyone can run against `GET /api/evidence/:id`. Only then can the submission say "decisions run in a TEE
  and were verified independently". Today it may only say the model is TeeML.

## 4. Evidence uploader (`tools/evidence-uploader/main.ts`)

- **Bug (already fixed on `main` in `e01d8765`, 07:03 UTC):** the `/failed` report passed `{ method, body }` into `api(path, body)`, so the server received
  `{"method":"POST","body":"{\"error\":\"…\"}"}`, had no top-level `error`, and answered 400 (hidden by the `.catch`). A
  failed upload stayed `uploading` until the 300 s reclaim and its error was never stored. Reproduced with a fake `fetch`.
- Consistent: `MemData` → `merkleTree()` → `indexer.upload` returning `{ rootHash, txHash }`; the `requestIdsHash` rule;
  skipping `record` when the episode is already on chain.
- SDK pitfalls: the storage SDK 1.2.13 needs exactly `ethers@6.13.1`, and Node (not Workers).

## 5. Not verified

- `processResponse` inside the Worker runtime (only tried in Node).
- How long a provider keeps a signature retrievable beyond a few minutes.
- The replay or hardware part of the demo.
