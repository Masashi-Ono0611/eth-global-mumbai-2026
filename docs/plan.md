# Plan v2: wallet → AI client → merchant → robot

Written 2026-11-05 after research round 2. Sources: `docs/research/{nod-froggy-patterns, wallet-accounts-v2,
mcp-wallet-and-ai-client, merchant-and-agent-commerce, world-v2, robot-browser-and-mcp}.md` (round 2) and the
round-1 notes. Diagrams: the architecture page (`docs/site/architecture/`). Where this plan and
`decisions.md` disagree, the disagreement is listed under **Decisions for Kris** and `decisions.md`
stays authoritative until one is made.

Confidence markers used throughout: **Known** (we know exactly how to build it, verified in code or
on Arc), **Uncertain** (we believe it works; one spike settles it), **Unknown** (needs research, a
sponsor's answer or a decision).

---

## 1. The shape: four systems, built in order

| # | System | What it is | Closest prior art |
| --- | --- | --- | --- |
| 1 | **Wallet** (foundation) | Passkey signup, a USDC account on Arc, fund/send/receive with no gas visible, **grants** to any grantee, World verification, an MCP server whose OAuth consent creates a grant. No Privy-style services: only open contracts, open libraries and our own Workers | Nod (`~/code/hack-meridian-2026`): same product on Stellar, already proven with claude.ai and ChatGPT |
| 2 | **AI client** | A 0G-powered agent (Cloudflare Agents SDK `Agent`, one Durable Object per session) connected over MCP to the wallet, the merchant and later the robot. It plans and calls tools; it never sees keys or payment payloads | `s0nderlabs/remit` (wallet MCP with server-held keys and sub-cards, Base mainnet) |
| 3 | **Merchant** | Store config (items, USDC prices, rules like 18+), checkout over **x402 v2**, our own facilitator on Arc, payment verification, receipts. In iteration 2 it also drives the ESP32 QR gate | Circle `arc-ecommerce-payments`, `modeofO/402-hardware` (ESP32 x402 terminal) |
| 4 | **Robot** | The duck (Radxa Zero 3W): own key, camera, walking. Connects outbound to a `RobotSession` Durable Object; exposed to the AI client as a robot MCP server; camera and control in the browser | Microduck `robotd`/`mediad`, quackd (Open Duck LLM bridge) |

**World** isn't a fifth system. It's a feature of the wallet (verify once, approve over-limit) and of
the merchant (enforce 18+).

### The one abstraction that ties them together: the Grant

The wallet doesn't know what a grantee is. Every grantee (an MCP AI client, a robot, a browser-held
"person link") is handled the same way:

```
Grant = signed MetaMask Delegation Framework delegation
        delegator : the owner's account (or a parent grantee, for a sub-grant)
        delegate  : an address the grantee gave us
        caveats   : USDC only (AllowedTargets + AllowedMethods), ValueLte(0) [closes the native-USDC exit],
                    period cap (ERC20PeriodTransfer / TransferAmount), expiry (Timestamp),
                    + ours where needed: per-payment cap, merchant allowlist, human-approval co-signature
      + metadata  : label, custody (wallet-held | grantee-held), parent grant, created/revoked
Payment = the grantee signs a one-time leaf delegation (exact USDC.transfer(payee, amount),
          IdEnforcer(invoiceHash), Timestamp(deadline)); our relayer calls redeemDelegations([leaf, …, root]);
          Arc checks every caveat on the whole chain, so a sub-grant can only narrow its parent.
Owner action (send, revoke, add passkey) = the owner's passkey signs a one-time delegation to the relayer.
```

- **Known:** the contracts are on Arc mainnet, and the whole chain owner → AI client → robot → one-time
  payment was simulated against live mainnet state: over-cap payments revert and revoking a parent kills
  the subtree (`wallet-accounts-v2.md` spike A1–A7).
- **Uncertain:** only real broadcasts and real-device passkeys are missing.

