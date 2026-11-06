# Plan v3.5: Vitaquack at ETHGlobal Mumbai

This file holds the schedule, scope and story. The build order is `docs/spec.md` and the decision log is
`docs/decisions.md`; where this file disagrees with them, they win. Evidence lives in `docs/research/` (index:
`docs/research/README.md`), `docs/spikes/` and `docs/evidence/` (index: `docs/evidence/README.md`).

Versions: v3.5 (Sat 7 Nov) refreshed the status, prerequisites, proof levels and spikes before submission. v3.4 (Fri
6 Nov 06:00 IST) consolidated after three outside reviews: evidence relabelled, float path dropped, MCP off the critical
path, Robot Agent in the foundation stack, chip long-polling, passkey-only login, name Vitaquack. v3.3 (04:30) battle
plan. v3.2/v3.1 spikes and comment rounds. v3 (5 Nov) the four-system split.

## 0. Battle plan to Saturday 09:00 IST

Submissions close **Sat 7 Nov 09:00 IST, no late entries**. On Fri 05:00 no product code existed. Three Opus workers
built from `docs/spec.md` while Kris did the prerequisites and the teammates built the physical duck.

### Status board (Sat 7 Nov, before submission)

| Lane | State | Still open |
| --- | --- | --- |
| The loop on the deployed app | Live at https://vitaquack.com. Kris, with his own passkey on a Mac, got real 0G decisions and a real World approval with his Orb-verified account; the enforcer logged `PaymentApproved` and Arc paid `0xae55688e…ffa9` (`docs/evidence/2026-11-06-live-world.md`). The browser journey (run 7) and the API driver (runs 9 and 10) prove the rest of the loop, revoke included | the live World deny; the real-duck run (sign-up → chai pays → thali approve → thali deny → walk away → revoke): _fill in_ (`docs/evidence/demo-run.md`) |
| Errand start | Every errand starts from the duck's scan: `POST /api/chips/:robotId/scans` carries a chip-signed ≤ 64 KB QR crop. The in-app pay-now path is removed; the dock has "Get me" pills and a composer | the hardware team wires the Radxa scanner (`docs/hardware-handoff.md` §5) |
| Evidence and proofs | Episodes and chip-signed camera frames go to 0G Storage and `EpisodeLog`; the uploader runs as the systemd service `vitaquack-evidence-uploader` on netcup. Public proof pages, no sign-in: https://vitaquack.com/app/proofs and `/app/proofs/<episodeId>`, where "Verify against 0G" runs in the reader's browser | none |
| Merchant till | https://cafe.vitaquack.com drives the café's ESP32 counter screen: a tap puts the bill on it (`POST …/counter`) and the till shows pending, PAID or expired (`docs/hardware-handoff.md` §6) | none |
| Demo rules | Grant defaults 3.00 a day, 1.00 per payment. The 2.00 thali is the over-limit approval beat; a thali past the daily cap makes the robot walk away. No restricted item is sold (`docs/evidence/2026-11-06-limits-only.md`) | none |
| 0G brain | The owner picks the brain per message: `glm-5.3` (in a TEE, proof stored with the decision) or `qwen3-vl-plus` (no TEE proof, labelled so). No automatic fallback; one retry after a 429 inside the 10 s budget | none |
| Shop | https://vitaquack.com/shop/, checkout in USDC on Arc | none |
| Contracts and infra | Arc Studio is the single source (pinned pull, byte-identical deploys); three stacks in the named state store | Kris revokes the Alchemy CLI OAuth grant after the event |
| Next | demo rehearsal → video (`docs/video-script.md`) → submission (`docs/submission.md`) by 08:00 | Kris |

### Scope

| | What |
| --- | --- |
| **MUST** | Passkey wallet on Arc mainnet → grant to the chip (mock chip; the Radxa later) → the Robot Agent asks 0G and buys from our x402 merchant through our facilitator → a purchase over the per-payment limit needs Agent Pass (approve **and** deny) → revoke stops the next payment → 0G Storage episode log + `EpisodeLog` contract → our enforcer built in Arc Studio → the gate (web page; ESP32 later) opens on a signed "paid" |
| **STRETCH** | on-chain Agent Pass verification (S5b prototype) · duck walking · a read-only MCP server. Built since: camera frames as evidence on 0G, the simulator duck on 0G navigation turns, the public episode proof page |
| **CUT** | float path · outside MCP hosts · CCTP/Gateway funding · MPP · ENS · IDKit · 4337 break-glass (documented only) |

