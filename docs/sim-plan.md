# Simulator robot: plan (6 Nov 2026)

> Status: **approved by Kris on 6 Nov; being built.** The build plan with files and steps is the approved plan below
> (steps 1–7). The spike evidence is in `docs/spikes/sim-results.md`. Until §6/§8 of `docs/spec.md` are updated
> (step 7), `docs/spec.md` still wins.

## Goal

When adding a robot, the owner chooses **Simulator** or **Real robot (chip)**. A simulator robot is a duck in a
browser physics sim (MuJoCo WASM plus a trained RL walking policy). It gets the same wallet, allowance, x402 merchant,
0G decision, chip signature, Arc settlement, gate and evidence as the real duck. Anyone on the team (Kris, Masa,
Heyman) can open their own simulator. The real-duck path is unchanged.

## Decisions (Kris, 6 Nov)

| Decision | Choice | Why |
| --- | --- | --- |
| Where it runs | All on Cloudflare: the sim and its chip run in the viewer's browser, served by the app Worker under `/sim/<robotId>` (same origin, no CORS) | No server per simulator, so several people can each run one; netcup stays tailnet-only |
| Sim chip key | A software chip in the sim page; key in IndexedDB; the same `apps/chip` policy and signer code | Proof of concept run by us; the chip still signs every payment, the Worker never holds the key |
| Owner instruction | Reaches 0G's `decide` through an **errand intent**: "Send for chai" creates an errand in `awaiting_scan`; the duck's scan claims it, so `requested` is what the owner asked for | Without it, `requested` is the invoice's own item (`Decide.ts:53`) and "not what the owner asked for" can never fire |
| Navigation brain | Multi-turn glm-5.3 tool loop on 0G through a Worker route (`go_to`, `look`, `scan_qr`, `say`, `wait`, `finish`); the Worker's `decide` stays the only input that leads to payment | The 0G key stays in the Worker (the router rejects browser origins); 0G drives the robot, not only logs |
| Builders | Agents on netcup, in parallel lanes below | — |

Rules this must keep (CLAUDE.md): a failed or timed-out 0G call stops the duck ("brain offline"), never a scripted
fallback shown as 0G. `look()` returns text facts from sim state, never pixels. The only frame that leaves the sim is
the chip-signed QR crop on the scan path (labelled as a sim scan). Tiny caps: payments are real USDC on Arc mainnet.

## Architecture

```
viewer's browser: /sim/<robotId>                          app Worker (Cloudflare)
┌──────────────────────────────────────────┐   HTTPS   ┌───────────────────────────────────────────┐
│ MuJoCo WASM + ONNX walking policy (50 Hz)│           │ /api/chips/pair, /poll, /responses (as now)│
│ scene: entrance, Duck Café, kiosk, gates │           │ /api/chips/:id/scans (as now, + intent)    │
│ head camera → jsQR → QR crop (≤ 64 KB)   │──scan────▶│ /api/robots/:id/nav (new, chip token)      │
│ software chip (policy + signer, IDB key) │◀─poll────▶│   → 0G glm-5.3 tools, TEE proof per turn   │
│ nav executor: runs tool calls, reports   │──nav─────▶│ decide → facilitator → Arc → gate status   │
│ events (arrived, fell, scanned, outcome) │◀─status── │ /api/invoices/:id/status (signed, public)  │
└──────────────────────────────────────────┘           └───────────────────────────────────────────┘
        ▲ owner opens it from Add robot / the robot conversation; instructions come from the conversation
```

Outcomes reach the duck from the scan's reply (`signing` → walk to the gate; `awaiting_approval` → wait;
`walked_away`/`safe_stop` → turn away), then from the signed gate status (`paid` → the sim gate opens).

## Lanes

Contract first: S0 lands before the others start; then S1–S5 run in parallel; S6 last.

