# Plan v3: wallet → robot agent → merchant → chip

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

## 1. The shape

| # | System | What it is |
| --- | --- | --- |
| 1 | **Wallet** (foundation) | Passkey signup (HybridDeleGator on Arc), fund, send, receive, **grants** to any address, an MCP server whose OAuth consent creates a grant, Agent Pass approvals. No Privy-style services. Prior art: Nod |
| 2 | **Robot Agent** | **One Cloudflare Durable Object per robot = the AI client.** It calls 0G, holds the wallet MCP connection, runs the plan/act loop, logs every decision, and talks to the chip over a WebSocket the chip opens. It runs with no chip (headless or sim). Goblin-inspired, robot-specific |
| 3 | **Merchant** | Store config (items, USDC prices, rules: needs approval / restricted), x402 checkout accepting both payment paths, and later the ESP32 gate |
| 4 | **Chip** | The robot's body and signer: the Radxa (real) or a **virtual chip** (a Bun process, iteration 1). It holds the key the grant is delegated to and signs every robot payment. Camera and motors on the real one |

### The Grant (unchanged core)

```
Grant   = signed MetaMask Delegation Framework delegation: owner account → chip address
          caveats: USDC only (AllowedTargets/Methods), ValueLte(0), period cap, expiry,
                   + ours: RobotPaymentPolicyEnforcer (per-payment cap, merchant allowlist),
                           HumanApprovalEnforcer (Agent Pass co-signature above the cap / for restricted payees)
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
- **MCP server:** `workers-oauth-provider` + `createMcpHandler`. **The OAuth consent page is the grant ceremony:** it
  shows the robot's name and **chip address** and the budget; the passkey signs.
- **Raising a budget:** the agent calls `grant_change_request`, which returns a link (or an in-chat prompt where the
  host supports it). The owner opens the wallet and the passkey signs a new grant.
- **MCP tools:**
  - `wallet_overview`, `payments_list`, `payment_status`
  - `payment_prepare` (returns the leaf to sign)
  - `payment_submit` (signed leaf → facilitator)
  - `float_pull` (exact-amount pull to the chip)
  - `grant_change_request`, `approval_request` (Agent Pass)
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
  1. The Agent decides on 0G, then asks the wallet MCP for `payment_prepare` (or the merchant's x402 requirements).
  2. It sends the leaf to the chip.
  3. **The chip checks the invoice (on the real chip, one it scanned itself) and signs.**
  4. The Agent submits.
  - The Agent never holds a spending key.
- **Body:** camera frames (JPEG over the chip's WebSocket, fanned out to browsers while someone watches) and movement
  (`move {vx,vy,vyaw}`, 300 ms deadman, owner e-stop, human beats AI). From `robot-browser-and-mcp.md`.
- **Virtual robot (iteration 1.5):** fork of Pollen's Microduck browser sim as the body.

### 2.3 Payments: grant + float (decision C)

| | Grant path | Float path |
| --- | --- | --- |
| For | Our merchant (accepts ERC-7710) | Any x402 seller that only takes EIP-3009 |
| How | Chip signs a one-time leaf → **our facilitator** → `redeemDelegations` | The chip pulls the exact amount (a grant payment *to itself*: `ExactCalldata(transfer(chip, amount))`, `IdEnforcer(invoice)`), waits for the receipt, then signs EIP-3009 (`validBefore` ≤ 120 s) → **Circle's Facilitator Service** |
| Limits enforced | All of them, on Arc, at payment time | All of them at the **pull**; the seller payment itself is a plain transfer |
| Cost | 1 tx (≈ $0.004–0.008) | 2 txs, about 1 s on Arc, invisible to the user |
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

### 2.5 World: Agent Pass only (decision F)

- **What Agent Pass is:** ETHGlobal's name for **World IdP**, World's OIDC sign-in at `auth.world.org`.
  - **Known:** no blockchain is involved at all, so it fits Arc cleanly.
  - Our backend (an OIDC client with a secret) starts a **device flow**. The owner opens the link, checks a short code,
    and approves in World App.
  - The backend polls and gets an **RS256 ID token** (JWKS at `/.well-known/jwks.json`).
  - Deny (`access_denied`), expiry (20 min, `expired_token`) and any error mean **no token, so no payment**.
- **Binding:** World App **cannot** show what is being approved (only the `openid` scope; no `binding_message` or
  `authorization_details`). So:
  - our wallet page shows item, amount, payee and invoice
  - we store the attempt, and mark it used in the same step that co-signs
- **Co-signature:** after verifying the token, the backend signs EIP-712
  `{invoiceHash, amount, payee, expiry, nonce, delegationHash, authTime}`. `HumanApprovalEnforcer` (built in Arc
  Studio) checks the signer, expiry and a single-use nonce. It sits on the root grant, so it binds the chip too.
- **Token checks:**
  - accept `acr` `…/acr/orb` or `…/acr/orb-face`
  - reject passkey-only sign-ins (an `amr` containing `mfa`), or require `orb-face`
  - check `sub` = owner, `auth_time` after the attempt started, `jti` unused
  - World's reference `idp.ts` has two bugs here (it requires a non-existent `orb-v3`, and it accepts passkey-only
    sign-ins)
- **Agent Pass vs the MCP grant:** the grant is the **standing budget** (passkey, in our wallet). Agent Pass is a
  **one-off exception** for a single over-limit or restricted payment (World App). Raising the budget is a new grant,
  not Agent Pass.
- **Setup:**
  - register a client at `auth.world.org/portal` with an HTTPS redirect URI and `client_secret_basic`
  - sandbox at `sandbox.auth.world.org` (separate; a sandbox ID takes about 1 h)
  - Kris has an Orb-verified ID; whether ETHGlobal's "mocked proofs" apply is a booth question
- **Dropped:** the IDKit `HumanRegistry` / 18+ path (optional later). AgentKit (World's x402 extension) isn't used:
  archived, no age, discounts only.

### 2.6 Venue network (decision I)

- **Primary: macOS Internet Sharing**, sharing the Mac's Ethernet as Wi-Fi. Settings:
  - channel 1, 6 or 11 (the ESP32 is 2.4 GHz only)
  - security WPA2/WPA3 Personal, **never WPA3-only**
  - Radxa: `nmcli … wifi-sec.key-mgmt wpa-psk`
  - ESP32: `WiFi.setMinSecurity(WIFI_AUTH_WPA2_PSK)`
  - the Mac is the gateway, so you can SSH to the Radxa from it
  - if the channel menu comes up blank, move `com.apple.nat.plist` aside and reboot
  - run `caffeinate -dis` so the Mac doesn't sleep
- **Fallback:** the phone's hotspot on its **own mobile data** (needs a local SIM), saved on both devices as a second
  network.
- **Doesn't work:** reverse-tethering Mac → Android over USB and then sharing via the hotspot. On stock Android,
  hotspot clients bypass gnirehtet's VPN.

---

## 3. Iterations

| Iteration | Build | Done when |
| --- | --- | --- |
| **0: Wallet** | Passkey signup and deploy, fund, send/receive, grants UI, MCP server with OAuth-consent-as-grant, Agent Pass approvals | Sign up with a passkey only, receive $1, send $0.10, connect a client with a $2/day grant, revoke it, on Arc mainnet with no gas shown |
| **1: Headless commerce** | Robot Agent DO + **virtual chip** + merchant (both payment paths) + our facilitator | The agent (0G) buys a normal item (grant path); a restricted or over-limit item (Agent Pass approve → paid, deny → nothing); an item from an EIP-3009-only seller (float path via Circle); revoke stops everything; every 0G decision is logged |
| **1.5: Virtual robot** | Sim body (Microduck fork), camera and control in the browser | The agent walks the sim duck to the stand, the virtual chip signs, it pays |
| **2: Hardware** | Radxa chip (same TS code), webcam, ESP32 gate | The duck scans the ESP32 QR, the chip signs, the gate opens on a signed "paid" |

---

## 4. Decisions

All of D1 and plan v3 A–J are recorded in `decisions.md`. Still open:

| # | Decision | Recommendation |
| --- | --- | --- |
| D7 | Who pays relayer gas | We absorb it (≈ $0.004–0.008/action) |
| D8 | Can the agent create narrower sub-grants without the owner? | Not needed now: the chip is the grantee directly |
| D9 | Recovery | Several passkeys now; guardians later |
| D10 | Accounts on other chains | Arc-only; other chains are funding routes |
| D11 | MetaMask can pause the DelegationManager | Accept; the 4337 break-glass path covers it |
| D13 | Who may watch or drive the robot | Owner drives; judges view |

---

## 5. Spikes, in order

| # | Spike | Settles |
| --- | --- | --- |
| S1 | Real-device passkey → HybridDeleGator on Arc → passkey-signed grant → $0.01 relayed payment | The wallet |
| S2 | Our ERC-7710 facilitator: owner → chip leaf on an Arc fork, then $0.01 real | Grant path |
| S2b | Float path: pull to chip → EIP-3009 through Circle's facilitator on Arc, $0.01 | Float path |
| S3 | 0G with the teammate's credits: tool-calling model, latency, request ids via pi-ai `onResponse` | Robot Agent brain; 0G prize |
| S4 | Robot Agent DO: pi-ai loop + MCP OAuth client ↔ our wallet MCP | Agent ↔ wallet |
| S5 | Agent Pass device flow (approve and deny) with Kris's Orb ID; `acr`/`amr` checks | World |
| S6 | Virtual chip ↔ Robot Agent WebSocket: pairing, sign request | Chip protocol |
| S7 | Mac Internet Sharing with the Radxa + ESP32 | Venue network |
| S8 | Walking policy on the new servos | Teammate |

## 6. Booth questions

- **0G:** whether Storage + `EpisodeLog` may use Galileo testnet. (Credits: we have them. Standard providers: decided.)
- **World:** what "mocked proofs" covers for Agent Pass; time to get a production client.
- **Arc:** can judges open a Studio URL without logging in; is a Studio-built enforcer module deployed to mainnet by us
  acceptable; Circle facilitator minimum amount; a keyed RPC.

## 7. What v3 supersedes

- **v2's separate AI client + RobotSession + robot MCP** → one Robot Agent per robot.
- **v2's "sub-grant to the robot"** → the grant's delegate is the chip directly.
- **The IDKit `HumanRegistry` and 18+ age rule** → dropped: restricted items need Agent Pass.
- **"Our relayer submits everything"** → our facilitator/relayer for grant payments and owner actions, Circle's
  facilitator for float payments, 4337 as break-glass.
- **Reverse-tether network idea** → macOS Internet Sharing.
