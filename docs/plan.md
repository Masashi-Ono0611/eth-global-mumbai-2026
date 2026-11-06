# Plan v3.4: Vitaquack at ETHGlobal Mumbai

**What this file is:** the schedule, scope and story. **What it is not:** the build order (`docs/spec.md`) or the
decision log (`docs/decisions.md`). Where this file and those disagree, they win. Evidence lives in `docs/research/`
(index: `docs/research/README.md`), `docs/spikes/` and `docs/evidence/`.

Versions: v3.4 (Fri 6 Nov 06:00 IST) consolidated after three outside reviews: evidence relabelled, float path dropped,
MCP off the critical path, Robot Agent in the foundation stack, chip long-polling, passkey-only login, name Vitaquack.
v3.3 (04:30) battle plan. v3.2/v3.1 spikes and comment rounds. v3 (5 Nov) the four-system split.

## 0. Battle plan to Saturday 09:00 IST

**Deadline: submissions close Sat 7 Nov 09:00 IST, no late entries.** On Fri 05:00 no product code existed. Three Opus
workers build from `docs/spec.md` while Kris does the prerequisites and the teammates build the physical duck.

### Status board (Fri 6 Nov 17:31 IST)

| Lane | State | Blocker |
| --- | --- | --- |
| **Everything real, on the deployed app** | Kris (real passkey, Mac) → real 0G decisions → **real World approval with his Orb-verified account** → enforcer `PaymentApproved` → paid `0xae55688e…ffa9`; episodes on 0G Storage + `EpisodeLog`; one-command e2e and the browser journey prove the loop | live **deny** and **revoke** clicks still to do (`docs/demo.md`) |
| Vita's voice (STRETCH, issue #5) | **Built, on by default** (no flag since 7 Nov; needs only the `APP_ZG_*` bindings): hold-to-talk in the robot conversation → 0G omni → intent (buy / question / stop) → the same `createIntent` as a Get me chip; Vita's lines come from the intent's real state, the text first and the speech (0G minimax) from a cached URL; native acceptance with a stubbed 0G and a local run with real 0G. Not done: the run on the deployed app | after the merge: one spoken chai and thali on vitaquack.com |
| Robot evidence (scans) | **Live, flag on** (`features.scans: true`): `POST /api/chips/:robotId/scans` starts the errand for the scanned invoice with a chip-signed ≤ 64 KB QR crop (R2 copy plus a plain copy on 0G Storage as proof of work, root and hash anchored on 0G); `/wallet/episodes/:id` shows "What the robot saw" with a verify badge; the chip's `--local-port` listener and `docs/hardware-handoff.md` §5 are ready for the Radxa | the hardware team wires the Radxa scanner |
| Audit view | `/wallet/episodes` + `/wallet/episodes/:id`: timeline, 0G input/decision, chip, Arc payment, World `acr`/`amr`, 0G evidence, Verify (on-chain), Replay (non-binding) | — |
| Merchant till | **Live:** https://eth-mumbai-merchant.kristjan-grm11775.workers.dev (own stack; items over 1 USDC badged "needs owner approval"). Built on 6 Nov evening, live once its release deploys: the till drives the café's counter screen, a tap puts the bill on the ESP32 (`POST …/counter`) and the till shows it pending / PAID / expired (`docs/hardware-handoff.md` §6) | — |
| Demo rules | grant defaults **5.00/day, 1.00 per payment**; **thali 2.00** = the over-cap approval beat, cigarettes = the restricted beat; approval page names the reason | the two commits deploy in the next push |
| Design | Tailwind v4 + @foldkit/ui replaced zyzz; the wallet redesign (steps 2–3: shell, wallet home) is live; the robot conversation (console) is being rewritten by the redesign session | — |
| Contracts / infra | Arc Studio is the single source (pinned pull, 92 tests, byte-identical deploys); state-store incident resolved with a guard; three stacks in the named store | Kris revokes the Alchemy CLI OAuth grant after the event |
| 0G | **`glm-5.3` (TeeML) live since 17:15 IST** via the router (provider `0xD179…E503`, 6/6 on the probe); the first two decisions' TEE signatures verified with 0G's SDK (`docs/evidence/2026-11-06-tee-verification.md`); **the Worker now fetches each decision's TEE proof at decision time**, stores it with the decision and in the anchored evidence; the episode page shows "Sealed in a TEE ✓ (0G chat …)" after Verify | first proof-carrying episode: the next glm-5.3 errand after release 2ecf188 |
| Next | deny/revoke → M+R uploads those episodes → demo rehearsal → video (`docs/video-script.md`) Sat 06:00 → submission (`docs/submission.md`) by 08:00 | Kris |

