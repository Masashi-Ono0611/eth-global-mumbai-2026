# Simulator robot spikes A–C (6 Nov 2026)

These spikes tested a simulator fallback for the duck. The simulator they led to is `docs/spec.md` §15. The spike code lives
outside the repo, in `~/code/vitaquack-sim-spikes/{a-sim,b-chip,c-brain}` on netcup, and each folder has its own
`RESULTS.md` with raw data. All numbers below were measured on netcup in headless Chromium.

The renderer is SwiftShader, which runs on the CPU because netcup has no GPU. Expect a real GPU to be faster; we did
not measure one.

## A: the browser duck sim (Pollen Microduck sandbox: MuJoCo WASM plus an ONNX walking policy)

| Step | Result |
| --- | --- |
| A1 boot | **Pass.** Ready in 7–8.5 s, controls unlocked at 11–12 s. The policy runs at 48.7–50.2 Hz. Rendering runs at 2.6 fps with the default look and 10–15 fps with `?crt=0&aa=0`. |
| A2 navigation from code | **Pass.** All 10 walking legs arrived within 0.084 m, with 0 falls over 5 runs. The policy reaches only 0.11 m/s when told 0.25 m/s, and turns at about 25°/s, so budget about 12 s per metre and 9 s per 90° turn. A turn-in-place step and an orbit guard stopped the duck circling the target. |
| A3 counters | Done. Each counter is an MJCF box collider plus a three.js mesh, with a 0.14 m QR screen 0.20 m up, a label and a gate arm. |
| A4 head camera and QR | **Pass.** jsQR on a 320×240 frame at 5 Hz; decoding takes 6–16 ms. The short `vq1:` code (QR version 2) decodes from 0.22–0.62 m head-on, 0.22–0.42 m at 40° and 0.22–0.32 m at 55°. The URL code (QR version 4) decodes from 0.22–0.42 m head-on. An approach point 0.30 m in front puts the camera 0.22–0.30 m from the QR. The crop was 140×139 px, a JPEG of 8,152 B. The camera needed a +90° roll correction. |
| Readback | On SwiftShader, reading the frame back synchronously drops the policy to 9–10 Hz. Async readback keeps 47–50 Hz, at about 0.4 camera frames/s. The default is async while walking and sync while standing. On a GPU we expect about 1 ms, not measured. |
| A6 hosting | No COOP/COEP needed: MuJoCo runs single-threaded and ORT on 1 thread. The build is 43 MB in 172 files; the largest is 12.86 MiB, under the 25 MiB per-file limit. Cross-origin iframe embedding is unproven, so we serve the sim from the same origin. |
| Not run | A5 (the full scripted approach with video), the 640×480 comparison and the iframe handshake. |

Licences: the app code is Apache-2.0. The meshes and GLB are CC BY-NC-SA and are never committed; they are fetched at
runtime.

## B: a sim robot in the wallet (local stack on a copy of HEAD `7ff4576`)

- **The chip half works locally up to settlement.**
  - Passkey signup, add robot, then the unchanged `apps/chip` paired with that code.
  - A merchant invoice, then a QR JPEG posted to the chip's `/scan`.
  - The scan returned 201 `signing` in 323 ms. The chip logged `signed <invoiceId>` 449 ms later.
  - Settlement: the facilitator's off-chain checks passed. Arc mainnet's simulation then rejected the fixture grant's
    placeholder signature, so nothing was sent.
  - 0G was the test stub. This run made no real 0G decision.
- **Browser:** `apps/chip` `policy.ts` and `signer.ts` bundle for the browser (58 KB gzip), and evaluate and sign in
  Chromium.
- **CORS:** the server has no CORS; a cross-origin preflight to the chip routes returns 404. So the sim must be served
  from the app's own origin.
- **Pitfall:** a chip paired against the API Worker's own URL refuses every payment with `bad_invoice_origin`, because
  invoice links carry the public origin. Always pair against the public app address.
- **Scan replies:** repeating a scan returns the errand's current state.
- **Owner's request:** on the scan path `requested` is the invoice's own item (`Decide.ts`), so "not what the owner asked
  for" could never fire. That is why the plan adds intents.

## C: glm-5.3 on 0G as the navigation brain (real router, mock symbolic world, about $0.39 total)

- **Tool calls:** 120 errands, 627 calls. All 604 answered turns were valid tool calls, and all 97 finished errands
  were sensible.
- **`reasoning_effort: "low"`:** cuts reasoning from about 47 to 4 tokens per turn. Turn latency is p50 1.8–2.2 s and
  p95 2.5–3.3 s, with no loss of quality.
- **Broken toggles:** `enable_thinking: false` and `"none"` leak `</think>` into the content.
- **`tool_choice`:** `required` and `auto` are equally valid.
- **Per errand:** about 5.5 turns, 12–19 s, about $0.003–0.005.
- **TEE:** every call is served by TeeML provider `0xD179…E503` with a `zg-res-key`. 112 of 112 proofs verified the
  same way `TeeProof.ts` verifies them. A proof fetch takes about 156 ms, and proofs are gone after about 20 minutes.
  Streamed chats sign with the prefix `zg-sig-v1/e2ee-ct-stream:`.
- **Failures:**
  - 22 × `429 model_overloaded` plus 1 timeout, 3.7% of calls. They came in clusters and killed 19% of errands.
  - They happen even with a single loop. The provider handles about 2–3 parallel calls.
  - Resulting rules: stop the duck, retry at most once, never a scripted fallback, at most 2 nav turns in flight.
- **Other models:** glm-5.3 is the only TEE-verified model with tool calling. glm-5.3-flash and qwen3.7-flash are
  correct and cheaper but have no TEE. gemini-3.5-flash-lite went 0/5.