### Who does what

| Lane | Owner | Builds (spec §2) |
| --- | --- | --- |
| Lead | Opus worker | M0 protocol + chain packages → M1 contracts → M2 facilitator, relayer, schema, secrets, first real payment |
| Wallet | Opus worker | M0a passkey-only auth → M7 pages (wallet, robots, console, approval) → M6 World approval |
| Merchant + Robot | Opus worker | M3 merchant + virtual gate → M4 chip protocol + mock chip → M5 Robot Agent + 0G + evidence uploader |
| Orchestrator | this Claude session (Fable) | spec, reviews, integration, docs, the live checks, this plan |
| Kris | | prerequisites below, Arc Studio, World client, funding, the demo and video |
| Teammates | | the physical duck (Radxa OS, servos, walking), ESP32 wiring + servo, the camera QR read, booth questions |

### Prerequisites (Kris)

- [x] 10 USDC to the relayer `0x404b09F43db64fB08f70b0b3e2b785bC312D6fDb` (Kris, 06:09 IST); the smoke funds demo
  owners from it
- [x] two merchant payout addresses on Arc, generated by the Lead (`MERCHANT_PAY_TO` `0x2845…97F5`, `RESTRICTED_PAY_TO`
  `0x0166…8f52`, keys in `.env.main.local`)
- [ ] a keyed Arc RPC URL (`APP_ARC_RPC_URL`). Until one exists the Worker uses `https://arc-rpc.publicnode.com`,
  because the public Arc RPC throttles Cloudflare's egress (`docs/evidence/2026-11-06-deployed-e2e.md`)
- [x] the 0G API key, base URL and model (`APP_ZG_*`), and 0G Galileo gas for the storage signer
  `0xc6fF8A666f4C7F674C1D129C73b46D61f2891fcD`: real 0G decisions and uploads ran on 6 Nov
- [x] a World IdP client (`client_secret_basic`): the live approval ran on 6 Nov 14:55 IST
- [x] the Arc Studio project: https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75 (6 Nov 11:40 IST, built from the CLI with `ARC_STUDIO_TOKEN`; 42 tests, both contracts on Arc testnet, a live page)

### Checkpoints (IST)

| By | Checkpoint |
| --- | --- |
| Fri 08:00 | ~~protocol package published; auth routes compiling~~ done 06:00 (protocol 19 tests; passkey auth native 9/9) |
| Fri 10:00 | ~~M2 smoke~~ done 06:10 IST: $0.01 chip-signed payment settled on Arc mainnet, replay refused, revoke, next refused; `docs/evidence/2026-11-06-smoke.md`. Enforcer deployed `0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3` (`docs/evidence/contracts.md`) |
| Fri 12:00 | ~~merchant 402/pay/status and the chip protocol with the mock chip~~ code done 06:00 (native 14/14); first push to `main` 06:18; verified on the deployed app 06:22 (`docs/evidence/2026-11-06-deployed-merchant.md`) |
| Fri 15:00 | ~~Robot Agent errands with a real 0G decision; evidence uploaded to 0G Storage~~ done 12:36 (run 7) and 12:55 IST (`docs/evidence/2026-11-06-evidence-upload.md`) |
| Fri 19:00 | ~~World approve on the deployed app~~ done 14:55 IST with a real Orb ID (`docs/evidence/2026-11-06-live-world.md`); the live deny: _fill in_ |
| **Fri 21:00** | ~~the full MUST loop on the deployed app~~ done 12:39 IST with real 0G decisions (`docs/evidence/2026-11-06-deployed-e2e.md` runs 9 and 10; World was the stub then) |
| Sat 02:00 | stretch stops; README, diagram, Studio walkthrough |
| **Sat 06:00** | **feature freeze**: video (2:30 to 2:59), World debrief, contract addresses |
| Sat 09:00 | submitted (aim for 08:00) |

### Demo script (4-minute finalist slot; the video follows the same story)