### Scope

| | What |
| --- | --- |
| **MUST** | Passkey wallet on Arc mainnet → grant to the chip (mock chip; the Radxa later) → the Robot Agent asks 0G and buys from our x402 merchant through our facilitator → a restricted item needs Agent Pass (approve **and** deny) → revoke stops the next payment → 0G Storage episode log + `EpisodeLog` contract → our enforcer built in Arc Studio → the gate (web page; ESP32 later) opens on a signed "paid" |
| **STRETCH** | on-chain Agent Pass verification (S5b prototype) · camera/vision · duck walking · a read-only MCP server |
| **CUT** | float path · outside MCP hosts · CCTP/Gateway funding · MPP · ENS · IDKit · 4337 break-glass (documented only) |

### Who does what

| Lane | Owner | Builds (spec §2) |
| --- | --- | --- |
| Lead | Opus worker | M0 protocol + chain packages → M1 contracts → M2 facilitator, relayer, schema, secrets, **first real payment** |
| Wallet | Opus worker | M0a passkey-only auth → M7 pages (wallet, robots, console, approval) → M6 World approval |
| Merchant + Robot | Opus worker | M3 merchant + virtual gate → M4 chip protocol + mock chip → M5 Robot Agent + 0G + evidence uploader |
| Orchestrator | this Claude session (Fable) | spec, reviews, integration, docs, the live checks, this plan |
| Kris | | prerequisites below, Arc Studio, World client, funding, the demo and video |
| Teammates | | the physical duck (Radxa OS, servos, walking), ESP32 wiring + servo, the camera QR read, booth questions |

### Prerequisites (Kris; they block M2/M5/M6)

- [x] 10 USDC to the relayer `0x404b09F43db64fB08f70b0b3e2b785bC312D6fDb` (Kris, 06:09 IST); the smoke funds demo
  owners from it
- [x] two merchant payout addresses on Arc: generated by the Lead (`MERCHANT_PAY_TO` `0x2845…97F5`, `RESTRICTED_PAY_TO`
  `0x0166…8f52`, keys in `.env.main.local`); Kris may replace them
- [ ] a keyed Arc RPC URL (`APP_ARC_RPC_URL`; the app falls back to the public RPC, which throttles)
- [ ] the 0G API key, base URL and model (`APP_ZG_*`) in `.env.main.local`; **without them every errand ends in
  `safe_stop`**. 0G Galileo gas for the storage signer `0xc6fF8A666f4C7F674C1D129C73b46D61f2891fcD` (key generated,
  in `.env.main.local`)
- [ ] a World IdP client (`auth.world.org/portal`, redirect
  `https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev/api/world/callback`,
  `client_secret_basic`)
- [x] the Arc Studio project: https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75 (6 Nov 11:40 IST, built from the CLI with `ARC_STUDIO_TOKEN`; 42 tests, both contracts on Arc testnet, a live page)

### Checkpoints (IST)

