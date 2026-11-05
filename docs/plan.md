# Plan v3: wallet → robot agent → merchant → chip

**v3.3, Fri 6 Nov 04:30 IST:** review round. Battle plan to the Saturday 09:00 deadline (§0), MVP scope, D15 decided (co-signer first), design gaps fixed.
**v3.2, 2026-11-06:** spikes S2 + S5b done (simulated / prototype), World Chain + ENS alternative assessed, decisions D15–D16 added.
**v3.1, 2026-11-06:** comment round 2 (on-chain Agent Pass check, mock chip, no simulator, bench results, network, servo wiring).
**v3, 2026-11-05 (late).** Updated from Kris's 13 comments on the v2 page and the Q&A that followed. The decisions are
recorded in `decisions.md` (plan v3 A–J).

**Sources:**
- round-2 research: `docs/research/{nod-froggy-patterns, wallet-accounts-v2, mcp-wallet-and-ai-client, merchant-and-agent-commerce, world-v2, robot-browser-and-mcp}.md`
- three read-only passes on 2026-11-05:
  - Goblin's agent stack (`~/code/goblin`)
  - x402 facilitators and 4337 on Arc
  - World Agent Pass and venue networking (summarised below)
- diagrams: the architecture page (`docs/site/architecture/`)

**Confidence markers:** **Known** (we know how to build it, verified in code or on Arc), **Uncertain** (one spike
settles it), **Unknown** (needs a sponsor's answer or research).

---

## 0. Battle plan to Saturday 09:00 IST (written Fri 6 Nov 04:30 IST)

**Deadline: submissions close Saturday 7 Nov 09:00 IST, no late entries.** As of Friday 04:30 no product code exists, only
the foundation, these docs and spike prototypes (S2, S5b, bench C1). Everything below is cut to fit about 28 hours.
Rules from <https://ethglobal.com/events/mumbai/info/details>, checked Fri 04:15.

### 0.1 Scope (Kris, Fri 04:30)

| | What |
| --- | --- |
| **MUST** (the demo) | Passkey wallet on Arc mainnet (HybridDeleGator) → grant to the chip (real Radxa or mock) → Robot Agent asks 0G and buys from our x402 merchant through our facilitator (grant path) → a restricted item needs Agent Pass (approve **and** deny) → revoke stops the next payment → 0G Storage episode log + `EpisodeLog` contract → our enforcer(s) built in Arc Studio → ESP32 shows the QR, the gate opens on a signed "paid" |
| **STRETCH** (only after the MUST loop works end to end) | On-chain Agent Pass verification (S5b prototype ready) replacing the co-signer · float path via Circle's facilitator · camera in the browser · duck walking to the stand |
| **CUT** for the event | MCP OAuth for outside hosts (claude.ai): the Robot Agent is the only MCP client · CCTP/Gateway funding from other chains (fund directly on Arc) · MPP · ENS · 4337 break-glass (document only) · IDKit |

### 0.2 Who does what

- **Kris + agents** run all three software lanes. Each lane is its own agent session in this repo, with Kris coordinating.
- **The teammates** handle the physical robot (duck build, Radxa OS, ESP32 wiring and servo, H2 QR reading) and the
  booth questions.

| Lane | Builds | Done when |
| --- | --- | --- |
| **A: wallet + chain** | Wallet web app (passkey signup, grant/consent page, approval page, revoke, activity); relayer = our x402 facilitator; `RobotPaymentPolicyEnforcer` (+ `HumanApprovalEnforcer` co-signer version) in Arc Studio, deployed to Arc mainnet | A grant from a real phone passkey; one relayed $0.01 payment on Arc mainnet |
| **B: brain** | Robot Agent DO (Agents SDK + pi-ai on 0G + wallet MCP client); evidence log → 0G Storage + `EpisodeLog` contract; Agent Pass request + backend check + co-signature | The agent decides on 0G, the request id is stored, and Agent Pass approve and deny both work |
| **C: chip + merchant** | Chip protocol (WebSocket: pair, sign request) with a mock chip and the Radxa runtime (Bun + viem; Python fallback from C1); merchant (store, x402 `accepts[]` ERC-7710, invoice API, signed status for the ESP32) | The mock chip and the Radxa both sign a grant-path voucher; the merchant settles it; the ESP32 shows PAID |

### 0.3 Checkpoints (IST)

| By | Checkpoint |
| --- | --- |
| **Fri 08:00** | Prerequisites done (0.4); spikes S1 (real-phone passkey), S3 (0G model and latency), S5 (Agent Pass returns our nonce) answered |
| **Fri 14:00** | **First end-to-end headless purchase on Arc mainnet** ($0.10, mock chip, our merchant, our facilitator) |
| **Fri 20:00** | Agent Pass approve/deny, revoke, 0G Storage log, the Radxa signing, the ESP32 gate opening: the full MUST loop |
| **Sat 02:00** | Stretch work stops; README, architecture diagram, Arc Studio walkthrough |
| **Sat 06:00** | **Feature freeze.** Video recorded, debriefs written, contract addresses listed |
| **Sat 09:00** | Submitted (aim for 08:00) |

### 0.4 Prerequisites (block everything; do first)

- [ ] **About $20 of USDC on Arc mainnet** in a test owner flow plus a relayer key. Nobody has funded one yet.
- [ ] **A keyed Arc RPC.** The public one throttles (−32005).
- [ ] **0G:** the teammate's API key in `~/.config/secrets.env`; 0G Chain gas for Storage and `EpisodeLog` (Galileo
  faucet, if the booth says testnet is fine).
