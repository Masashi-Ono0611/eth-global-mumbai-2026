# 0G readiness for the Physical AI prize: model choice, TEE verification, evidence

Measured 2026-11-06 06:30 to 07:15 UTC (12:00 to 12:45 IST) by Masashi against the same 0G Router and Galileo this repo uses. Everything below
was run for real unless it is listed under "Not verified". Scripts are in `docs/research/spikes/` (`zg-*.mjs.txt`); they
copy the request from `packages/server/src/robot/ZeroGClient.ts` at `main` of 2026-11-06 07:00 UTC (the decision-table
prompt and `promptInput`), checked string for string.

## 1. Prize checklist against what exists now

| "Must show" (0G Physical AI) | State on 2026-11-06 07:15 UTC |
|---|---|
| A 0G call inside the decision loop | Code ready. **Not yet observed on the deployed app**: the only uploaded episode was decided by the rehearsal brain. A team Router key has been handed over; the next step is `APP_ZG_*` on the Worker, then `zg-probe.ts` and `e2e-deployed.ts`. |
| An episode log on 0G Storage with a request id per decision | Path proven. Episode `hg2ouddwe2h5j6ekbrsn7grfja` re-verified independently: `EpisodeLog.records` on Galileo, download of root `0x8db4ffc1…d5dd` with proof (774 bytes, same episode id), `keccak256(requestIds.join(","))` equal to the on-chain `requestIdsHash`. Its decision provider is LiteLLM, so it shows storage, not a 0G decision. |
| A replayable simulation, or a live hardware demo at the 0G booth | Not checked here. The prize text says simulated builds are eligible for every place except the hardware one; the submission should say which of the two we show. |
| A safe-stop fallback if 0G is unreachable (never a faked decision) | Proven against a stub (`RobotAcceptance.ts`). A live example exists for free: `0gm-1.0-35b-a3b` answered HTTP 502 for every call at 06:45 and again from 07:05 to 07:14 UTC (section 2), which the errand turns into `safe_stop`. |
| Contract deployment addresses | `EpisodeLog` `0x4C947E6D794C78d0F684e46EFC97f712E51a206A` (Galileo). Explorer source verification not done (optional). |

"Not wanted: 0G used only for logs." Until a 0G-decided episode is uploaded, that is exactly what the evidence shows.

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

- **Bug (fixed in this PR):** the `/failed` report passed `{ method, body }` into `api(path, body)`, so the server received
  `{"method":"POST","body":"{\"error\":\"…\"}"}`, had no top-level `error`, and answered 400 (hidden by the `.catch`). A
  failed upload stayed `uploading` until the 300 s reclaim and its error was never stored. Reproduced with a fake `fetch`.
- Consistent: `MemData` → `merkleTree()` → `indexer.upload` returning `{ rootHash, txHash }`; the `requestIdsHash` rule;
  skipping `record` when the episode is already on chain.
- SDK pitfalls: the storage SDK 1.2.13 needs exactly `ethers@6.13.1`, and Node (not Workers).

## 5. Not verified

- A 0G decision on the deployed Worker (needs the key in `APP_ZG_*`).
- `processResponse` inside the Worker runtime (only tried in Node).
- How long a provider keeps a signature retrievable beyond a few minutes.
- The replay or hardware part of the demo.