| By | Checkpoint |
| --- | --- |
| Fri 08:00 | ~~protocol package published; auth routes compiling~~ **done 06:00** (protocol 19 tests; passkey auth native 9/9) |
| **Fri 10:00** | ~~M2 smoke~~ **done 06:10 IST**: $0.01 chip-signed payment settled on Arc mainnet, replay refused, revoke, next refused; `docs/evidence/2026-11-06-smoke.md`. Enforcer deployed `0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3` (`docs/evidence/contracts.md`) |
| Fri 12:00 | ~~merchant 402/pay/status and the chip protocol with the mock chip~~ **code done 06:00** (native 14/14); first push to `main` 06:18; verified on the deployed app 06:22 (`docs/evidence/2026-11-06-deployed-merchant.md`) |
| Fri 15:00 | Robot Agent errands with a real 0G decision; evidence uploaded to 0G Storage |
| Fri 19:00 | World approve/deny on the deployed app; wallet pages complete |
| **Fri 21:00** | ~~the full MUST loop on the deployed app~~ **done 12:39 IST with real 0G decisions** (`docs/evidence/2026-11-06-deployed-e2e.md` runs 9–10; World = stub until the client exists) |
| Sat 02:00 | stretch stops; README, diagram, Studio walkthrough |
| **Sat 06:00** | **feature freeze**: video (2:30–2:59), World debrief, contract addresses |
| Sat 09:00 | submitted (aim for 08:00) |

### Demo script (4-minute finalist slot; the video follows the same story)

| Time | Beat |
| --- | --- |
| 0:00 | The problem: don't give a robot your wallet, give it a budget |
| 0:20 | Owner (passkey, funded on Arc) grants Vitaquack's chip 3.00 USDC a day, 1.00 per payment, Duck Café only, on the consent screen (the form defaults; chai/samosa go through, the 2.00 thali needs World approval over the per-payment cap; a thali over the daily cap makes the robot walk away) |
| 0:50 | "Buy me a chai": 0G decides (show the request id) → the chip signs → paid on Arc (explorer link) → **the gate opens** |
| 1:50 | Thali 2.00, over the per-payment cap → Agent Pass on the phone → **approve: paid** → another thali → **deny: nothing paid** → a third is over the daily cap → the robot walks away |
| 2:50 | Revoke in the wallet → the next attempt fails on-chain |
| 3:20 | How it works: the architecture, our enforcer in Arc Studio, the episode log on 0G Storage |
| 3:50 | Close |

### Fallbacks, decided in advance

| If this fails | Then |
| --- | --- |
| Real-device passkey signing | the optional EOA owner on the Hybrid account signs (built in) |
| On-chain Agent Pass check | it is the stretch; the backend co-signer is the default |
| Bun on the Radxa | the Python signer from bench C1 (proven), or the mock chip on a laptop |
| Camera QR reading | the chip takes the invoice id from the merchant API; skip the scan |
| x402 payment too large for a header | it already goes in the POST body (spec §7) |
| 0G slow or down | that is the safe-stop we must show anyway; never fake a decision |
| Venue network | the dedicated phone hotspot |
| The duck doesn't walk | demo the Radxa reading a QR and signing; never block the payment on the gait |

### Submission checklist

