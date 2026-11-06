# 0G: integration debrief

Ready to paste into the 0G prize form. Written by the 0G lane (Masashi) on Fri 6 Nov 2026 from measurements, not
impressions; the numbers and scripts are in `docs/research/0g-measurements.md`.

## What we built

The robot's purchasing brain is 0G Compute. Every errand makes one `decide` call to the 0G Router
(`https://router-api.0g.ai/v1/chat/completions`, OpenAI-compatible) with structured facts only (item, invoice, budget,
policy flags, merchant trust), one forced tool call and `temperature: 0`. The answer is `pay`, `ask_human` or
`walk_away`; any failure (HTTP error, timeout of 10 s, no tool call) ends the errand in `safe_stop`, never a guessed
decision. Each decision keeps the router's `x_0g_trace.request_id`, the provider and the `ZG-Res-Key` chat id.

When an errand ends, its episode JSON goes to **0G Storage** (Galileo, turbo indexer, `@0gfoundation/0g-storage-ts-sdk`)
and its root hash plus `keccak256(requestIds.join(","))` are anchored in our `EpisodeLog` contract on **0G Chain**
(Galileo, `0x4C947E6D794C78d0F684e46EFC97f712E51a206A`). Anyone can re-check an episode from outside: the app's public
record, the on-chain record and the bytes downloaded from 0G Storage with the Merkle proof must agree; all 7 episodes
decided by 0G on 6 Nov pass that check.

## Time to first success

- Router: the first completion came within minutes of having a funded key; it needs no SDK.
- Credits: slower. The credit form asks for a wallet, but signing in to pc.0g.ai created a different embedded wallet,
  so the credit was not where we looked until we imported the wallet we had submitted.
- Storage: the first upload worked once the uploader had Galileo gas; the SDK needs `ethers` pinned to exactly 6.13.1.
- A real 0G decision on the deployed app: the same day the key reached the Worker.

## Friction

1. **Provider health does not match reality.** `0gm-1.0-35b-a3b` (0G's own TeeML model, one provider) returned HTTP 502
   `provider_error` for every call at 06:45 and again from 07:05 to 07:14 UTC on 6 Nov; `/v1/providers` reported it
   unhealthy at 06:48 but healthy at 07:05 and 07:11, while the calls kept failing. `whisper-large-v3` returned 502 for wav, mp3 and m4a. We had to build our own probe to pick a model.
2. **The catalog's TEE flags change overnight.** On 5 Nov night `/v1/models` listed 79 models and none flagged TEE; on
   6 Nov it listed 124 with 9 TeeML. A team cannot write a TEE claim from the catalog alone.
3. **`tee_verified` never appears in `x_0g_trace`**, even with `verify_tee: true` and `X-0G-Provider-Trust-Mode: private`.
   Independent verification does work (`broker.inference.processResponse(provider, ZG-Res-Key)` from
   `@0gfoundation/0g-compute-ts-sdk`, with a random unfunded wallet; `glm-5.3` replies returned `true`), but
   **the signature does not last**: rechecking one `glm-5.3` reply every 5 minutes gave `true` at 5, 10 and 15 minutes and
   "getting signature error" at 20 and 25 minutes. Proof therefore has to be taken right after the decision and stored by us; a judge
   cannot re-check it the next day.
4. **Not every router provider can be verified at all.** For `qwen3-vl-plus` and the `qwen*-omni` models,
   `processResponse` answers "Service provider does not exist": the router routes them to a provider that is not in the
   0G service registry. Nothing in `/v1/models` says which models are verifiable this way.
5. **Model capabilities differ from the general docs.** `response_format: json_object` returns 400 `model_not_capable` on
   `qwen3.8-flash`; `deepseek-v4-flash-vision-exp` returns 400 for `tools` with a forced `tool_choice`; thinking is on by
   default for `0gm-1.0-35b-a3b` (6.3 s median, 3.2 s with `chat_template_kwargs: {"enable_thinking": false}`), and the
   field that turns it off differs per model (`chat_template_kwargs` or `enable_thinking`).
6. **Audio details are undocumented.** The omni models take `input_audio` only as a `data:audio/wav;base64,…` URI (raw
   base64 gives 400 "URL does not appear to be valid"). Text to speech (`minimax-speech-*`) returned upstream 401 on
   5 Nov and 200 on 6 Nov.
7. **The storage SDK cannot run in Workers** (it imports Node `fs` and `crypto`), so the uploader runs as a separate Node
   process outside Cloudflare.

## One improvement

Put the TEE result into the response: `x_0g_trace.tee_verified` plus the signer and signature (or a URL that stays valid
for days), and a per-model field in `/v1/models` saying whether replies are independently verifiable. Then a robot can
store proof next to every decision, and judges can check it later without asking the provider in time.