| # | Lane | Files | Done when | Est. |
| --- | --- | --- | --- | --- |
| S0 | Contracts | `packages/protocol/src/{Nav,Errand}.ts` (nav turn request/response, tool schemas, `awaiting_scan`), `packages/db/src/schema.ts` (`robots.kind`, intent fields) + one migration | unit tests for the schemas; graph check green | 1 h |
| S1 | Sim body | new `apps/sim/**` from the Pollen Microduck sandbox (Apache-2.0 app code; meshes CC BY-NC-SA, fetched at runtime, never committed): counters with QR screens, `goTo`, head camera + jsQR, crop, gate visuals, falls → `safe_stop` | scripted walk to each counter decodes the right invoice id; video in evidence | 6–9 h (Spike A sets the number) |
| S2 | Software chip | `apps/chip/src/client.ts` (split from `main.ts`), `apps/chip/package.json` exports; `apps/sim/src/chip/{idbState,browserChip,scan}.ts`; `tools/quality/graph.ts` (`@ethmumbai/sim` may use viem; `apps/web` still may not); `knip.config.ts` | mock-chip native tests still green; the sim pairs from `#pair=CODE`, signs a sign request in Chromium | 4 h |
| S3 | Worker: intent + kind | `packages/server/src/robot/{Errands,Start,Decide,Scans,routes}.ts`, `packages/server/src/wallet/Robots.ts` | native: console errand → `awaiting_scan` → scan claims it → decide input carries the owner's request; scans with no intent behave as today; robot view returns `kind` | 3 h |
| S4 | Worker: nav route | new `packages/server/src/robot/Nav.ts`, `routes.ts`; per-robot rate limit; TEE proof capture as `TeeProof.ts` does | native with a stub 0G (labelled test infra): tool call returned, timeout → `stop`; live: one real glm-5.3 turn with its chat id | 2–3 h (Spike C sets the prompt and tools) |
| S5 | Hosting | `alchemy.run.ts` (sim static assets), `packages/server/src/EdgeWorker.ts` (`/sim/*`), COOP/COEP only if Spike A needs threads | deployed `/sim/<id>` boots the duck | 1 h |
| S6 | Wallet UI | `apps/web/src/api/{Wallet,Robot}.ts`, `pages/AddRobot(+View).ts`, `pages/RobotConsole(+View).ts`, i18n catalog, scene tests (**these pages carry another session's uncommitted work: coordinate first**) | Add robot offers Simulator / Real robot; Simulator opens `/sim/<id>#pair=CODE`; the conversation's "Send for …" sets the intent and links the open simulator | 2.5 h |
| S7 | Docs + evidence | `docs/spec.md` (§6 intent, §8 software chip, the sim), `docs/decisions.md`, `docs/hardware-handoff.md` §2 (pairing against the API origin fails `bad_invoice_origin`), `docs/evidence/` run | a deployed sim run recorded: chai paid (tx), cigarettes → World, instruction mismatch → walk away | 1 h |

Critical path: S0 → S1 + S2 + S5 → first deployed sim payment. S3/S4/S6 add the instruction and the 0G driver.

## Integration with voice and camera

Masa's hold-to-talk voice (issue #5: `POST /api/robots/:robotId/voice`, `APP_VOICE_ENABLED`) lands on the same
conversation page. Agreed with the voice session so nothing is built twice:

- **One intent operation and one route.** "Create an errand intent" is a single typed operation behind one route (S3),
  used by the Buy chips, the typed instruction and the voice route (voice only turns audio into an intent and calls
  it). The endpoint shape goes to issue #5 when S0 lands.
- **One 0G call path.** `/nav` (S4) and `/voice` share one helper: router client, per-robot rate limit, timeout, safe
  logging (no prompts or audio in spans). Whoever lands first owns it; the other reuses it.
- **`say()` → Vita's voice.** The nav tool's `say()` lines can be spoken in the same voice as the conversation.
- **Camera.** The head camera's picture-in-picture stays in the sim page; the app sees only the QR crop, labelled as a
  sim scan on the "What the robot saw" card (episode page).
- **Page layout.** The conversation page's layout belongs to the redesign session (pending Kris); S6 waits for it.

## Open

- Spike A: does the walking policy hold up in our scene, and does the QR decode from the head camera?
- Spike C: glm-5.3 tool-call reliability and latency; prompt and tool schemas to ship.
- A console errand for another robot pays the counter's newest open invoice; with intents, keep sim scans on their
  own invoices (risk from Spike B).