- [ ] **World IdP client** registered (HTTPS redirect URI for the browser flow); sandbox and production access confirmed.
- [ ] **Arc Studio project** created; its shareable URL saved.
- [ ] **A product name** for the submission. "ETH Global Mumbai 2026" is a placeholder; earlier ideas were Vitaquack,
  Flock and Noah's Arc.

### 0.5 Submission checklist

- **ETHGlobal:**
  - name and description
  - public GitHub with real history (no large product commit)
  - a README section on **code that predates the event** (the foundation boilerplate from the public `styld.app` repo,
    commit `370a0e23`, imported as one commit on 5 Nov)
  - demo video 2–4 min, at least 720p, real narration (no AI voice, not sped up, not filmed on a phone), slides with at
    most 4 bullets
  - pick up to 3 partner prizes, each with how we integrated it and feedback
- **Arc** (Advanced Stablecoin Logic):
  - the shareable Studio URL; Studio **shown in the demo**
  - working frontend and backend
  - an architecture diagram (this page)
  - the video, with docs on the Arc and Circle tools used
  - GitHub
  - name the bounty
- **0G** (Physical AI):
  - a 0G call in the decision loop
  - an **episode log on 0G Storage with a request id per decision**
  - a live demo at the 0G booth, or a replayable run
  - a safe-stop (a faked fallback disqualifies)
  - **contract deployment addresses**
  - README setup steps
  - 0G asks for a video **under 3 min**, so cut it to **2:30–2:59** to satisfy both 0G and ETHGlobal
- **World** (Agent Pass):
  - the official Agent Pass
  - the full journey **including a deny / expired path**
  - validation in the backend
  - **a debrief**: time to first success, friction, one top improvement

### 0.6 Demo script (4-minute finalist slot; the video follows the same story)

| Time | Beat |
| --- | --- |
| 0:00 | The problem: don't give a robot your wallet, give it a budget |
| 0:20 | Owner (passkey, pre-funded on Arc) grants Vitaquack's chip $10/day on the consent screen |
| 0:50 | "Buy me a chai": the agent asks 0G (show the request id) → the chip signs → paid on Arc (explorer link) → **the ESP32 gate opens** |
| 1:50 | Restricted item (mock cigarette pack) → Agent Pass on the phone → **deny: nothing paid** → approve: paid |
| 2:50 | Revoke in the wallet → the next attempt fails on-chain |
| 3:20 | How it works: the architecture, our enforcer in Arc Studio, the episode log on 0G Storage |
| 3:50 | Close |

### 0.7 Fallbacks, decided in advance