| Time | Beat |
| --- | --- |
| 0:00 | The problem: don't give a robot your wallet, give it a budget |
| 0:20 | Owner (passkey, funded on Arc) grants Vitaquack's chip 3.00 USDC a day, 1.00 per payment, Duck Café only, on the consent screen (the form defaults; chai/samosa go through, the 2.00 thali needs World approval over the per-payment cap; a thali over the daily cap makes the robot walk away) |
| 0:50 | "Buy me a chai": 0G decides (show the request id) → the chip signs → paid on Arc (explorer link) → **the gate opens** |
| 1:50 | Thali 2.00, over the per-payment cap → Agent Pass on the phone → **approve: paid** → another thali → **deny: nothing paid** → a third is over the daily cap → the robot walks away |
| 2:50 | Revoke in the wallet → the next attempt fails on-chain |
| 3:20 | How it works: the architecture, our enforcer in Arc Studio, the episode's public proof page verified against 0G |
| 3:50 | Close |

The click-by-click walkthrough is `docs/demo.md`.

### Fallbacks, decided in advance

| If this fails | Then |
| --- | --- |
| Real-device passkey signing | the optional EOA owner on the Hybrid account signs (built in) |
| On-chain Agent Pass check | it is the stretch; the backend co-signer is the default |
| Bun on the Radxa | the Python signer from bench C1 (proven), or the mock chip on a laptop |
| Camera QR reading on the duck | the simulator duck's camera reads the same counter QR (`docs/evidence/2026-11-06-sim-e2e.md`) |
| x402 payment too large for a header | it already goes in the POST body (spec §7) |
| 0G slow or down | that is the safe-stop we must show anyway; never fake a decision |
| Venue network | the dedicated phone hotspot |
| The duck doesn't walk | demo the Radxa reading a QR and signing; never block the payment on the gait |

### Submission checklist