**Custody** of the grantee key:
- **wallet-held:** we keep one key per grant, encrypted, for MCP hosts like claude.ai that can't hold
  keys. That's Nod's model, and it's what iteration 1 uses.
- **grantee-held:** the robot generates its key on the Radxa and only its address comes to us.

---

## 2. System by system

### 2.1 Wallet (iteration 0)

| Piece | Choice | Confidence |
| --- | --- | --- |
| Account | **MetaMask `HybridDeleGator`** (passkey signer verified on-chain with Arc's P-256 precompile) deployed by `SimpleFactory`, both live on Arc. Fallback: an EOA upgraded with 7702 (`EIP7702StatelessDeleGator`), key unlocked by the passkey (PRF) | Contracts **Known** (byte-identical to Base); real-device passkeys **Uncertain** (spike S1). **Reopens `decisions.md`: see D1** |
| Signup | Browser creates a passkey → our relayer deploys the account (~245k gas, ≈ $0.005) → same address forever | **Known** (simulated) |
| Gas | No bundler. Our relayer (a Durable Object owning the nonce, maxFee ≥ 20 gwei) submits every action and pays in USDC | **Known** design; real relayer tx **Uncertain** |
| Funding | (a) USDC on Arc → send to the address. (b) Other chains → CCTP with forwarding, or Gateway deposit + mint to our Arc address; Circle submits, so no gas for the user. (c) "Connect MetaMask" = funding source (plus optionally adding that EOA as an extra owner key) | (a) **Known**; (b) **Uncertain** (small real transfer); (c) **Known** that ERC-7715 session keys only work in MetaMask's browser extension, so we don't build on them |
| Send / receive | Send = owner one-time delegation, relayed. Receive = show the address/QR; the activity ledger is the Nod ledger Durable Object ported | **Known** (pattern + contracts) |
| Cross-chain send out | Gateway burn intent signed by the account (ERC-1271, `contractSigner: true`) from Arc, minted on the destination by Circle's forwarder | **Uncertain** (spike S6; signature-size limits unknown) |
| Swap | Probably only USDC↔EURC (StableFX/App Kit) | **Unknown** (does App Kit swap support Arc mainnet with a smart account?) |
| Recovery | Several passkeys per account (synced passkeys + a second device) | **Known**; guardians/time-locks **Unknown** (D9) |
| World | IDKit 4.x in the wallet (Foldkit, no React) → our backend calls `/v4/verify` → writes `HumanRegistry` on Arc | IDKit core without React **Known**; inside Foldkit/Vite **Uncertain** (S5); registry design see 2.5 |
| MCP server | `workers-oauth-provider` 1.2.4 + Agents SDK `createMcpHandler` (MCP 2026-07-28 plus older clients). **OAuth consent page = grant ceremony**: the passkey signs one delegation, which costs no transaction | OAuth with real hosts **Known** (Nod); on SDK v2 + Arc **Uncertain** (S4) |
| MCP tools | `wallet_overview`, `payments_list`, `payment_status`, `pay_quote`/`payment_prepare`, `pay_execute`/`payment_execute`, `grant_change_request`, `subgrant_create`/`subgrant_submit`/`subgrant_revoke`, `paid_fetch` (x402 client) | **Known** (Nod's tool set, adapted) |
| Approvals that need the human | Every approval comes back as **a link in the tool result** (claude.ai can't prompt mid-call); elicitation, MCP Apps cards and Telegram delivery go on top. The passkey can't sign inside an MCP App iframe | **Known** (Nod; MCP Apps permission list) |
| Revoke | Two steps, both shown: service-side stop (instant) + on-chain `disableDelegation` (kills the subtree). Panic: `NonceEnforcer` bump revokes every grant | **Known** |

### 2.2 AI client (iteration 1)

- **Runtime:** a Cloudflare Agents SDK `Agent` (Durable Object), on its own origin, with a thin Foldkit
  view. The 0G key stays in the Worker, never in the browser.
- **Tools come from MCP:**
  - the **wallet** MCP (OAuth handled by the Agents SDK `MCPClientManager`)
  - the **merchant** (plain x402 over `paid_fetch`; it needs no MCP server in iteration 1)
  - the **robot** MCP (iteration 2)
- **Payment code stays deterministic.** The LLM chooses *what* to buy; wallet code runs the x402
  exchange. No signatures or payment payloads ever go into the model.
- **0G:** the OpenAI-compatible router, with tools and streaming documented. Log every
  `x_0g_trace.request_id` / `ZG-Res-Key` as evidence; if a 0G step fails, take no action that step.
  - **Uncertain:** which model handles the tool loop (`glm-5.3-flash` vs `qwen3.8-flash`), and whether
    AI SDK copes with their reasoning + tool-call deltas (S3).
  - **Unknown:** TEE/"private" providers and `0gm-1.0` disappeared from the catalogue on 2026-11-05
    18:40 UTC; there's no API key or credits yet. Ask at the 0G booth.

### 2.3 Merchant (iteration 1, extended in 2)

- **Store config:** items, USDC prices, flags (`ageRestricted`, `needsHumanApproval`), and a payout
  account, which can itself be a wallet in our system.
- **Checkout = x402 v2:**
  - `402` → `PaymentRequirements` with two `accepts[]` entries: `exact`+**ERC-7710** (our grants) and
    `exact`+EIP-3009 (any plain wallet)
  - extensions `payment-identifier` (idempotency) and **our `buyer-eligibility`** (18+ out, proof back)
- **Facilitator:** our own, about 150 lines.
  - **Known:** nobody ships an open ERC-7710 facilitator; MetaMask's hosted one doesn't cover Arc.
  - It simulates, then calls `redeemDelegations`.
  - **Uncertain:** a two-hop chain on an Arc fork plus one real $0.01 payment (S2).
- **Invoice binding:** `IdEnforcer(invoiceHash)` in the payment leaf, so Arc refuses a second payment
  for the same invoice (**Known**). Arc's `Memo` can't be used from relayed 7702 payments (**Known**).
- **Verification:** one receipt is final on Arc. Watch the 6-decimal ERC-20 log and de-duplicate the
  18-decimal system log. The public RPC throttles, so we need a keyed endpoint (**Known**).
- **Iteration 2:** the `bench-answers.md` invoice endpoints stay, with these changes:
  - `POST /invoices/:id/payments` becomes the x402 endpoint
  - the gate status is Ed25519-signed with a gate nonce, verified with Monocypher's
    `crypto_ed25519_check`. The default `crypto_eddsa_*` uses BLAKE2b and won't verify (**Known**)
  - a new `used` state, so a cached `paid` can't reopen the gate

### 2.4 Robot (iteration 2)

- **Layers:**
  - **On the Radxa:** walking policy (50 Hz) and navigation (5–10 Hz), which work offline.
  - **On the Radxa, toward the cloud:** the robot runtime (key, camera, an outbound WebSocket to `RobotSession`).
  - **In the cloud:** the 0G brain via the AI client.
- **Key:** generated on the Radxa and never leaves it. Encrypted keystore now; NXP SE050 (C2) later
  (`decisions.md`). The robot is a **grantee-held sub-grant** of the AI client's grant.
- **Camera → browser:** JPEG frames over the robot's WebSocket, fanned out by the Durable Object; works
  behind any NAT; frames flow only while someone is watching. Use a USB webcam (MJPEG) to avoid the risky
  CSI connector. WebRTC (go2rtc + Cloudflare TURN) is a stretch.
  - **Uncertain:** latency on venue Wi-Fi (S7).
- **Browser control:** gamepad or keys send `move {vx,vy,vyaw}` at 10 Hz, then an explicit zero. Three
  stop layers: a 300 ms deadman on the robot, one driver at a time with an owner-only e-stop in the DO,
  and the power switch. Priority: e-stop > human > AI. Open Duck Mini has no network API or deadman
  upstream; copy quackd's driver pattern.
- **Robot MCP** (served by our Worker, not the robot): `robot_status`, `look` (image), `scan_qr` (plain
  decode), `move` (≤ 2 s), `approach_qr` (a steering skill below the LLM), `stop`, and
  `pay_scanned_invoice`. The robot signs **only invoices it scanned itself**, under its sub-grant (D3).
  The AI's control lease is renewed only by fresh 0G decisions, so it lapses (duck stops) when 0G is down.
- **Virtual robot first:** fork Pollen's Microduck browser sim (MuJoCo WASM + its real walking policy):
  add our WebSocket input, a head-camera JPEG, and a merchant stand showing a QR. Fetch its meshes at
  runtime: they are CC BY-NC-SA.
- **Unknowns:** which OS is on the Radxa; whether the walking policy works on the new servos (needs a
  GPU retrain); fall handling (a human spotter).

### 2.5 World, across systems

| Need | Design | Confidence |
| --- | --- | --- |
| **18+ rule** | Owner verifies once in the wallet (IDKit, signal = account) → our backend verifies with `/v4/verify` → writes `HumanRegistry` on Arc (`account → human, adult, verifiedAt`). The merchant (or a caveat on restricted payments) checks the **paying root account**: with delegations, the payer is always the owner's account, even when the robot pays | Registry + check **Known** pattern (World's `AddressBook` is a template) |
| …age basis | No World ID proof carries age. "18+" = **Orb-verified** (World only lets 18+ users verify at an Orb): a policy, not cryptography. IDKit `identityCheck`/`minimum_age` is a preview needing World's approval, and its result is unsigned | **Known**; D4 |
| …on-chain verify on Arc | World's verifier on Arc has **no issuer keys** (`verify()` reverts `UnregisteredIssuerSchemaId`) and receives roots only **hourly**, so fresh proofs mostly fail. Until fixed: our backend writes the registry. A permissionless `propagateState` on World Chain could fix the keys; ask World first | **Known** (measured); fix **Uncertain** (D5) |
| **Over-limit / restricted approval** | World Agent Pass device flow (OIDC) → backend co-signs an EIP-712 approval for that invoice → a `HumanApprovalEnforcer` on the root grant requires it above the cap, so it also binds the robot. Deny/expire → no signature → revert | Flow **Known** (official `human-in-the-loop` reference); enforcer through a two-hop chain **Uncertain** |
| **World ID ↔ x402** | It's **AgentKit** (with Coinbase, 2026-03-17): an `agentkit` header plus AgentBook on World Chain/Base. Unique human, **no age**; modes are discounts/free trials, not gates; **repo archived 2026-10-20**. Optional compatibility header at most | **Known** |
| Proof portability | A proof can't be handed to an agent or replayed later (≤ ~1 h life; every production proof needs the owner's phone). So the registry (not forwarded proofs) is what travels with a grant | **Known** |

---

## 3. Iterations

| Iteration | Build | Done when |
| --- | --- | --- |
| **0: Wallet** | Passkey signup + account deploy; fund (Arc direct, then CCTP); send/receive; activity; grants UI (create/revoke); World verify → registry; MCP server with OAuth-consent-as-grant | A new user signs up with only a passkey, receives $1, sends $0.10, connects claude.ai over MCP with a $2/day grant, and revokes it, all on Arc mainnet with no gas shown |
| **1: Headless commerce** | Merchant (store config + x402 + our facilitator + `buyer-eligibility`); AI client (Agents SDK + 0G + MCP); a **headless "robot" grantee** (a script holding its own key under a sub-grant) | The AI client buys a normal item (pays); an 18+ item (pays only if the owner is verified, otherwise reverts); an over-limit item (World approve → pays, deny → no payment); the headless robot buys with its sub-grant; revoke stops everything. Every 0G decision is logged |
| **1.5: Virtual robot** | Robot MCP + `RobotSession` + browser camera/teleop, driven by the Microduck sim fork | The AI client walks the sim duck to the sim stand, scans the QR, the sim robot pays; the browser shows the camera and can take over |
| **2: Hardware** | Radxa runtime (key, webcam, WebSocket); ESP32 gate (QR, signed status, servo); the duck | The real duck (walking or teleoperated) scans the ESP32 QR, pays under its sub-grant, and the gate opens on a signed `paid` |

---

## 4. Decisions for Kris

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Owner account: **passkey-native `HybridDeleGator`** vs the locked "EOA + 7702" | HybridDeleGator for passkey signups (no PRF gap, passkey verified on-chain, same grant system); 7702 only as fallback |
| D2 | AI client key custody in iteration 1 | Wallet-held per grant (works with any MCP host); grantee-held for robots |
| D3 | Does the robot sign its own payments? | Yes, only for invoices it scanned, under its sub-grant |
| D4 | 18+ basis for the demo | "Orb-verified = 18+" now; try IDKit `identityCheck` at the World booth |
| D5 | `HumanRegistry` writer | Our backend after `/v4/verify` now; ask World about `propagateState` before calling it ourselves |
| D6 | The public registry reveals "account X is a verified adult" | Accept for the demo; note pairwise alternatives |
| D7 | Who pays relayer gas | We absorb it (≈ $0.004–0.008/action) |
| D8 | Can the AI client create sub-grants inside its limit without the owner? | Yes, but show them in the wallet with one-tap revoke |
| D9 | Recovery | Several passkeys now; guardians later |
| D10 | Accounts on other chains? | Arc-only; other chains are funding/withdrawal routes |
| D11 | MetaMask's DelegationManager can be paused by one MetaMask EOA on Arc | Accept; note a 4337 break-glass path as future work |
| D12 | Restricted demo item needs age **and** a fresh approval? | Both, so the 18+ rule and the Agent Pass deny path show |
| D13 | Who may watch or drive the robot | Owner drives; judges get a view-only link |
| D14 | Radxa OS image | Tell us what's on it; decides hardware video and Pollen reuse |

---

## 5. Spikes (Uncertain → Known), in order

| # | Spike | Settles |
| --- | --- | --- |
| S1 | Real-device passkey (iPhone, Android, laptop) → deploy a `HybridDeleGator` on Arc → passkey-signed grant → one real $0.01 relayed payment | D1, the whole wallet |
| S2 | Our x402 ERC-7710 facilitator: owner → agent → leaf on an Arc fork, then one real $0.01 | Merchant checkout |
| S3 | 0G key + tool-calling model + latency + `request_id` in streams | AI client; the 0G prize |
| S4 | Agents SDK `MCPClientManager` ↔ our wallet MCP (OAuth/CIMD) + claude.ai on MCP SDK v2 | Wallet ↔ AI client |
| S5 | IDKit 4.6 in Foldkit + `/v4/verify` + registry write; Agent Pass device flow end to end | World |
| S6 | Gateway `contractSigner` with a 544-byte passkey signature, Arc → Base, $1 | Cross-chain send |
| S7 | Robot JPEG over the Durable Object from venue Wi-Fi; Radxa CPU; UVC formats | Robot camera |
| S8 | Walking policy on the new servos (GPU retrain) | The duck walking |

## 6. Sponsor booth questions

- **0G:** credits or API key; when TEE/"private" providers and `0gm-1.0` come back; whether testnet is acceptable.
- **World:**
  - what "mocked proofs" covers
  - `identityCheck`/`minimum_age` access this weekend
  - Arc verifier issuer keys and root bridging (`propagateState`)
  - whether Cross-App Access is coming to production
  - does anyone on the team have an Orb-verified ID?
- **Arc:** can judges open a Studio URL without logging in; a keyed RPC endpoint for the relayer and watcher.

## 7. What this supersedes

- `decisions.md` "Owner wallet: EOA + 7702": pending D1.
- The offline-payment beat drops from the main demo. The leaf-delegation design still supports it later.
- The round-1 architecture (a single system) is replaced by the four-system split; `infrastructure.md`'s
  Durable Objects remain (RobotSession, Invoice → merchant, Approval, Relayer, ChainWatcher).