| If this fails | Then |
| --- | --- |
| Real-device passkey (S1) | The 7702 EOA fallback |
| On-chain Agent Pass check | It's the stretch; the co-signer is the default (D15) |
| Bun on the Radxa | The Python signer from bench C1 (proven), or the mock chip on a laptop |
| Camera QR reading (H2) | The chip gets the invoice id from the merchant API; skip the scan |
| Facilitator x402 envelope too big | Trim caveats, then relay `redeemDelegations` directly without the x402 header |
| 0G slow or down | That's the safe-stop we must show anyway; never fake a decision |
| Venue network | The `duckbench` phone hotspot |

### 0.8 Design gaps found in the review (fixed below)

1. **The float path would bypass the merchant allowlist.** The chip can pull to itself and then pay any seller. Fix: the
   pull uses its own small cap (e.g. $1/day float budget). Float is a stretch anyway.
2. **How does Arc know an item is restricted?** Fix: approval is required when `amount > perPaymentCap` **or** the payee
   isn't on the grant's allowlist. The merchant sends restricted items to a separate payTo address that owners never
   allowlist, so they always need Agent Pass.
3. **Two ways to submit a payment** (wallet MCP `payment_submit` vs the x402 header to the merchant). Fix: robot
   payments go through x402 to the merchant only. The wallet MCP keeps balance/history, `approval_request` and
   `grant_change_request`. The chip already stores its grant (bench C1), so it builds the leaf itself.
4. **x402 header size** (≈ 12 KB permission context, more with a World token). **Uncertain:** test it against the
   Worker in S2's envelope test; trim caveats first.
5. **No map of the apps.** Fix: **one web app** with three parts: wallet (owner), robot console (camera, control,
   decision log) and merchant (store and checkout page). The ESP32 is the gate.
6. **Eligibility:** "from scratch" and "large single commits may be disqualified". Fix: README disclosure (0.5); all
   product code lands as small commits from now on.

---

## 1. The shape

| # | System | What it is |
| --- | --- | --- |
| 1 | **Wallet** (foundation) | Passkey signup (HybridDeleGator on Arc), fund, send, receive, **grants** to any address, an MCP server whose OAuth consent creates a grant, Agent Pass approvals. No Privy-style services. Prior art: Nod |
| 2 | **Robot Agent** | **One Cloudflare Durable Object per robot = the AI client.** It calls 0G, holds the wallet MCP connection, runs the plan/act loop, logs every decision, and talks to the chip over a WebSocket the chip opens. It runs with no chip (headless or sim). Goblin-inspired, robot-specific |
| 3 | **Merchant** | Store config (items, USDC prices, rules: needs approval / restricted), x402 checkout accepting both payment paths, and later the ESP32 gate |
| 4 | **Chip** | The robot's body and signer: the Radxa (real) or a **mock chip** (a Bun process, iteration 1). It holds the key the grant is delegated to and signs every robot payment. Camera and motors on the real one |

### The Grant (unchanged core)

```
Grant   = signed MetaMask Delegation Framework delegation: owner account → chip address
          caveats: USDC only (AllowedTargets/Methods), ValueLte(0), period cap, expiry,
                   + ours: RobotPaymentPolicyEnforcer (per-payment cap, merchant allowlist, a small separate float cap
                           for pulls to the chip itself),
                           HumanApprovalEnforcer (Agent Pass approval required when amount > per-payment cap OR the payee
                           is not on the allowlist; restricted items use a merchant payTo that is never allowlisted)
Payment = the chip signs a one-time leaf (exact USDC.transfer(payee, amount), IdEnforcer(invoiceHash), Timestamp);
          a facilitator calls redeemDelegations; Arc checks every caveat.
Owner action = the passkey signs a one-time delegation to the relayer (send, revoke, add passkey).
```

- **Known:** the grant chain was simulated on live Arc mainnet state (`wallet-accounts-v2.md` A1–A7).
- **Passkey-native is still a DeleGator.** "DeleGator" is MetaMask's name for their smart accounts that can create and
  redeem delegations:
  - our owner account is a `HybridDeleGator`: its own contract, its own address, the passkey as signer
  - the 7702 fallback is an EOA whose code points to `EIP7702StatelessDeleGator`
  - both use the same DelegationManager and caveats

---

## 2. System by system

### 2.1 Wallet

The wallet design is unchanged from v2, except for owner actions and approvals:

- **Account:** passkey-native `HybridDeleGator` via `SimpleFactory`, live on Arc. Decided (D1).
  - **Uncertain:** real-device passkeys (S1).
- **Signup:** our relayer deploys the account (≈ $0.005).
- **Funding:** USDC on Arc; other chains via CCTP or Gateway. "Connect MetaMask" means a funding source, or an extra signer.
- **MCP server:** `workers-oauth-provider` + `createMcpHandler` (for the event the Robot Agent is the only client;
  outside hosts like claude.ai are cut). **The OAuth consent page is the grant ceremony:** it
  shows the robot's name and **chip address** and the budget; the passkey signs.
- **Raising a budget:** the agent calls `grant_change_request`, which returns a link (or an in-chat prompt where the
  host supports it). The owner opens the wallet and the passkey signs a new grant.
- **MCP tools** (review fix: robot payments go over x402 to the merchant, never through the wallet MCP; the chip stores
  its grant and builds the leaf itself, as in bench C1):
  - `wallet_overview`, `payments_list`, `payment_status`
  - `approval_request` (Agent Pass for one payment), `grant_change_request` (raise the budget)
  - stretch: `float_pull` (exact-amount pull to the chip, capped by the float cap)
- **Owner actions (decision H):** the passkey signs a one-time delegation and **our relayer (the facilitator code)**
  submits it (≈ $0.006).
  - **Break-glass:** if MetaMask pauses the DelegationManager, an ERC-4337 v0.7 user operation via Pimlico's public
    bundler, with gas paid by the account in USDC from its own balance. HybridDeleGator v1.3.0 uses EntryPoint v0.7.
  - **Other chains** (gas isn't USDC): 4337 + a USDC paymaster, as in Goblin ADR 0050.
  - **Trust:** signatures bind exact actions and caps are on-chain, so no relayer or bundler can steal or redirect
    funds; at worst they delay.
  - Self-hosted bundler: no. No public Arc RPC exposes `debug_traceCall`; only paid Alchemy or our own node do.

### 2.2 Robot Agent (iteration 1 headless, iteration 2 with the chip)

- **Runtime:** a Cloudflare Agents SDK `Agent`, one per robot, with `schedule` for timeouts and wakes. Copy from Goblin
  (`~/code/goblin/apps/runtime/src/`):
  - `agent.ts`: the `Agent` + `schedule` pattern
  - `pi/model.ts`: pi-ai `openai-completions` pointed at the 0G router. Add the `onResponse` hook to capture 0G request
    ids, which Goblin doesn't do yet
  - `mcp/oauth/oauth-provider.ts` + `mcp/oauth/auth.ts`: the MCP OAuth client
  - `mcp/approvals/*`: hold the exact call, end the turn, continue on approval
  - `telemetry/pi.ts`: append-only run events (evidence)
- **Not copied:** personas, topics, subagents, apps, inbound MCP, the AG-UI shell, Effect layers.
- **0G:** standard providers (decision E), with the teammate's credits.
  - **Uncertain:** which tool-calling model, ideally with images (`glm-5.3-flash` / `qwen3.8-flash`), and latency (S3).
  - If 0G fails, the step takes no action. That's the prize's safe-stop.
- **Pairing (decision B):**
  1. The owner adds a robot in the wallet and gets a pairing code.
  2. The chip (real or virtual) generates its key, opens a WebSocket to its Robot Agent with the code, and proves its
     address by signing a challenge.
  3. Only then does the Agent connect to the wallet MCP. The consent screen shows "Vitaquack (0xChip…) wants $10/day",
     and **the grant's delegate is the chip address**.
- **Paying (decision C):**
  1. The Agent decides on 0G and fetches the merchant's x402 requirements.
  2. It sends the invoice to the chip, which builds the leaf from its stored grant.
  3. **The chip checks the invoice (on the real chip, one it scanned itself) and signs.**
  4. The Agent submits.
  - The Agent never holds a spending key.
- **Body:** camera frames (JPEG over the chip's WebSocket, fanned out to browsers while someone watches) and movement
  (`move {vx,vy,vyaw}`, 300 ms deadman, owner e-stop, human beats AI). From `robot-browser-and-mcp.md`.
- **No simulator** (dropped): iteration 1.5 is a virtual x402 resource instead.

### 2.3 Payments: grant + float (decision C)

| | Grant path | Float path |
| --- | --- | --- |
| For | Our merchant (accepts ERC-7710) | Any x402 seller that only takes EIP-3009 |
| How | Chip signs a one-time leaf → **our facilitator** → `redeemDelegations` | The chip pulls the exact amount (a grant payment *to itself*: `ExactCalldata(transfer(chip, amount))`, `IdEnforcer(invoice)`), waits for the receipt, then signs EIP-3009 (`validBefore` ≤ 120 s) → **Circle's Facilitator Service** |
| Limits enforced | All of them, on Arc, at payment time | All of them at the **pull**, plus a **separate small float cap** (review fix: otherwise the chip could pull to itself and pay any seller, bypassing the allowlist); the seller payment itself is a plain transfer |
| Cost | 1 tx: **≈ 663k gas ≈ $0.013** measured in spike S2 (≈ 505k / $0.010 with redundant caveats dropped; the passkey check and ~13 caveats dominate) | 2 txs, about 1 s on Arc, invisible to the user |
| On failure | Revert: nothing paid | Let the authorization expire (or call `cancelAuthorization`), then sweep the float back to the owner |

- **Our facilitator:**
  - **Known:** no shipping open-source ERC-7710 facilitator exists. x402 PR #1837 is a stalled draft; MetaMask's
    facilitator is hosted on Base and Monad only.
  - So we write ~150 lines with viem, from `references/danfinlay_x402@7710-implementation` (PR #1837) and
    `references/fireblocks_x402-facilitator` (`Erc7710Mechanism.ts`: DelegationManager allowlist, packed calldata).
  - Simulate with `account: relayer`, or the Redeemer caveat fails.
- **Circle's Facilitator Service** (**Known**, live check):
  - base URL `https://api.circle.com/v1/facilitator/x402`, x402 v2, `eip155:5042` with `exact` (+ `upto`)
  - auth: API key, or the keyless `Facilitator-Seller-Proof` (an EIP-712 signature by the payTo)
  - payer may be an EOA or a deployed ERC-1271 account; Circle pays gas; both sides are sanctions-screened
- **Our merchant lists both in `accepts[]`, EIP-3009 first,** because stock clients take `accepts[0]`. One routing
  facilitator client sends `authorization` payloads to Circle and `permissionContext` payloads to ours.
- **Prior art:** Goblin's archived wallet (tag `hackathon-2026-10`, ADRs 0045/0050) did ERC-7710 period allowances with
  **just-in-time top-ups** and x402/MPP on Base. Coinbase Sub Accounts' auto-spend (`references/base_account-sdk`) does
  the same pull-then-pay.
- **MPP later (decision D):** Circle's USDC MPP method is EIP-3009 and works on Arc by chain id
  (`references/tempoxyz_mpp-specs`, `references/wevm_mppx`). It would reuse the float path.

### 2.4 Merchant

- **Store config:** items, USDC prices, flags `needsApproval` / `restricted`, and a payout account.
- **Checkout:** x402 v2 with both entries in `accepts[]`, plus `payment-identifier` (idempotency).
- **Invoice binding:** `IdEnforcer(invoiceHash)`. One receipt is final.
- **Iteration 2:** the ESP32 gate keeps the `bench-answers.md` endpoints:
  - Ed25519-signed status with a gate nonce, verified with Monocypher `crypto_ed25519_check`
  - a `used` state, so a cached `paid` can't reopen the gate
- **Restricted items** (the mock cigarette pack) need a **fresh Agent Pass approval**, not an age proof (see 2.5).

### 2.5 World: Agent Pass, verified on Arc (decision F, updated)

- **What Agent Pass is:** ETHGlobal's name for **World IdP**, World's OIDC sign-in at `auth.world.org`.
  - **Known:** World IdP itself uses no chain. World *does* have its own chain (World Chain) for its wallet and on-chain
    World ID proofs, but Agent Pass doesn't touch it.
  - It returns an **RS256-signed ID token** (JWKS at `/.well-known/jwks.json`, RSA-2048).
- **Decided: the approval is verified on Arc itself** (Kris, 2026-11-05), so our backend is no longer a trusted approver.
  - **Flow:** World IdP's **browser (authorization-code) flow**, not the device flow, because only the browser flow
    accepts a `nonce` and echoes it into the token. We set `nonce` = the EIP-712 hash of
    `{invoiceHash, amount, payee, expiry}` and use `max_age=0` / `prompt=login` to force a fresh World ID check. The
    owner opens the approval on their phone from our wallet page, which shows item, amount, payee and invoice. World
    App itself can't show what is approved.
  - **On-chain check:** `HumanApprovalEnforcer` (built in Arc Studio) receives the raw token in the caveat args,
    RSA-verifies it with OpenZeppelin `RSA.pkcs1Sha256` (modexp precompile, ≈ 33k gas) and parses the claims (≈ 100–300k
    gas; < $0.01 total). It checks:
    - `iss`, `aud`, `exp`, `sub` = the owner's World pseudonym (stored at setup)
    - `nonce` = this payment
    - `auth_time` recent
    - `amr` contains `pop` **and not `mfa`** (spike S5b: a passkey-only sign-in is `["pop","user","mfa"]`, so `pop` alone isn't enough)
    - `jti` not used before (stored)
  - **Remaining trust:** World IdP, plus whoever registers World's public key on Arc (a key-admin role; handle key
    rotation). Arc itself is permissioned proof-of-authority (Circle + about 11 validators).
  - **For the 09:00 deadline (D15): the backend co-signer is the default.** Our backend verifies the token (same
    checks) and co-signs EIP-712; `HumanApprovalEnforcer` checks the co-signature. The on-chain verifier (S5b
    prototype, 43 tests) is the stretch swap.
- **Deny / cancel:** the owner refuses in World App, or never completes it. Then no token exists, so the voucher can't
  pass the enforcer and nothing is paid.
- **Agent Pass vs the MCP grant:** the grant is the **standing budget** (passkey, in our wallet). Agent Pass is a
  **one-off exception** for one over-limit or restricted payment (World App). Raising the budget is a new grant, not
  Agent Pass.
- **World's wallet can't replace ours:** "World Money" is a Safe on World Chain only. World's SDK refuses other chains
  for transactions, a Safe can't be a Delegation Framework delegator, and World resets allowances after each
  transaction. A World mini app could at most fund our Arc account (World Chain → Arc via CCTP/Gateway).
- **Setup:** register a client at `auth.world.org/portal` (HTTPS redirect URI, `client_secret_basic`); sandbox at
  `sandbox.auth.world.org`; Kris has an Orb-verified ID.
- **Dropped:** the IDKit `HumanRegistry` / 18+ path. AgentKit (archived, no age).

### 2.6 Venue network (decision I, updated by bench H4)

- **Bench H4 finding:** the venue Wi-Fi is unusable for the robots: about 3 KB/s, pings up to 2.5 s, a 1 MB `scp` never
  finished.
- **Primary: a dedicated phone hotspot.** Pixel, 2.4 GHz, WPA2, name `duckbench`, shared by the Radxa, the ESP32 and the
  laptops. Use its own mobile data (a local SIM) as the uplink.
- **Alternative: macOS Internet Sharing** from a *wired* Ethernet uplink. Settings:
  - channel 1, 6 or 11
  - WPA2/WPA3 (never WPA3-only)
  - Radxa `key-mgmt wpa-psk`; ESP32 `setMinSecurity(WPA2_PSK)`
  - run `caffeinate -dis`
- **Doesn't work:** reverse-tethering into the Android hotspot (hotspot clients bypass gnirehtet's VPN).

### 2.7 ESP32 gate wiring

- **A micro servo (SG90 / MG90S) needs no extra chip:**
  - signal to a GPIO (e.g. GPIO 13; 3.3 V logic is fine)
  - **power from a separate 5 V supply of at least 1 A**, not the ESP32's 3.3 V pin
  - grounds joined
  - a 470 µF capacitor across the servo supply
  - code: ESP32Servo `attach(pin, 500, 2400)`
- Powering the servo from the ESP32 over the Mac's USB can brown-out-reset the board. A PCA9685 driver only matters for
  many servos.

### 2.8 Bench results so far (`docs/spikes/hardware-results.md`, 2026-11-06)

| Spike | Result |
| --- | --- |
| C1: the chip signs the plan-v3 voucher | **Pass, 20/20 checks**: hashes and caveats match MetaMask's kit; on live Arc the voucher pays the merchant, a different amount or payee fails, a replay fails |
| H1: Radxa health | Partial: OS and camera known, ≤ 57 °C in a short capture. The overheating was the camera ribbon: fixed by reseating it striped face up |
| H3: signing speed | Python signing works but takes 187 ms (pure-Python recovery); Bun + viem or libsecp256k1 needed. **Bun not yet tested** |
| H4: venue network | Venue Wi-Fi unusable, so a dedicated phone hotspot (above) |
| H2, H5, H6 | Not yet run: QR read from the ESP32 screen, frames over WebSocket, the signed bench loop |

---

## 3. Iterations

| Iteration | Build | Done when |
| --- | --- | --- |
| **0: Wallet** | Passkey signup and deploy, fund, send/receive, grants UI, MCP server with OAuth-consent-as-grant, Agent Pass approvals | Sign up with a passkey only, receive $1, send $0.10, connect a client with a $2/day grant, revoke it, on Arc mainnet with no gas shown |
| **1: Headless commerce** | Robot Agent DO + **mock chip** (a Bun script with its own key, one per teammate; the real Radxa pairs over the internet with the same code) + merchant (both payment paths) + our facilitator | The agent (0G) buys a normal item (grant path); a restricted or over-limit item (Agent Pass approve → paid, deny → nothing); an item from an EIP-3009-only seller (float path via Circle); revoke stops everything; every 0G decision is logged |
| **1.5: Virtual resource** (no simulator) | The chip buys a virtual resource: an x402 API (data, an image, a song) | The full flow without hardware: 0G decides, the chip signs, payment settles, Agent Pass for a restricted item, verified on Arc |
| **2: Hardware** | Radxa chip (same TS code), webcam, ESP32 gate | The duck scans the ESP32 QR, the chip signs, the gate opens on a signed "paid" |

---

## 4. Decisions

All of D1 and plan v3 A–J are recorded in `decisions.md`. Still open:

| # | Decision | Recommendation |
| --- | --- | --- |
| D7 | Who pays relayer gas | We absorb it (≈ $0.013 per payment measured in S2; ≈ $0.006 per owner action) |
| D9 | Recovery | Several passkeys now; guardians later |
| D10 | Accounts on other chains | Arc-only; other chains are funding routes |
| D11 | MetaMask can pause the DelegationManager | Accept; the 4337 break-glass path covers it |
| D13 | Who may watch or drive the robot | Owner drives; judges view |
| D15 | **Decided (Kris, Fri 04:30): backend co-signer first, on-chain verification as a stretch** (with the privacy note in the pitch). Background: **The World token becomes public calldata** when verified on-chain: it carries the owner's per-app `sub` (and an email-like claim), so all of one owner's approvals are linkable on Arc; World's guide says to keep the token server-side (spike S5b) | Accept for the demo with a note; or verify on-chain but send only what's needed (not possible: the signature covers the whole payload); or fall back to the backend co-signer |
| D16 | **Decided 2026-11-06 (Kris): Arc + 0G + World.** ENS names are an optional add-on (UX, about a day); the prize picks are finalised at submission. Background: **Third partner prize: Arc or ENS.** ETHGlobal caps a project at 3 partner prizes; 0G and World stay. Arc Advanced Stablecoin Logic $3k (one winner, needs Arc Studio) vs ENS "Best Use of ENSv2" $7k (4 places, ENSv2 on Ethereum mainnet or Sepolia, must be central) | Keep Arc if the enforcers are really built and shown in Studio; switch to ENS if Studio is painful or ENS names (robots/merchants as agent namespaces) become central. Decide by Saturday |

---

## 5. Spikes, in order

| # | Spike | Settles |
| --- | --- | --- |
| S1 | Real-device passkey → HybridDeleGator on Arc → passkey-signed grant → $0.01 relayed payment | The wallet |
| S2 | Our ERC-7710 facilitator: owner → chip leaf, then $0.01 real. **Done (simulated, 2026-11-06): 14/14 cases on live Arc state** via `eth_call` with state overrides (a plain anvil fork can't move Arc USDC: the native-coin precompile is missing). Correct revert reasons for wrong amount/payee, replay, expiry, cap, revoke. Left: a real broadcast, receipt logs, the x402 envelope (≈ 12 KB header) | Grant path |
| S2b | Float path: pull to chip → EIP-3009 through Circle's facilitator on Arc, $0.01 | Float path |
| S3 | 0G with the teammate's credits: tool-calling model, latency, request ids via pi-ai `onResponse` | Robot Agent brain; 0G prize |
| S4 | Robot Agent DO: pi-ai loop + MCP OAuth client ↔ our wallet MCP | Agent ↔ wallet |
| S5 | Agent Pass **browser flow with `nonce`** (approve and deny) with Kris's Orb ID: confirm the token echoes the nonce, plus the `acr`/`amr`/`auth_time` values | World |
| S5b | `HumanApprovalEnforcer` verifies a World RS256 token on Arc. **Done (prototype, 2026-11-06): 43 forge tests pass; also run on live Arc via `eth_call`; ≈ 409k gas ≈ $0.008.** The kid is the RFC 7638 thumbprint, computed on-chain at registration. Left: a real World token carrying our nonce (S5, Kris's phone), key rotation, wrapping it as the caveat | Trust-minimised approval |
| S6 | Mock chip ↔ Robot Agent WebSocket: pairing, sign request; then the real Radxa with Bun + viem (H3 retry) | Chip protocol |
| S7 | The `duckbench` phone hotspot with the Radxa, ESP32 and laptops; H2, H5 and H6 on it | Venue network, camera, bench loop |
| S8 | Walking policy on the new servos | Teammate |

## 6. Booth questions

- **0G:** the Physical AI prize **requires an episode log on 0G Storage** (plus a contract address), so Storage + `EpisodeLog` are build items, not optional; ask only whether Galileo testnet is acceptable. (Credits: we have them. Standard providers: decided.)
- **World:** what "mocked proofs" covers for Agent Pass; time to get a production client.
- **Arc:** can judges open a Studio URL without logging in; is a Studio-built enforcer module deployed to mainnet by us
  acceptable; Circle facilitator minimum amount; a keyed RPC.

## 7. Alternative considered: World Chain + 0G + ENS (2026-11-06, `docs/research/worldchain-ens-alternative.md`)

- **Not worth it:**
  - no World Chain or mini-app prize exists at Mumbai, and World's tracks don't depend on the chain
  - MetaMask's delegation contracts aren't on World Chain (≈ 45 contracts to deploy, every Arc simulation and bench C1 to redo)
  - Circle's facilitator doesn't support chain 480
  - gas is ≈ 5× cheaper but paid in ETH
  - the World App wallet still can't grant a standing allowance
- **What survives: ENS names on top of Arc.** Robots and merchants as subnames under our own `.eth`, holding their Arc
  address (ENSIP-11) and agent records. About 0.5–1 dev-day, ≈ 8 USDC/year for the parent name. It matters only if
  ENS takes the third prize pick (D16).

## 8. What v3 supersedes

- **v2's separate AI client + RobotSession + robot MCP** → one Robot Agent per robot.
- **v2's "sub-grant to the robot"** → the grant's delegate is the chip directly.
- **The IDKit `HumanRegistry` and 18+ age rule** → dropped: restricted items need Agent Pass.
- **Agent Pass via device flow + backend co-signer** → browser flow with `nonce` = invoice hash; backend co-signer as the default for the event, on-chain verification as the stretch (D15).
- **Iteration 1.5 simulator** → a virtual x402 resource; **virtual chip** → mock chip per teammate.
- **"Our relayer submits everything"** → our facilitator/relayer for grant payments and owner actions, Circle's
  facilitator for float payments, 4337 as break-glass.
- **Reverse-tether network idea** → a dedicated phone hotspot (macOS Internet Sharing from wired Ethernet as the alternative).