See `docs/spec.md` §12 (ETHGlobal rules checked Fri 04:15: 3 partner prizes, the from-scratch disclosure, video 2 to 4
min ≥ 720p with real narration, 0G's < 3 min, contract addresses, World debrief).

## 1. The architecture, in one paragraph

Four systems run in one Cloudflare Worker, plus a chip client. The **wallet** (passkey login = passkey signer of a
MetaMask `HybridDeleGator` on Arc) grants a budget to a robot's **chip** address as a delegation with caveats (daily cap,
per-payment cap, payee allowlist, expiry, approval requirement). The **Robot Agent** (an Effect service with D1 state,
one errand at a time per robot) asks 0G for a structured decision, hands the invoice to the chip over HTTPS
long-polling, and submits the chip-signed voucher to the **merchant**'s x402 endpoint. Our facilitator simulates and
settles it through the DelegationManager, and Arc checks every caveat. A purchase over the per-payment cap needs a World
Agent Pass approval, which the backend verifies and co-signs. Every decision is logged with its 0G request id. Episodes
and chip-signed camera frames are uploaded to 0G Storage and anchored in `EpisodeLog`, and anyone can check one on its
public proof page. Diagrams: the [architecture page](https://vitaquack.com/plan/architecture/). Build detail:
`docs/spec.md`.

## 2. What is proven, what is not (honest labels)

| Claim | Evidence level |
| --- | --- |
| HybridDeleGator, SimpleFactory, DelegationManager and the enforcers are on Arc, byte-identical to Base | verified on-chain (`eth_getCode`) |
| A chip-signed voucher under a grant settles on Arc; replay and post-revoke payments are refused | **broadcast** (6 Nov 06:10, `docs/evidence/2026-11-06-smoke.md`: $0.01 settled, revoke tx; replay and post-revoke refusals simulated from the relayer) |
| A passkey-signed grant is accepted on-chain (ERC-1271 on the Hybrid account) | **broadcast** (6 Nov 06:32, deployed e2e with a virtual authenticator, `docs/evidence/2026-11-06-deployed-e2e.md`); with Kris's real passkey on a Mac (`docs/evidence/2026-11-06-live-world.md`); phones not recorded |
| The enforcer (cap, allowlist, approval) behaves on Arc | **broadcast**: deployed `0x7c21…e4D3`, an 8-case live approval test against that code (`docs/evidence/contracts.md`), and an approved payment that logged `PaymentApproved` (`0xae55688e…ffa9`) |
| Chip pairing and 25 s long-polls through the deployed edge | **deployed** (edge holds 24.8 s, lease 35 s) |
| Merchant 402 / pay / signed gate status on the deployed app | **deployed** (`docs/evidence/2026-11-06-deployed-merchant.md`) |
| The real Radxa builds and signs the voucher the kit expects | **bench** (C1, 20/20), simulated settlement |
| A World RS256 token can be verified in an Arc contract bound to one payment | **prototype** (S5b, 43 tests, live `eth_call`); not run with a real World token; stretch |
| 0G decides, logs, safe-stops; episodes on 0G Storage | **live**: real 0G decisions on the deployed app (`docs/evidence/2026-11-06-deployed-browser.md` run 7, `docs/evidence/2026-11-06-deployed-e2e.md` runs 9 and 10); `glm-5.3` TEE proofs verified with 0G's SDK (`docs/evidence/2026-11-06-tee-verification.md`); episodes and camera frames on 0G Storage and `EpisodeLog` (`docs/evidence/2026-11-06-evidence-upload.md`, `docs/evidence/2026-11-06-frames-on-0g.md`); the safe stop **native with a stub** |
| World approve / deny on the deployed app | approve **live** with a real Orb ID, paid on Arc (`docs/evidence/2026-11-06-live-world.md`); approve and deny on the stub issuer (run 7); the live deny: _fill in_ |
| The full MUST loop on the deployed app | **deployed** with real 0G decisions (run 7; e2e runs 9 and 10); with the real duck, the Radxa chip and the ESP32 screen: _fill in_ (`docs/evidence/demo-run.md`) |
| A robot body driven by 0G | **deployed** on the simulator duck: it walked to the stall on `glm-5.3` navigation turns and paid a chai on Arc (`docs/evidence/2026-11-06-sim-e2e.md`) |

## 3. Spikes

| # | Spike | Status |
| --- | --- | --- |
| S1 | real-device passkey → HybridDeleGator on Arc → passkey-signed grant → $0.01 relayed payment | done (deployed e2e; Kris's passkey on a Mac in the live World run) |
| S2 | our ERC-7710 facilitator: owner → chip leaf, then $0.01 real | done (simulated 14/14, then broadcast in the M2 smoke) |
| S3 | 0G: a tool-calling model, latency, request ids | done (router `qwen3-vl-plus`, then `glm-5.3` in a TEE, 6/6 on the probe at 4 to 7 s; request ids logged) |
| S4 | ~~Robot Agent ↔ wallet MCP~~ | dropped (MCP off the path) |
| S5 | Agent Pass browser flow with `nonce`, approve and deny, with Kris's Orb ID | approve done (6 Nov 14:55 IST); the live deny: _fill in_ |
| S5b | `HumanApprovalEnforcer` verifies a World token on Arc | prototype done; stretch |
| S6 | mock chip ↔ Robot Agent long-polling; then the Radxa with Bun + viem | mock chip done (deployed e2e); Bun on the Radxa not tested (H3) |
| S7 | the phone hotspot with the Radxa, ESP32 and laptops; H2, H6 on it | open (teammates) |
| S8 | walking policy on the new servos | trained in simulation, not yet run on the real duck (https://vitaquack.com/plan/duck-walk/) |

Hardware bench results so far: C1 pass (the chip signs the plan's voucher); H1 partial (camera ribbon reseated, ≤ 57 °C);
H3 signing works in Python at 187 ms (Bun not yet tested); H4 venue Wi-Fi unusable → phone hotspot; H2/H6 not yet run.
Details: `docs/spikes/hardware-results.md`.

## 4. Booth questions

- 0G: Storage and `EpisodeLog` may run on Galileo testnet (answered yes by the 0G judges).
- World: the production IdP client exists and the live approval ran on it.
- Arc: can judges open a Studio URL without logging in; is a Studio-authored enforcer deployed to mainnet by us
  acceptable; a keyed RPC.

## 5. Alternatives considered and rejected

- World Chain + 0G + ENS instead of Arc: there is no World Chain prize, MetaMask's delegation contracts aren't on World
  Chain, gas is in ETH, and World's wallet can't grant allowances. ENS names could sit on top of Arc later.
- The float path (pull to the chip, then EIP-3009 via Circle): after the pull, Arc no longer binds payee, invoice or
  revocation. A later fix is a policy-bound escrow.
- Verifying the World token on Arc by default publishes the owner's World pseudonym in calldata. Stretch only.
- An Agents SDK / Goblin-style agent, WebSockets and MCP between our own components don't compose with the
  Effect/Alchemy foundation, and they add hours without adding security.
