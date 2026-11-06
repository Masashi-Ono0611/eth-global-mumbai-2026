# 0G: integration debrief

Optional partner feedback for 0G, for the ETHGlobal submission form's feedback field if there is one. It is not a 0G
prize requirement. The 0G lane (Masashi) wrote it on Fri 6 Nov 2026 from measurements; the numbers and scripts are in
`docs/research/0g-measurements.md`. Updated 7 Nov with the state at submission.

## What we built

The robot's purchasing brain is 0G Compute. Every errand makes one `decide` call to the 0G Router
(`https://router-api.0g.ai/v1/chat/completions`, OpenAI-compatible) with structured facts only (item, invoice, budget,
policy flags, merchant trust), one forced tool call and `temperature: 0`. The answer is `pay`, `ask_human` or
`walk_away`. Any failure (HTTP error, timeout of 10 s, no tool call) ends the errand in `safe_stop` instead of a guessed
decision. Each decision keeps the router's `x_0g_trace.request_id`, the provider and the `ZG-Res-Key` chat id.

Since 6 Nov 17:15 IST the model is `glm-5.3`, a TeeML service. The Worker fetches the provider's TEE signature for each
decision at decision time and stores it with the decision and in the episode's evidence (`tee`), because the provider
serves it for only about 20 minutes (friction 3).

When an errand ends, its episode JSON goes to 0G Storage (Galileo, turbo indexer, `@0gfoundation/0g-storage-ts-sdk`),
and its root hash plus `keccak256(requestIds.join(","))` are anchored in our `EpisodeLog` contract on 0G Chain
(Galileo, `0x4C947E6D794C78d0F684e46EFC97f712E51a206A`). The robot's chip-signed camera frames go to 0G Storage first,
and the episode JSON names each frame's root next to its SHA-256. The 0G decision never receives an image.

Anyone can re-check an episode from outside. On 7 Nov, 48 episodes were on 0G and listed on the public page
`https://vitaquack.com/app/proofs`. Its Verify runs in the reader's browser: one `eth_call` of `EpisodeLog.records` on
0G Chain, the episode JSON and its frames downloaded from the indexer by root, the request-ids hash and each frame's
SHA-256 recomputed. A signed-out browser passed all five checks on a chai errand
(`docs/evidence/2026-11-07-public-proofs.md`).

## Time to first success

- Router: the first completion came within minutes of having a funded key, with no SDK needed.
- Credits took longer. The credit form asks for a wallet, but signing in to pc.0g.ai created a different embedded
  wallet, so the credit was not where we looked until we imported the wallet we had submitted.
- Storage: the first upload worked once the uploader had Galileo gas. The SDK needs `ethers` pinned to exactly 6.13.1.
- A real 0G decision on the deployed app came the same day the key reached the Worker.

## Friction

1. Provider health does not match reality. `0gm-1.0-35b-a3b` (0G's own TeeML model, one provider) returned HTTP 502
   `provider_error` for every call at 06:45 and again from 07:05 to 07:14 UTC on 6 Nov. `/v1/providers` reported it
   unhealthy at 06:48 but healthy at 07:05 and 07:11, while the calls kept failing. `whisper-large-v3` returned 502 for
   wav, mp3 and m4a. We had to build our own probe to pick a model.
2. The catalog's TEE flags change overnight. On 5 Nov night `/v1/models` listed 79 models and none flagged TEE. On
   6 Nov it listed 124 with 9 TeeML. A team cannot write a TEE claim from the catalog alone.
3. `tee_verified` never appears in `x_0g_trace`, even with `verify_tee: true` and `X-0G-Provider-Trust-Mode: private`.
   Independent verification does work (`broker.inference.processResponse(provider, ZG-Res-Key)` from
   `@0gfoundation/0g-compute-ts-sdk`, with a random unfunded wallet; `glm-5.3` replies returned `true`), but the
   signature does not last. Rechecking one `glm-5.3` reply every 5 minutes gave `true` at 5, 10 and 15 minutes and
   "getting signature error" at 20 and 25 minutes. So we take the proof right after the decision and store it
   ourselves; a judge cannot fetch it from the provider the next day.
4. Not every router provider can be verified. For `qwen3-vl-plus` and the `qwen*-omni` models, `processResponse`
   answers "Service provider does not exist": the router routes them to a provider that is not in the 0G service
   registry. Nothing in `/v1/models` says which models are verifiable this way.
5. Model capabilities differ from the general docs. `response_format: json_object` returns 400 `model_not_capable` on
   `qwen3.8-flash`, and `deepseek-v4-flash-vision-exp` returns 400 for `tools` with a forced `tool_choice`. Thinking is
   on by default for `0gm-1.0-35b-a3b` (6.3 s median, 3.2 s with `chat_template_kwargs: {"enable_thinking": false}`),
   and the field that turns it off differs per model (`chat_template_kwargs` or `enable_thinking`).
6. Audio details are undocumented. The omni models take `input_audio` only as a `data:audio/wav;base64,…` URI (raw
   base64 gives 400 "URL does not appear to be valid"). Text to speech (`minimax-speech-*`) returned upstream 401 on
   5 Nov and 200 on 6 Nov.
7. The storage SDK cannot run in Workers (it imports Node `fs` and `crypto`), so the uploader runs as a separate process
   outside Cloudflare.
8. The storage SDK's upload waits without end when its flow submission reverts. On 6 Nov a frame's submission
   ran out of gas (receipt status 0) and the SDK kept printing "Waiting for storage node to sync" for about 2 h 40 min,
   so nothing reached 0G in that time. The wait cannot be cancelled, so we wrap each upload in a 4-minute timeout that
   exits the process, and systemd restarts it.

## One improvement

Put the TEE result into the response: `x_0g_trace.tee_verified` plus the signer and signature (or a URL that stays
valid for days), and a per-model field in `/v1/models` saying whether replies are independently verifiable. Then a
robot can store proof next to every decision without racing the provider, and judges can check it later without
asking the provider in time.