See `docs/spec.md` §12 (ETHGlobal rules checked Fri 04:15: 3 partner prizes, the from-scratch disclosure, video 2–4 min
≥ 720p with real narration, 0G's < 3 min, contract addresses, World debrief).

## 1. The architecture, in one paragraph

Four systems in one Cloudflare Worker plus a chip client. The **wallet** (passkey login = passkey signer of a MetaMask
`HybridDeleGator` on Arc) grants a budget to a robot's **chip** address as a delegation with caveats (daily cap,
per-payment cap, payee allowlist, expiry, approval requirement). The **Robot Agent** (an Effect service with D1 state,
one errand at a time per robot) asks 0G for a structured decision, hands the invoice to the chip over HTTPS
long-polling, and submits the chip-signed voucher to the **merchant**'s x402 endpoint; our facilitator simulates and
settles it through the DelegationManager, and Arc checks every caveat. Restricted or over-cap purchases need a World
Agent Pass approval that the backend verifies and co-signs. Every decision is logged with its 0G request id and uploaded
to 0G Storage. Diagrams: the [architecture page](https://eth-mumbai-site.kristjan-grm11775.workers.dev/architecture/).
Build detail: `docs/spec.md`.

## 2. What is proven, what is not (honest labels)

| Claim | Evidence level |
| --- | --- |
| HybridDeleGator, SimpleFactory, DelegationManager and the enforcers are on Arc, byte-identical to Base | verified on-chain (`eth_getCode`) |
| A chip-signed voucher under a grant settles on Arc; replay and post-revoke payments are refused | **broadcast** (6 Nov 06:10, `docs/evidence/2026-11-06-smoke.md`: $0.01 settled, revoke tx; replay and post-revoke refusals simulated from the relayer) |
| A passkey-signed grant is accepted on-chain (ERC-1271 on the Hybrid account) | **broadcast** (6 Nov 06:32, deployed e2e with a virtual authenticator, `docs/evidence/2026-11-06-deployed-e2e.md`); real phones not yet |
| The enforcer (cap, allowlist, approval) behaves on Arc | **deployed** `0x7c21…e4D3` + 8-case live approval test against that code (`docs/evidence/contracts.md`); no approved payment broadcast yet |
| Chip pairing and 25 s long-polls through the deployed edge | **deployed** (edge holds 24.8 s, lease 35 s) |
| Merchant 402 / pay / signed gate status on the deployed app | **deployed** (`docs/evidence/2026-11-06-deployed-merchant.md`) |
| The real Radxa builds and signs the voucher the kit expects | **bench** (C1, 20/20), simulated settlement |
| A World RS256 token can be verified in an Arc contract bound to one payment | **prototype** (S5b, 43 tests, live `eth_call`); no real World token yet; stretch |
| 0G decides, logs, safe-stops; episodes on 0G Storage | **native with a stub** (16/16); **not run live** (needs `APP_ZG_*`); the deployed errand answers 503 until then |
| World approve / deny on the deployed app | **native with a stub** (10 token cases); **not run live** (needs the IdP client) |
| The full MUST loop on the deployed app | **not until a real 0G decision pays an errand** (`docs/evidence/demo-run.md`) |

## 3. Spikes

| # | Spike | Status |
| --- | --- | --- |
| S1 | real-device passkey → HybridDeleGator on Arc → passkey-signed grant → $0.01 relayed payment | open (M0a + M2) |
| S2 | our ERC-7710 facilitator: owner → chip leaf, then $0.01 real | simulated 14/14 (6 Nov); broadcast in M2 |
| S3 | 0G: a tool-calling model, latency, request ids | open (M5, needs the key) |
| S4 | ~~Robot Agent ↔ wallet MCP~~ | dropped (MCP off the path) |
| S5 | Agent Pass browser flow with `nonce`, approve and deny, with Kris's Orb ID | open (M6) |
| S5b | `HumanApprovalEnforcer` verifies a World token on Arc | prototype done; stretch |
| S6 | mock chip ↔ Robot Agent long-polling; then the Radxa with Bun + viem | open (M4; H3 retry) |
| S7 | the phone hotspot with the Radxa, ESP32 and laptops; H2, H6 on it | open (teammates) |
| S8 | walking policy on the new servos | open (teammates) |

Hardware bench results so far: C1 pass (the chip signs the plan's voucher); H1 partial (camera ribbon reseated, ≤ 57 °C);
H3 signing works in Python at 187 ms (Bun not yet tested); H4 venue Wi-Fi unusable → phone hotspot; H2/H6 not yet run.
Details: `docs/spikes/hardware-results.md`.

## 4. Booth questions

- **0G:** may Storage and `EpisodeLog` run on Galileo testnet? (Credits: we have them. Standard providers: decided.)
- **World:** how fast can we get a production IdP client; does "mocked proofs" apply to Agent Pass.
- **Arc:** can judges open a Studio URL without logging in; is a Studio-authored enforcer deployed to mainnet by us
  acceptable; a keyed RPC.

## 5. Alternatives considered and rejected

- **World Chain + 0G + ENS instead of Arc:** no World Chain prize; MetaMask's delegation contracts aren't on World
  Chain; gas in ETH; World's wallet can't grant allowances. ENS names could sit on top of Arc later.
- **The float path** (pull to the chip, then EIP-3009 via Circle): after the pull, Arc no longer binds payee, invoice
  or revocation. Later fix: a policy-bound escrow.
- **Verifying the World token on Arc by default:** publishes the owner's World pseudonym in calldata. Stretch only.
- **An Agents SDK / Goblin-style agent, WebSockets and MCP between our own components:** don't compose with the
  Effect/Alchemy foundation and add hours without adding security.
