# Merchant system and agent-commerce protocols (research, 2026-11-05)

What this answers: which agent-commerce protocols our **merchant** (system 3) should speak; how it configures a
store, issues invoices, expresses an "18+ only" rule, takes proof and payment, and verifies both on **Arc mainnet**
(chain 5042); and how the same API later drives the ESP32 QR gate. Read with `bench-answers.md`, `infrastructure.md`,
`research/evm-accounts-and-payments.md` (MetaMask Delegation Framework, "DF" below), `research/arc-and-circle.md` and
`research/world.md`.

Method: read specs and code in `references/` (eight new clones, listed at the end), checked Arc mainnet with
`eth_getCode` against `https://rpc.mainnet.arc.io` on 2026-11-05 (block ~29.7M), read the arc-node source for the
Memo/CallFrom rules, queried npm and GitHub, and searched the web (sources at the end).

Marks: **[V]** verified today in code, on chain or on npm. **[D]** stated in official docs, not exercised.
**[S]** secondary source (press, blog, third-party summary). **[?]** our inference.

## TL;DR

- **Speak x402 v2 and nothing heavier.** The merchant is an x402 resource server **and its own facilitator on Arc**.
  It offers the `exact` scheme in two ways: `assetTransferMethod: "erc7710"` for our wallet's grants (DF delegations),
  which keeps the on-chain caps, and `"eip3009"` for any plain EOA wallet. Use the x402 extensions
  `payment-identifier` (idempotency) and, optionally, `offer-receipt` (signed receipts). Add one small extension of
  our own, `buyer-eligibility`, which carries the 18+ rule out and the proof back. [V spec]
- **AP2, ACP, UCP, Verifiable Intent, Visa TAP and Mastercard Agent Pay: borrow the shapes, implement none of them.**
  ACP and UCP have no crypto payment handler. AP2 v0.2 and Verifiable Intent are SD-JWT authorization layers that our
  DF delegation chain already provides, and Arc enforces it instead of a verifier. [V repos]
- **The ERC-7710 variant fits a DF delegation redeemed by our facilitator directly.** The payload is
  `{delegationManager, permissionContext, delegator}`. The facilitator simulates and then calls
  `redeemDelegations([ctx],[mode],[transfer(payTo, amount)])`. MetaMask ships the client and server halves
  (`@metamask/x402` 1.0.0, `createx402DelegationProvider` with `parentPermissionContext`). **Nobody ships an
  open-source ERC-7710 facilitator.** MetaMask's hosted one covers only Base, Base Sepolia and Monad, and the x402 SDK
  PR is still a draft. We write the facilitator half for Arc ourselves: about 150 lines. [V code / D docs]
- **Bind every payment to its invoice on chain with DF's `IdEnforcer`.** The agent's per-payment leaf delegation
  carries `IdEnforcer(invoiceHash)`, so an invoice can be paid at most once per payer, enforced by Arc. The tx emits
  `UsedId(…, id=invoiceHash)`. **Arc's `Memo` contract cannot do this here:** its `CallFrom` precompile requires
  `sender == tx.origin`, so it reverts when our relayer submits for a 7702 account. [V arc-node source]
- **Age: no finished standard exists in Nov 2026.** x401 (Proof + Circle, v0.2.0 draft) is the closest. World Agent
  Pass carries **no** age claim. Age needs IDKit `identityCheck({minimum_age: 18})`, which is a preview. For iteration 1
  the wallet verifies World ID once and issues a payer-bound **`AgeAttestation`** (EIP-712, claim name `age_over_18`)
  whose subject is the **owner's account, i.e. the root delegator of every grant**. The merchant accepts it only when
  the subject equals the payer that the delegation chain proves. Optionally the merchant also requires a fresh
  **World Agent Pass approval** bound to the invoice hash. That gives the deny path.
- **Cleanest for the 0G AI client:** the LLM calls two or three **wallet MCP tools** (`quote`, `pay`, `budget`). The
  wallet process runs the x402 HTTP exchange with the merchant, so signatures and proofs never pass through the
  model. The merchant needs no MCP server for iteration 1. x402-over-MCP (`_meta["x402/payment"]`) is for selling
  *tool calls*, not goods.
- **Iteration 2 changes nothing in the payment path.** The ESP32 creates the invoice, shows `https://<origin>/i/<id>`,
  and polls an **Ed25519-signed** status. The robot calls the same wallet `pay` tool with the URL. One change to
  `bench-answers.md` is needed: `POST /invoices/:id/payments` becomes the x402 resource. A bare `{txHash}` body stays
  only as an optional push mode for EOA phone wallets, bound by Memo.

---

## 1. Protocol landscape, November 2026

### 1.1 Comparison

| Protocol | Owner, status | Layer | Rails | Fit for us | What we take |
| --- | --- | --- | --- | --- | --- |
| **x402 v2** | x402 Foundation (Linux Foundation). TS SDK `@x402/*` **2.30.0**. Spec v2 with schemes `exact`, `upto`, `batch-settlement`, `auth-capture` [V] | Payment negotiation: HTTP 402, MCP and A2A transports | Stablecoins on chain. `eip155:5042` USDC `0x3600…` is in the SDK default assets [V] | **Speak it** | `PaymentRequired` / `PaymentPayload` / `SettlementResponse`, `exact`+`erc7710`, `exact`+`eip3009`, `payment-identifier`, `offer-receipt`, extension echo |
| **AP2 v0.2** | Google. v0.2 released 2026-04-28. Contributed to the FIDO Alliance 2026-04-28 [V CHANGELOG / S] | Authorization ("mandates") on top of a commerce protocol | Any. Includes an x402 sample | Map the concepts only | Open vs closed mandates, human-present vs human-not-present, `checkout_hash` binding, "verify in deterministic code", nonce = hash(mandate) |
| **a2a-x402 v0.2** | Google, now also x402 `transports-v2/a2a.md` [V] | x402 over A2A task metadata | x402 | Skip (we have no A2A) | Status names `payment-required → submitted → verified → completed` |
| **ACP** | OpenAI + Stripe. Stable spec **2026-04-17** [V] | Checkout-session API + delegated payment | Cards / vault tokens via a PSP (Stripe SPT). **No crypto handler** [V grep] | Skip | Session state machine, `Idempotency-Key` replay and 409 rules, `messages[]` |
| **UCP** | Google + retailers. Schema version 2026-08-25. Repo active today [V] | Full commerce (catalog, cart, checkout, order) over REST, MCP and A2A, plus an AP2 extension | Payment handlers. **No crypto handler** [V grep] | Too big | `/.well-known/ucp` discovery idea, warning code `age_restricted`, catalog `actions` for age verification (illustrative only) |
| **Verifiable Intent v0.1** | Mastercard (+ Google). Draft. Contributed to FIDO [V README / S] | Three-layer SD-JWT delegation chain | Any | Pattern | Its L1/L2/L3 map onto our attestation, root grant and leaf payment (section 2.9) |
| **Visa TAP / Intelligent Commerce** | Visa. TAP repo is from 2025-10. Intelligent Commerce Connect launched 2026-04-08 [S] | RFC 9421 signed agent requests + agent key registry. Card tokens | Cards | Pattern | "Agent signs every request; the merchant looks up the key." Our payment signature already does this |
| **Mastercard Agent Pay** | Mastercard. Agentic Tokens (2025-04), Verifiable Intent (2026-03), Agent Pay for Machines (2026-06) [S] | Network tokens bound to an agent and a consent policy | Cards | Pattern | "Token bound to agent + consent" is our grant |
| **x401 v0.2.0** | Proof, editors from **Proof and Circle**. Draft [D] | Proof requirement: `PROOF-REQUEST` / `PROOF-RESPONSE` / `PROOF-RESULT`, OpenID4VP + DCQL | Composes with x402: proof first, then 402 on the same route | Shape our extension like it, adopt later | Proof-before-payment ordering, "an age gate where no DOB leaves the wallet" |
| **World AgentKit (beta)** | World. The repo is marked deprecated but the docs say Beta; npm 0.2.1 [V] | x402 extension `agentkit`: a CAIP-122 signature + AgentBook lookup on World Chain | x402 | Optional `human_backed` rule | Shows World expects human-proof to ride as an x402 extension |
| **Circle Gateway Nanopayments** | Circle. `@circle-fin/x402-batching` [D] | Batched x402 through Gateway | USDC via Gateway. **EOA signatures only, no ERC-1271** [D] | Optional extra `accepts[]` entry for third-party agents | Not for our capped grants: a Gateway delegate has a full allowance |

### 1.2 x402: the parts that matter for the merchant

**Wire format (HTTP).**
- First request without payment: `402`, base64 JSON in the `PAYMENT-REQUIRED` header.
- Retry with a base64 `PaymentPayload` in `PAYMENT-SIGNATURE`.
- Success: `200`, with a base64 `SettlementResponse` in `PAYMENT-RESPONSE`.
- `accepts[]` lists the payment options. `extensions` is a key → `{info, schema}` map. The client **must echo** the
  server's extension info and **may append** to it (`x402-specification-v2.md` §5.1.2).
- The TS client does this automatically and has an `enrichPaymentPayload` hook for custom extensions
  (`typescript/packages/core/src/client/x402Client.ts:113-140, 587-597`). [V]
- Error codes we reuse: `invalid_payload`, `invalid_exact_evm_payload_*`, `insufficient_funds`, and the non-terminal
  `settlement_pending` (broadcast, receipt unknown, reconcile before retrying) (§9). [V]

**`exact` + ERC-7710** (`specs/schemes/exact/scheme_exact_evm.md` §3):
- Payload: `{delegationManager, permissionContext, delegator}`.
- Verification is **simulation only**. The facilitator builds `executionCallData` for `transfer(payTo, amount)` and
  simulates `redeemDelegations([permissionContext], [mode 0x00…], [executionCallData])`. If it succeeds, it settles
  with the same call. No trust list of Delegation Managers is needed.
- **Fit with our DF account:** the agent's root grant is `owner → agentKey` with the caps. Per payment, the agent signs
  an **open leaf** `agentKey → ANY_DELEGATE`, restricted by `RedeemerEnforcer([our relayer])` plus the per-payment
  caveats. `permissionContext = abi.encode(Delegation[] leaf→root)`, and `delegator` = the owner account (root).
- `DelegationManager.redeemDelegations` runs the caveats of every hop, so the owner's daily cap, allowlist and
  expiry still apply (`evm-accounts-and-payments.md`). **This is the only x402 method that keeps the agent inside
  the on-chain caps.** EIP-3009 from a 7702 account goes through stateless ERC-1271, and the agent does not hold the
  owner key anyway.

**Who implements what (verified today):**

| Piece | Status |
| --- | --- |
| x402 TS SDK 2.30.0 | `exact` covers `eip3009` and `permit2` only. **No ERC-7710 code** [V grep] |
| x402 PR [#1837](https://github.com/x402-foundation/x402/pull/1837) | "First draft of ERC-7710 exact scheme implementation" by Dan Finlay. Open since 2026-03-26. It reads redeemers from `extra.facilitators` [V] |
| `@metamask/x402` 1.0.0 (2026-08-13) | `x402Erc7710Client` and `x402ExactEvmErc7710ServerScheme`. The server scheme copies **`extra.facilitatorAddresses`** from the facilitator's `/supported` kinds (`MetaMask_smart-accounts-kit/packages/x402/src/x402Server.ts`). There is **no facilitator** in the package [V] |
| `@metamask/smart-accounts-kit` 2.0.0, `experimental/x402DelegationProvider.ts` | `createx402DelegationProvider({account, parentPermissionContext, caveats, salt, redeemers, expirySeconds})`. It signs an **open** leaf on top of `parentPermissionContext` and appends redeemer, allowedTargets and timestamp caveats unless the chain already has them. `caveats` and `salt` can be functions of the requirements, so we can inject `IdEnforcer(invoiceHash)` [V] |
| `@metamask/delegation-deployments` 2.1.0 (2026-09-29) | Contains 5042. Smart-accounts-kit depends on `^2.0.0`, so it resolves to 2.1.0 [V npm tarball] |
| MetaMask hosted facilitator | Base `eip155:8453`, Base Sepolia, Monad `eip155:143` only. **Not Arc** [D] |

Gotchas from someone who built it end to end (PR #1837, comment of 2026-10-05) [S]:
- `ROOT_AUTHORITY` is all-ones, not zero.
- `permissionContext` is `Delegation[]` (leaf → root), never a bare `Delegation`.
- The EIP-712 domain is `name "DelegationManager"`, **`version "1"`** (not `"1.3.0"`). Sign the raw digest, not EIP-191.
- The manager calls `executeFromExecutor`, not `execute`.

Field-name divergence: MetaMask's shipped code uses `extra.facilitatorAddresses`; the draft PR uses `extra.facilitators`.
**Publish both** until x402 settles on one. [V]

**Other schemes on Arc** (bytecode checked today) [V]:
- `batch-settlement` `0x4020074e…0003`: present. Useful later for repeat micro-purchases and offline vouchers (the
  "robot pays a gate many times" story). Not needed for discrete purchases.
- `auth-capture` (Commerce Payments escrow): only the **v1.0** set is present (escrow `0xBdEA0D1b…0cff`, EIP-3009
  collector `0x0E3dF951…7757`). The **v1.1 default** (`0xf9681597…B19c`) and its collectors are **absent**. Its
  collectors pull through EIP-3009 or Permit2, so a capped agent cannot use it. It suits human EOA buyers who want
  refunds.
- The `exact` Permit2 proxy `0x402085c2…0001` is **absent**, so the `permit2` method is unavailable on Arc.

**x402 + MCP** (`specs/transports-v2/mcp.md`, `@x402/mcp` 2.30.0):
- A paid tool returns `isError: true` with `PaymentRequired` in `structuredContent`.
- The client retries with `_meta["x402/payment"]`. The server returns `_meta["x402/payment-response"]`.
- `createPaymentWrapper` (server) and `createx402MCPClient({autoPayment})` (client) exist.
- Use it if the merchant ever sells MCP tool calls. For physical goods, the payment belongs in the wallet, not in the
  LLM's tool loop (section 1.7).

### 1.3 AP2 v0.2: what changed and what to reuse

v0.2 (`references/google-agentic-commerce_AP2/docs/ap2/specification.md`) replaced the v0.1 Intent / Cart / Payment
trio. [V]
- **Two mandate types:** a **Checkout Mandate** (for the merchant) and a **Payment Mandate** (for the credential
  provider, network and processor). Both are SD-JWTs with `vct` values `mandate.checkout.1`, `mandate.checkout.open.1`
  and `mandate.payment.1`.
- **Open** mandates carry constraints and the agent key (`cnf`). Defined constraints: `checkout.allowed_merchants`,
  `checkout.line_items`, `payment.amount_range`, `payment.budget`, `payment.allowed_payees`, `payment.agent_recurrence`
  and others. **Closed** mandates carry final values.
- **Human present ("direct"):** the user signs closed mandates on a Trusted Surface. **Human not present
  ("autonomous"):** the user signs open mandates and the agent signs closed ones.
- The merchant signs a `checkout_jwt`. The closed mandates bind to `checkout_hash`.
- Roles: Shopping Agent, **Credential Provider** (source of payment credentials, scopes them to the agent), Merchant,
  Merchant Payment Processor, **Trusted Surface** (must be non-agentic).
- The x402 human-not-present sample (`code/samples/python/src/roles/x402_psp_mcp/server.py:54-160`) verifies the
  SD-JWT chain and then requires **EIP-3009 `nonce == keccak(mandate chain)`**. That is the same "bind the on-chain
  nonce to the authorization artifact" trick we use with `invoiceHash`.

Mapping to our systems:

| AP2 role | Ours |
| --- | --- |
| Shopping Agent | 0G AI client (later the robot) |
| Credential Provider + Trusted Surface | Wallet (system 1): passkey UI, grants, World verification |
| Open Payment Mandate | Root delegation owner → agent (caps enforced **on Arc**, not by a verifier) |
| Closed Payment Mandate | Leaf delegation agent → facilitator: `transfer(payTo, amount)` + `IdEnforcer(invoiceHash)` |
| Merchant-signed `checkout_jwt` | Invoice (optionally EIP-712-signed by the merchant) |
| Merchant Payment Processor | Our own Arc facilitator |

### 1.4 ACP and UCP

- **ACP** (`references/agentic-commerce-protocol_agentic-commerce-protocol/spec/2026-04-17/`):
  - Endpoints: `POST /checkout_sessions`, `POST /checkout_sessions/{id}`, `/complete`, `/cancel`.
  - Session status: `not_ready_for_payment → ready_for_payment → complete_in_progress → completed | canceled`.
  - `Idempotency-Key` is required on writes. It replays the cached response, and returns 409 on reuse with a
    different body or while the first request is in flight (`openapi.agentic_checkout.yaml:411-493`).
  - Payment = a delegated PSP vault token. No wallet or crypto handler. **Copy the session lifecycle and the
    idempotency rules; ignore the payment half.** [V] OpenAI shut down ChatGPT Instant Checkout in March 2026; the
    protocol continues [S].
- **UCP** (`references/Universal-Commerce-Protocol_ucp/`):
  - Discovery at `/.well-known/ucp`. Transports: REST, MCP, A2A and embedded.
  - It has an AP2 mandates extension and payment handlers, but no crypto handler.
  - Age appears only as warning code `age_restricted` (`source/schemas/common/types/warning_code.json`) and as an
    *illustrative* catalog action `com.example.identity.age_verification`. So UCP explicitly leaves age verification
    to extensions. [V]

### 1.5 Card networks (patterns only)

- **Visa TAP:** the agent signs each HTTP request with RFC 9421 message signatures. The merchant or its CDN looks up the
  agent key in a registry and checks domain, operation, timestamp and nonce (`references/visa_trusted-agent-protocol`).
  The licence is Visa's developer terms, so **read only**.
- **Mastercard Agent Pay:** an agentic token is a network token bound to one agent and a consent policy. Verifiable
  Intent adds the user → agent constraint chain.
- Both answer "is this agent allowed to spend for this person". On Arc we answer it with the delegation chain, which
  the merchant can check by simulation and Arc enforces at settlement.

### 1.6 "The agent proves its principal is verified or over 18"

| Option (2026) | Proves | Agent carries it? | Status | Use |
| --- | --- | --- | --- | --- |
| **x401** (Proof + Circle) | Any VC claim via OpenID4VP/DCQL, including age | Agent binding is *optional* and its sections are thin | v0.2.0 draft; Proof's "Delegate Authority" is invite-only [D/S] | Name and shape our extension compatibly; adopt when issuers exist |
| **World IDKit `identityCheck({minimum_age})`** | Document-backed age ≥ N | Not directly: the proof is RP-bound and the nullifier is single-use | **Preview, needs World approval** (`world.md`) [D] | The owner's one-time verification in the wallet |
| **World ID 4.0 on Arc** (`WorldIDSatellite` `0x304E…E394`) | IDKit 4 proofs, verified on chain | Through a registry keyed by account [?] | Live on Arc. Whether age or passport proofs verify there is unknown [V/?] | Stretch: an on-chain age registry |
| **World Agent Pass** (World IdP OIDC) | A fresh Orb-verified human approved *now* | Via our approver co-signature | Live; **no age claim** (`world.md`) [V] | The `human_approval` rule (the deny path) |
| **World AgentKit** | Agent wallet is human-backed (AgentBook, World Chain) | Yes, per request (CAIP-122 signature) | Beta [D] | Optional `human_backed` rule |
| **Mastercard VI / AP2 mandates** | User → agent authorization, not age | Yes (SD-JWT chain) | Drafts in FIDO [S] | Pattern |

Conclusion: no standard proof gives a merchant "over 18" through an agent today. **Our design:**
- **Payer-bound attestation.** The wallet verifies World IDKit once and issues an EIP-712 `AgeAttestation` whose
  `subject` = the owner account.
- **Grant inheritance.** Every grant's root delegator *is* that account, so any agent paying through a grant inherits
  the attribute. The merchant checks `attestation.subject == rootDelegator(permissionContext)`.
- **Grant scoping is wallet policy.** The wallet decides per grant whether to attach the attestation at all.
- **Optional fresh approval.** An invoice-bound **Agent Pass approval** adds human presence.

Claim name `age_over_18` follows ISO 18013-5 mDL / EUDI PID, so a later SD-JWT VC or x401 presentation can carry the
same claim.

### 1.7 What our merchant speaks, and the cleanest path for the 0G client

1. **HTTP + x402 v2** on `POST /invoices/:id/payments`, with `exact`/`erc7710` (primary) and `exact`/`eip3009`
   (fallback for plain wallets).
2. **Its own facilitator on Arc** (the `Relayer` DO in `infrastructure.md`), exposing the standard `/supported`,
   `/verify` and `/settle`. `/supported` returns `extra.facilitatorAddresses: [relayer]`. It can be shared by every
   merchant on the platform. That makes it a reusable piece for the Arc prize.
3. **Extensions:** `payment-identifier` (required), `buyer-eligibility` (ours) and `offer-receipt` (optional).
4. **Plain REST** for catalog, checkout and invoices, with ACP's idempotency rules, plus a small discovery document.

For the **0G client**: 0G inference is OpenAI-compatible with `tools` (`research/0g.md`), so the agent host bridges MCP
tools into function calls. Give the model **wallet tools**, not merchant tools:
- The LLM chooses *what* to buy.
- Deterministic wallet code checks the invoice against the grant and the owner policy, attaches proofs, signs the
  leaf and runs the 402 exchange. AP2 requires the same split.
- It keeps payloads, signatures and the World flow out of the context window.
- The robot in iteration 2 uses the same tool.

Proposed wallet tool contract (systems 1 and 2 own the implementation):

| Tool | Input | Output |
| --- | --- | --- |
| `merchant_lookup` | `origin` | discovery doc + catalog summary (read-only) |
| `pay_quote` | `{invoiceUrl}` or `{origin, sku, qty}` | invoice summary + policy verdict `allowed / needs_approval / denied(reason)` + remaining budget. Never pays |
| `pay_execute` | `{invoiceId, maxAmount, idempotencyKey}` | `{status, txHash, receiptUrl}` or a typed error (`eligibility_required`, `over_budget`, `approval_denied`, `expired`) |
| `budget_get` | none | caps, spent today, expiry |

The quote/execute pair is AP2's "the agent sees the closed checkout before committing". An agent that skips the quote
still cannot overspend: the wallet re-checks and Arc enforces.

---

## 2. Merchant system design

### 2.1 Trust boundaries

```
 AI client / robot ──MCP──▶ Wallet (grantee key, policy, World, attester)  ──HTTPS+x402──▶ Merchant API (Worker)
                                                                                           │  Invoice DO (single writer)
 ESP32 gate ──HTTPS poll (Ed25519-signed status)───────────────────────────────────────────┤  Facilitator = Relayer DO ──▶ Arc
                                                                                           │  ChainWatcher DO ◀── Arc logs
```

- **Arc decides "paid".** The merchant's database records it only after reading a successful receipt with the expected
  logs. A database row never authorises.
- **The merchant decides "eligible".** It checks proofs before it simulates or settles anything.
- **The gate trusts only the merchant's signing key**, never the robot.

### 2.2 Store configuration

```json
{
  "merchantId": "duck-cafe",
  "name": "Duck Café",
  "origin": "https://duck-cafe.example",
  "network": "eip155:5042",
  "asset": "0x3600000000000000000000000000000000000000",
  "payTo": "0xMerchantPayout…",
  "payment": {
    "methods": ["erc7710", "eip3009"],
    "facilitatorUrl": "https://pay.example/x402",
    "maxTimeoutSeconds": 120
  },
  "invoiceTtlSeconds": { "checkout": 900, "gate": 300 },
  "eligibility": {
    "trustedAttesters": ["eip155:5042:0xWalletAttester…"],
    "trustedApprovers": ["eip155:5042:0xWorldApprover…"]
  },
  "catalog": [
    { "sku": "coffee", "name": "Coffee", "price": "0.50", "restrictions": [] },
    { "sku": "mock-cigs", "name": "Mock cigarettes (demo prop)", "price": "1.00",
      "restrictions": [ { "type": "min_age", "minAge": 18 }, { "type": "human_approval", "maxAgeSeconds": 300 } ] }
  ],
  "gates": [ { "gateId": "gate-1", "sku": "coffee", "credential": "hmac:…" } ],
  "statusSigningKey": "ed25519:<public key>"
}
```

Notes:
- **Prices** are decimal USDC strings in config. On the wire they are atomic 6-decimal strings (`"500000"` = $0.50).
  Never use the 18-decimal native unit.
- **`payTo`** may be an account in our own wallet system (a 7702 EOA). ERC-20 `transfer` into it is fine. Avoid native
  `value` sends to contracts on Arc (`arc-and-circle.md`). If it is ours, refunds need that account's owner, or a grant
  from it (section 2.10).
- **Restrictions** are per SKU. An invoice's rules are the union over its lines, and `rulesHash` commits to them.
- **Discovery:** `GET /.well-known/agent-merchant.json` publishes `merchantId`, `payTo`, network, asset, methods,
  `facilitatorAddresses`, trusted attesters and approvers, and the gate status public key. The wallet checks
  `invoice.payTo` against it, and against the grant's merchant allowlist, before paying.

### 2.3 Invoice model

```json
{
  "id": "k7q3m2x9t4b6v8n1c5z0r2w4ha",
  "url": "https://duck-cafe.example/i/k7q3m2x9t4b6v8n1c5z0r2w4ha",
  "merchantId": "duck-cafe",
  "status": "pending",
  "lines": [ { "sku": "mock-cigs", "name": "Mock cigarettes (demo prop)", "qty": 1, "unitAmount": "1000000" } ],
  "amount": "1000000", "display": "1.00 USDC",
  "network": "eip155:5042", "asset": "0x3600000000000000000000000000000000000000", "payTo": "0xMerchantPayout…",
  "restrictions": [ { "type": "min_age", "minAge": 18 }, { "type": "human_approval", "maxAgeSeconds": 300 } ],
  "invoiceHash": "0x…32 bytes",
  "createdAt": 1793952000, "expiresAt": 1793952900,
  "payment": { "resource": "https://duck-cafe.example/invoices/k7q3…/payments" },
  "gateId": null
}
```

- **`id`:** 128-bit random, base32 lowercase, 26 characters, single-use (as in `bench-answers.md`).
- **`invoiceHash`:** the EIP-712 digest that binds the payment on chain. The wallet recomputes it from the JSON.
  - Domain: `{name: "AgentMerchant", version: "1", chainId: 5042}`.
  - Struct: `Invoice(bytes32 merchantId, bytes16 invoiceId, address payTo, address asset, uint256 amount, uint64 expiresAt, bytes32 linesHash, bytes32 rulesHash)`.
  - `linesHash` and `rulesHash` = keccak of RFC 8785 canonical JSON.
  - Optional: the merchant signs the same typed data (key in discovery). That gives a portable signed offer for the
    later offline/BLE path and for disputes.
- **States** (single writer = the `Invoice` DO):
  - `pending → settling → paid → used` (gate consumed) or `→ refunded / partially_refunded`.
  - `pending → expired`, and `settling → pending` on a known failure.
  - `settling` holds the payload fingerprint and the tx hash, so a crash or a lost RPC response resumes by reading the
    receipt instead of paying again.

### 2.4 API, iteration 1 (headless)

| Who | Call | Behaviour |
| --- | --- | --- |
| Any | `GET /.well-known/agent-merchant.json` | Discovery (2.2) |
| Any | `GET /catalog` | Items, prices (atomic + display), `restrictions`, and `age_restricted: true` as a UI hint (UCP's code) |
| Agent / wallet | `POST /checkout` + `Idempotency-Key` | Body `{items:[{sku, qty}]}` → `201` Invoice. Same key + same body → cached `200`. Different body → `409`. In flight → `409` + `Retry-After` (ACP rules) |
| Agent / wallet | `GET /invoices/:id` | Invoice + `paymentRequired` preview (the exact object the 402 will carry) |
| Phone / robot | `GET /i/:id` | QR target. HTML for browsers; the invoice JSON for `Accept: application/json` |
| Wallet | `POST /invoices/:id/payments` | **The x402 resource.** No `PAYMENT-SIGNATURE` → `402` + `PAYMENT-REQUIRED`. With one → verify eligibility → verify payment → settle → confirm on Arc → `200` + `PAYMENT-RESPONSE` + `{invoice, receipt}`. Errors: `402` with `error` (invalid or ineligible), `409 payment_in_progress`, `409 invoice_already_paid` (with the receipt), `410 invoice_expired` |
| Wallet / gate | `GET /invoices/:id/status[?nonce=…]` | `{invoiceId, status, expiresAt, paidAt?, txHash?, nonce?, sig?}`. `sig` is present when `nonce` is given (2.11) |
| Wallet | `GET /invoices/:id/receipt` | Signed receipt (2.10) |
| Merchant admin | `PUT /admin/catalog/:sku`, `GET /admin/invoices`, `POST /admin/invoices/:id/refunds` | Owner-authenticated (passkey session) |
| Facilitator | `GET /x402/supported`, `POST /x402/verify`, `POST /x402/settle` | Standard x402 facilitator API for `exact`+`erc7710`/`eip3009` on `eip155:5042` |

### 2.5 Payment requirements, including the age rule

What `POST /invoices/:id/payments` returns in `PAYMENT-REQUIRED` (decoded):

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "https://duck-cafe.example/invoices/k7q3m2x9t4b6v8n1c5z0r2w4ha/payments",
    "description": "Mock cigarettes (demo prop) ×1 at Duck Café",
    "mimeType": "application/json",
    "serviceName": "Duck Café"
  },
  "accepts": [
    {
      "scheme": "exact", "network": "eip155:5042", "amount": "1000000",
      "asset": "0x3600000000000000000000000000000000000000", "payTo": "0xMerchantPayout…",
      "maxTimeoutSeconds": 120,
      "extra": {
        "assetTransferMethod": "erc7710",
        "facilitatorAddresses": ["0xRelayer…"],
        "facilitators": ["0xRelayer…"],
        "delegationManager": "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3"
      }
    },
    {
      "scheme": "exact", "network": "eip155:5042", "amount": "1000000",
      "asset": "0x3600000000000000000000000000000000000000", "payTo": "0xMerchantPayout…",
      "maxTimeoutSeconds": 120,
      "extra": { "assetTransferMethod": "eip3009", "name": "USDC", "version": "2" }
    }
  ],
  "extensions": {
    "payment-identifier": { "info": { "required": true }, "schema": { "…": "per spec" } },
    "agent-invoice": {
      "info": { "invoiceId": "k7q3m2x9t4b6v8n1c5z0r2w4ha", "invoiceHash": "0x…", "expiresAt": 1793952900,
                "bind": { "erc7710": "IdEnforcer", "eip3009": "nonce" } },
      "schema": { "…": "JSON Schema" }
    },
    "buyer-eligibility": {
      "info": {
        "rules": [
          { "id": "age", "type": "min_age", "minAge": 18, "claim": "age_over_18",
            "accept": ["agent-merchant/age-attestation@1"] },
          { "id": "approval", "type": "human_approval", "maxAgeSeconds": 300,
            "accept": ["agent-merchant/world-approval@1"] }
        ],
        "subject": "payer",
        "trustedIssuers": ["eip155:5042:0xWalletAttester…", "eip155:5042:0xWorldApprover…"]
      },
      "schema": { "…": "JSON Schema" }
    }
  }
}
```

- **`extra.delegationManager`** is a hint only. The facilitator rejects any other manager.
- **`extra.name` / `version` for `eip3009`** are Arc USDC's EIP-712 domain (`"USDC"`, `"2"`).
- **`subject: "payer"`** means a proof must be about the paying account: the root delegator for `erc7710`, or
  `authorization.from` for `eip3009`.
- **Why an extension and not x401 headers?** x402 extensions work on HTTP, MCP and A2A alike, and the stock client
  already echoes them. If x401 matures, the merchant can also emit `PROOF-REQUEST` with a DCQL query for
  `age_over_18`. The rule semantics stay the same.

### 2.6 Payment payload with proof attached

```json
{
  "x402Version": 2,
  "resource": { "url": "https://duck-cafe.example/invoices/k7q3…/payments" },
  "accepted": { "…": "the erc7710 entry, unchanged" },
  "payload": {
    "delegationManager": "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
    "permissionContext": "0x…abi.encode(Delegation[]) leaf→root",
    "delegator": "0xOwnerAccount…"
  },
  "extensions": {
    "payment-identifier": { "info": { "required": true, "id": "pay_k7q3…_01" } },
    "agent-invoice": { "info": { "…": "echoed" } },
    "buyer-eligibility": {
      "info": {
        "…": "echoed rules",
        "proofs": [
          { "rule": "age", "format": "agent-merchant/age-attestation@1",
            "attestation": { "subject": "0xOwnerAccount…", "claim": "age_over_18", "issuedAt": 1793900000,
                             "expiresAt": 1801676000, "evidenceHash": "0x…" },
            "signature": "0x…EIP-712 by WalletAttester" },
          { "rule": "approval", "format": "agent-merchant/world-approval@1",
            "approval": { "invoiceHash": "0x…", "payer": "0xOwnerAccount…", "amount": "1000000",
                          "approvedAt": 1793952100, "expiresAt": 1793952400 },
            "signature": "0x…EIP-712 by WorldApprover" }
        ]
      }
    }
  }
}
```

**Leaf caveats** the wallet puts on the agent's per-payment delegation, using `createx402DelegationProvider` with
`caveats` and `salt` as functions of the requirements:
- `RedeemerEnforcer([relayer])`
- `AllowedTargetsEnforcer([USDC])`
- `ExactCalldataEnforcer(transfer(payTo, amount))`. The facilitator must build the byte-identical calldata.
- `IdEnforcer(uint256(invoiceHash))`
- `TimestampEnforcer(validBefore = min(expiresAt, now + maxTimeoutSeconds))`
- `salt = invoiceHash`

**Signed structs** (both EIP-712, domain `{name: "AgentMerchant", version: "1", chainId: 5042}`):
- `AgeAttestation(address subject, bytes32 claim, uint64 issuedAt, uint64 expiresAt, bytes32 evidenceHash)`.
  `evidenceHash` = hash of the World verification record (nullifier, action, rp_id), so an auditor can link it
  without the merchant learning anything else.
- `WorldApproval(bytes32 invoiceHash, address payer, uint256 amount, uint64 approvedAt, uint64 expiresAt)`. The
  approver key signs it only after the device flow in `world.md` returns a valid ID token.

### 2.7 Verification pipeline for `POST /invoices/:id/payments`

All in deterministic code, in this order (x401 and AP2 both put proof before payment):

1. **Invoice state** (DO):
   - `paid`: return the stored receipt if the `payment-identifier` id and payload fingerprint match. Otherwise
     `409 invoice_already_paid`.
   - `settling`: `409 payment_in_progress` + `Retry-After: 1`.
   - Past `expiresAt`: `410`.
2. **Shape:** decode the header. `accepted` must deep-equal one of this invoice's `accepts[]`: network, asset, amount,
   payTo, `assetTransferMethod`.
3. **Payer:**
   - `erc7710`: decode `Delegation[]`. The root (last) element's `delegator` must equal `payload.delegator`. That
     address is the payer.
   - `eip3009`: the payer is `authorization.from`.
4. **Eligibility:** for every rule, find a proof in an accepted format and check:
   - the issuer is in `trustedIssuers`;
   - the EIP-712 signature recovers to it;
   - `subject` / `payer` equals the payer from step 3;
   - it is not expired;
   - for approvals: `invoiceHash` and `amount` match, and `now - approvedAt ≤ maxAgeSeconds`.
   - On a missing proof: `402` with error `eligibility_required` and the rule ids. On a bad proof:
     `eligibility_invalid`. Nothing is simulated or sent. **This is the deny path.**
5. **Structural binding:**
   - `erc7710`: the leaf has `RedeemerEnforcer ∋ relayer`, `IdEnforcer == invoiceHash` and `ExactCalldata ==
     transfer(payTo, amount)`. The manager is the canonical DF `DelegationManager` on Arc.
   - `eip3009`: `to == payTo`, `value == amount`, `validBefore ≤ expiresAt`. Require `nonce == invoiceHash` when the
     payer is our wallet. Third-party x402 clients use random nonces, so accept them and rely on step 9.
6. **Facilitator `/verify`:** `eth_call` from the relayer:
   - `erc7710`: `redeemDelegations([ctx], [0x00…], [encodeSingle(USDC, 0, transfer(payTo, amount))])` with an
     explicit gas limit.
   - `eip3009`: `transferWithAuthorization`.
   - A revert means invalid. Return `402` with the decoded reason (cap exceeded, expired, already used).
7. **Lock:** move the DO to `settling` and store the fingerprint.
8. **`/settle`:** the relayer sends the tx with `maxFeePerGas ≥ 20 gwei` (lower is silently dropped on Arc) and
   records the tx hash in the DO *before* waiting.
9. **Confirm on Arc.** One receipt is final; Arc has BFT finality in under a second. Require:
   - `status == 1`.
   - Exactly one ERC-20 `Transfer` log from emitter **`0x3600…0000`** with `from == payer`, `to == payTo`,
     `value == amount` (6 decimals). Ignore the duplicate 18-decimal system log from `0xffff…fffE`. Every ERC-20
     `transfer` on Arc emits both [D usdc-system-events].
   - `erc7710`: an IdEnforcer `UsedId(sender=DelegationManager, delegator=agentKey, redeemer=relayer, id=invoiceHash)`
     log. `id` is not indexed, so decode the log data.
   - `eip3009`: `AuthorizationUsed(payer, nonce)`.
   - No receipt within ~10 s: answer `settlement_pending` with the tx hash and leave the DO in `settling`. The
     ChainWatcher finishes it.
10. **Commit:** `paid {txHash, block, payer, paidAt}`. Return `PAYMENT-RESPONSE` and the receipt, and push the signed
    status to the gate. The ERC-20 log, the `UsedId` log and the DO must all agree.

**Optional push mode** (`{txHash}` body, for a human paying from an EOA phone wallet). Accept only if:
- the tx calls Arc `Memo.memo(USDC, transfer(payTo, amount), memoId = invoiceHash, …)` directly from the payer EOA;
- the receipt has the ERC-20 `Transfer` and `Memo(sender, …, memoId = invoiceHash)`;
- the block time is within the invoice window;
- `(txHash, logIndex)` has not been claimed before.

Without Memo, anyone could claim someone else's same-amount transfer for their own invoice.

### 2.8 Why `IdEnforcer` and not Arc `Memo`

- `Memo.memo` forwards through the `CallFrom` precompile with `sender = msg.sender`
  (`circlefin_arc-node/contracts/src/memo/Memo.sol`).
- Arc's EVM rejects any sender-changing subcall unless the new sender equals the original caller **or `tx.origin`**:
  `"sender spoofing requires tx.origin as sender"` (`crates/evm/src/evm.rs:946-954`, `crates/precompiles/src/subcall.rs:66-71`).
- In our flow, `tx.origin` is the relayer and the caller of `Memo` would be the owner's 7702 account (inside
  `executeFromExecutor`). So it reverts. [V]
- It does work when the 7702 owner sends the transaction itself (`tx.origin == owner`), or for any plain EOA. That is
  why Memo stays for push mode only.

`IdEnforcer` (`MetaMask_delegation-framework/src/enforcers/IdEnforcer.sol:20-59`) gives us more than a tag:
- a bitmap keyed by `(DelegationManager, delegator, id)`, so **a second payment for the same invoice reverts on chain**
  even if our database loses state;
- a `UsedId` event to reconcile from.

### 2.9 Where each check lives (Verifiable Intent layers, enforced on Arc)

| VI layer | Ours | Checked by |
| --- | --- | --- |
| L1 credential provider → user (identity claims) | `AgeAttestation` (wallet attester, after World IDKit) | Merchant, off chain (signature + subject == payer) |
| L2 user → agent constraints, `cnf` = agent key | Root delegation owner → agent: period cap, merchant allowlist, expiry, `ValueLte(0)` | **Arc** (DelegationManager + enforcers) |
| L3 agent → merchant/network, final values bound to `checkout_hash` | Leaf: `ExactCalldata(transfer)` + `IdEnforcer(invoiceHash)` + `Timestamp` + `Redeemer` | **Arc** |
| Human present | `WorldApproval` bound to `invoiceHash` (Agent Pass device flow) | Merchant (signature); optionally Arc via the approver-cosign enforcer in `evm-accounts-and-payments.md` |
| Merchant-signed checkout | Invoice, optionally EIP-712-signed | Wallet |

### 2.10 Receipts, refunds, idempotency, expiry

- **Receipt:** the x402 `SettlementResponse` `{success, transaction, network, payer, amount}`, plus a signed receipt:
  - x402 `offer-receipt` shape: EIP-712 domain `"x402 receipt"`, `chainId 1`, fields
    `version, network, resourceUrl, payer, issuedAt, transaction`.
  - `resourceUrl` contains the invoice id. We include `transaction` because verifiability matters more than privacy
    here.
  - Sign with a dedicated merchant key, not the `payTo` key, as the spec advises.
- **Idempotency, three layers:**
  - **HTTP:** `Idempotency-Key` on `POST /checkout` and `POST /invoices` (ACP semantics), and `payment-identifier`
    (`required: true`) on payments. Same id + same fingerprint → cached response. Different fingerprint → `409`.
  - **Domain:** one invoice → one settlement. The DO's `settling` state with the stored tx hash makes retries resume.
    Never broadcast a second tx for an invoice while the first one's outcome is unknown.
  - **Chain:** `IdEnforcer` / the EIP-3009 nonce = `invoiceHash`, so double-pay is impossible per payer.
- **Expiry:**
  - The invoice `expiresAt` defaults to 15 min for checkout and 5 min for the gate. The leaf's `TimestampEnforcer`
    and EIP-3009 `validBefore` are clamped to it, so a stale authorization cannot settle.
  - The cron/alarm moves `pending → expired`. The gate drops expired invoices and asks for a new one.
  - Late push-mode payments are marked `paid_late` and refunded automatically.
- **Refunds:**
  - `exact` has no refund primitive. Refund = a USDC `transfer` from `payTo` back to the **payer** (the owner
    account, never the agent key), recorded against the invoice (`refunded` / `partially_refunded`).
  - Triggers: merchant admin, or automatic when the gate fails after `paid` or on a late payment.
  - If `payTo` is a wallet in our system, the merchant's own grant or relayer signs it.
  - Escrow alternatives seen: x402 `auth-capture` v1.0 (on Arc, but the payer signs EIP-3009, so not for capped agents)
    and Circle's `RefundProtocol.sol` (`circlefin_arc-escrow`): `pay(to, amount, refundTo)` with a lockup and an
    arbiter refund. Both are out of scope for iteration 1.

### 2.11 Iteration 2: the ESP32 QR and gate (keeps `bench-answers.md`)

Unchanged:
- QR = `https://<origin>/i/<invoiceId>` (≤ ~50 chars, QR v≤4, ECC M, 3 px/module on 128×160).
- The gate calls `POST /invoices {gateId, sku}` and polls `GET /invoices/:id/status`.
- Single-use ids and expiry.

The robot scans the QR, validates the origin against its allowlist, and calls the wallet tool
`pay_quote({invoiceUrl})` → `pay_execute(…)`. That is exactly the iteration-1 path, so there is no gate-specific
payment code.

Proposed changes to `bench-answers.md`:

1. **`POST /invoices/:id/payments` becomes the x402 resource:** 402 → `PAYMENT-SIGNATURE` → 200. The bench's empty
   body still works as the bench stub. `{txHash}` becomes the optional Memo-bound push mode (2.7).
2. **The status is signed.**
   - `GET /invoices/:id/status?nonce=<16 hex>` returns `{invoiceId, status, expiresAt, nonce, sig}`.
   - `sig` = Ed25519 over the ASCII string `agentgate:v1|<invoiceId>|<status>|<expiresAt>|<nonce>`. A fixed text
     format means no JSON canonicalization on the MCU.
   - The ESP32 holds only the public key. The fresh nonce defeats replayed responses on the LAN.
   - **Use Monocypher's optional `crypto_ed25519_check`** (`src/optional/monocypher-ed25519.h`). Plain
     `crypto_eddsa_*` is EdDSA with **BLAKE2b** and will not verify RFC 8032 signatures made with WebCrypto Ed25519 in
     the Worker. [V]
3. **Add `used`.** After opening, the gate calls `POST /invoices/:id/consume`, authenticated with an HMAC under the
   per-gate credential. The status becomes `used`, so a replayed or cached `paid` can never reopen the gate. Statuses:
   `pending | settling | paid | used | expired | refunded`. The gate opens only on a freshly signed `paid`.
4. **Authenticate `POST /invoices`** with the gate credential in the product (unauthenticated on the bench).
5. **Restricted SKUs at a gate need nothing new on the ESP32.** Eligibility is checked at payment. The display can show
   "18+ — owner verification required" from the invoice's `restrictions`.

Prior art that matches this split: `references/modeofO_402-hardware`. An ESP32-S3 terminal shows a QR of
`/pay/:session`, the backend answers browsers with HTML and x402 clients with 402, settles through a facilitator, and
the terminal polls `/session/:id/status`. It has no expiry, keeps state in memory, and its status is unauthenticated.
Those are the three things we add.

### 2.12 Mapping onto the Cloudflare plan (`infrastructure.md`)

| Piece | Where |
| --- | --- |
| Catalog, merchants, invoice read model, refunds ledger | D1 (read models) |
| Invoice state machine, idempotency, signed status push | `Invoice` DO (one per invoice) |
| Facilitator `/verify` + `/settle`, nonce lock, gas | `Relayer` DO (one). Its address = `facilitatorAddresses[0]` |
| Receipt reconciliation, push-mode detection, `settlement_pending` recovery | `ChainWatcher` DO: filter `UsedId` by `redeemer = relayer`, `AuthorizationUsed`, and `Transfer(to = payTo)` from `0x3600…` |
| Attester and approver keys | Wallet side (separate Worker secret). The merchant holds only their addresses |
| Gate status key | Worker secret (Ed25519). The ESP32 has the public key |

**The public Arc RPC rate-limits bursts:** we got `-32005 rate limit exceeded` after ~8 quick calls today. Give the
ChainWatcher and Relayer a keyed endpoint (Alchemy, dRPC, QuickNode or Blockdaemon per `arc-and-circle.md`). [V]

---

## 3. Examples and starters: what to copy

| Repo (path) | Copy | Do not copy |
| --- | --- | --- |
| `circlefin_arc-ecommerce-payments` | Server-held intent: the client gets only a nonce, the server keeps the full `PaymentInfo` and `takeIntent` is single-use (`lib/payments/intent-store.ts`). The nonce is the payer-agnostic hash of the intent read from the escrow (`lib/payments/authorization.ts`), the same binding idea as `invoiceHash`. Operator relays and sponsors gas. After on-chain success, persistence is best-effort and the tx hash is returned anyway (`app/api/checkout/authorize/route.ts`). Refunds front-paid by the operator (`OperatorRefundCollector`) | In-memory store. The webhook signature check is commented out (`app/api/webhooks/payments/route.ts`). Circle dev-controlled wallets. Testnet only |
| `circlefin_arc-escrow` | `contracts/escrow_smart_contract/RefundProtocol.sol`: refundable payments with a lockup and an arbiter. A reference if a refund window becomes a requirement | OpenAI validation flow, Supabase |
| `x402-foundation_x402` | `examples/typescript/servers/self-facilitation` (in-process facilitator), `facilitator/basic`, `servers/payment-identifier`, `servers/offer-receipt`, `servers/mcp`, `clients/erc7702`. Core: `packages/core/src/http/x402HTTPResourceServer.ts`, `server/x402ResourceServer.ts`. Mechanism helpers: `mechanisms/evm/src/shared/verifySignature.ts` | The Permit2 path (proxy not on Arc). Base defaults |
| `MetaMask_smart-accounts-kit` | `packages/x402/src/*` (client + server scheme), `packages/smart-accounts-kit/src/experimental/x402DelegationProvider*.ts` (open leaf over `parentPermissionContext`, caveat injection) | Hosted facilitator addresses (`METAMASK_FACILITATOR_ADDRESSES`). Replace them with our relayer |
| `google-agentic-commerce_AP2` | `code/samples/python/src/roles/x402_psp_mcp/server.py` (mandate verify + nonce binding), the `merchant_agent_mcp` role, `docs/ap2/flows.md` diagrams for the HP/HNP story | SD-JWT plumbing |
| `agentic-commerce-protocol_agentic-commerce-protocol` | `spec/2026-04-17/openapi/openapi.agentic_checkout.yaml` idempotency responses and session statuses | Delegated card payment |
| `Universal-Commerce-Protocol_ucp` | `docs/specification/shopping/catalog/index.md` (actions + age message example), warning codes | The protocol itself |
| `agent-intent_verifiable-intent` | `spec/credential-format.md` and `spec/constraints.md` vocabulary for the "VI enforced on Arc" pitch | |
| `worldcoin_agentkit-shopify-demo` | A store that sells only to human-backed agents: discount via a SIWE-authenticated API + Shopify Storefront MCP | AgentBook (World Chain) unless we add `human_backed` |
| `modeofO_402-hardware` | ESP32 vending-terminal flow, content-negotiated pay route, status polling (`backend/src/routes/{session,pay}.ts`, `firmware/src/{display,api}.rs`) | No licence: read, don't copy code |
| `nodestark_mdb-esp32-cashless` (existing clone) | PR #78 (merged 2026-09-11) added an x402 vend rail: `docker/volumes/functions/x402-vend/index.ts` | Base-only |
| `PlaiPin_solana-esp32-x402` (existing) | An on-device x402 client (robot side, Solana) | Gate side is ours |

Seen, not cloned:
- [DelegAI](https://github.com/edycutjong/delegai): x402 + ERC-7710 hackathon seller. It only checks the delegation
  signature and never simulates or settles. Weak.
- [IntentGuard](https://github.com/DogukanGun/intent-binding): EIP-3009 intent binding in Python.
- [x4pay](https://x4pay.org/): x402 over BLE on ESP32, for a later offline mode.
- [cloudflare/agents x402-mcp example](https://github.com/cloudflare/agents/tree/main/examples/x402-mcp): paid MCP
  tools on Workers.
- `circlefin/arc-commerce`: credit purchase with dev-controlled wallets.

---

## 4. Confidence table

### Known

| Item | Evidence |
| --- | --- |
| x402 v2 wire format, extension echo, client `enrichPaymentPayload` hook | spec §5; `core/src/client/x402Client.ts` [V] |
| `exact`+ERC-7710 = simulate then `redeemDelegations`; payload `{delegationManager, permissionContext, delegator}` | `scheme_exact_evm.md` §3 [V] |
| The x402 SDK has no ERC-7710 facilitator; PR #1837 is a draft | grep + GitHub [V] |
| `@metamask/x402` 1.0.0 client/server; the provider supports `parentPermissionContext`, `caveats`, `salt`, `redeemers`; `delegation-deployments` 2.1.0 includes 5042 | source + npm [V] |
| MetaMask hosted facilitator: Base, Base Sepolia, Monad only | MetaMask seller guide [D] |
| On Arc: DelegationManager, BatchSettlement, auth-capture **v1.0** escrow + 3009 collector present. v1.1 and ExactPermit2Proxy absent | `eth_getCode` today [V] |
| Arc `Memo` cannot be used from a relayed 7702 payment (`tx.origin` rule) | arc-node source [V] |
| `IdEnforcer` single-use per `(manager, delegator, id)` + `UsedId` event (id not indexed) | DF source [V] |
| An ERC-20 transfer on Arc emits a 6-decimal log from `0x3600…` **and** an 18-decimal system log. One receipt is final | Arc docs [D] |
| EIP-3009 from a 7702 owner goes through stateless ERC-1271, so it is not usable by a capped agent | `evm-accounts-and-payments.md` [V] |
| AP2 v0.2 = Checkout + Payment mandates (SD-JWT, open/closed, HP/HNP). Its x402 sample binds the nonce to the mandate hash | repo [V] |
| ACP and UCP: no crypto payment handler. UCP treats age as an illustrative action + `age_restricted` code | repos [V] |
| No finished standard for agent-carried age proof. x401 v0.2.0 draft has Proof and Circle editors | x401 spec [D] |
| World Agent Pass has no age claim. IDKit `identityCheck` `minimum_age` is a preview | `world.md` + `developer-docs/world-id/idkit/credentials.mdx` [V] |
| Monocypher `crypto_eddsa_*` uses BLAKE2b. RFC 8032 is `crypto_ed25519_*` (optional module) | Monocypher source/docs [V] |
| The public Arc RPC rate-limits bursts | observed `-32005` [V] |

### Uncertain: needs a spike

| Item | Spike |
| --- | --- |
| Our ERC-7710 facilitator on Arc: the 2-hop chain (owner `EIP7702StatelessDeleGator` → agent EOA → open leaf with Redeemer + AllowedTargets + ExactCalldata + IdEnforcer + Timestamp) simulates and redeems, and the root period cap still applies | Fork test with `arc-anvil` / `--fork-url https://rpc.mainnet.arc.io`, then one real $0.01 payment |
| `createx402DelegationProvider` with a plain viem EOA as `account` and a `parentPermissionContext` resolves the 5042 environment and produces a context the DM accepts (domain version `"1"`, `ROOT_AUTHORITY` all-ones) | Unit script against the fork |
| `x402ExactEvmErc7710ServerScheme` picks up our `/supported` `extra.facilitatorAddresses`; `@x402/core` resource server runs in a Worker (no Node built-ins) | Wire it into the Effect Worker and run one 402 round trip |
| The `buyer-eligibility` extension survives the stock client (echo + append) and our server check runs before verify | Register a `ClientExtension`; assert in a test |
| Receipt latency on Arc via our relayer, and `settlement_pending` recovery through the ChainWatcher | Measure 20 payments; kill the Worker mid-settle |
| Ed25519 status verification on the ESP32 (Monocypher ed25519 module) against WebCrypto Ed25519 signatures | Bench sketch with a fixed test vector |
| A 26-char-id URL with an IP:port origin fits QR v4 at 3 px/module on the ST7735 and scans from the duck camera | Bench (see `bench-answers.md`) |
| Gas per `redeemDelegations` payment (2-hop + 5 caveats) ≈ 150–250k gas ≈ $0.003–0.005 at 20 gwei [?] | Measure on the fork |

### Unknown: needs research or a decision

| Item | Who / how |
| --- | --- |
| **Who attests age.** The wallet attester key (merchants trust our issuer) vs an on-chain registry fed by `WorldIDSatellite` on Arc. Do identity-check / passport proofs verify there, and do staging or mock proofs verify on the prod satellite? | Ask at the World booth; decision for systems 1 and 4 |
| Can we get IDKit `identityCheck` / `minimum_age` access this weekend, or do we demo with World's mocked proofs? | World booth |
| Is age bound to the **payer account** (every grant inherits it; the wallet decides whether to attach it) or **anchored in a specific grant** (a credential hash in a root caveat or the salt)? | Product decision (system 4) |
| For restricted items, does the merchant always require a fresh Agent Pass approval, or age only? (`open-questions.md` #4, #8) | Product decision. Recommendation: both for the demo item, so both World prizes show |
| Who runs and pays for the facilitator/relayer: the merchant or the platform? (`infrastructure.md` Q6) | Team decision |
| Refund mechanics beyond a manual transfer back (escrow? an automatic refund window?) | Decision. Recommendation: manual + automatic-on-gate-failure only |
| Where the grantee key lives for the AI client: wallet-hosted MCP vs a local sidecar MCP | Systems 1 and 2. The merchant is unaffected |
| Do we need push mode (`{txHash}` + Memo) for judges paying from a phone wallet? | Demo decision |
| Also accept Circle Gateway Nanopayments in `accepts[]` (Arc Marketplace track, EOA-only, no caps)? | Prize decision |
| Ship x401 headers alongside our extension, or only the extension? | Recommendation: extension only now |
| Add AgentKit `human_backed` as a third rule (beta; AgentBook on World Chain)? | Probably skip; not what the Agent Pass prize asks for |

---

## 5. Cloned repos (this note)

All are under `references/`, shallow (`--depth 1`, `GIT_LFS_SKIP_SMUDGE=1`), cloned 2026-11-05, total ~33 MB.
`references/README.md` was **not** edited, as instructed. Copy these rows there if wanted.

| Path | Upstream | Commit (date) | Licence | Why | Read first |
| --- | --- | --- | --- | --- | --- |
| `references/google-agentic-commerce_AP2` | https://github.com/google-agentic-commerce/AP2 | `e1ea56d` (2026-04-29) | Apache-2.0 | AP2 **v0.2** spec + samples, including an x402 human-not-present flow | `docs/ap2/specification.md`, `checkout_mandate.md`, `payment_mandate.md`, `flows.md`, `code/samples/python/src/roles/x402_psp_mcp/server.py`, `code/sdk/schemas/ap2/` |
| `references/google-agentic-commerce_a2a-x402` | https://github.com/google-agentic-commerce/a2a-x402 | `125db55` (2026-05-24) | Apache-2.0 | x402 over A2A (the AP2 crypto extension) | `spec/v0.2/spec.md`, `python/x402_a2a/` |
| `references/agentic-commerce-protocol_agentic-commerce-protocol` | https://github.com/agentic-commerce-protocol/agentic-commerce-protocol | `7fdd78d` (2026-07-17) | Apache-2.0 | ACP: checkout lifecycle + idempotency semantics to copy | `spec/2026-04-17/openapi/openapi.agentic_checkout.yaml`, `rfcs/rfc.payment_handlers.md`, `rfcs/rfc.seller_backed_payment_handler.md` |
| `references/Universal-Commerce-Protocol_ucp` | https://github.com/Universal-Commerce-Protocol/ucp | `58c7ab9` (2026-10-31) | Apache-2.0 | UCP: discovery, catalog actions, age hooks, AP2 extension | `docs/specification/overview/index.md`, `docs/specification/shopping/catalog/index.md`, `docs/specification/payment/extensions/ap2-mandates.md`, `source/schemas/common/types/warning_code.json` |
| `references/agent-intent_verifiable-intent` | https://github.com/agent-intent/verifiable-intent | `356c296` (2026-04-20) | Apache-2.0 | Mastercard Verifiable Intent v0.1: the L1/L2/L3 delegation model we map onto DF | `README.md`, `spec/credential-format.md`, `spec/constraints.md`, `protocol-landscape/protocols.md` |
| `references/visa_trusted-agent-protocol` | https://github.com/visa/trusted-agent-protocol | `16d59bd` (2025-10-28) | Visa developer terms (**read only**) | TAP: RFC 9421 agent signatures + key registry pattern | `README.md`, `cdn-proxy/`, `agent-registry/` |
| `references/worldcoin_agentkit-shopify-demo` | https://github.com/worldcoin/agentkit-shopify-demo | `3af21db` (2026-10-19) | none stated | A human-only store via AgentKit + Shopify MCP | `README.md`, `skills/shopify-agent-discount/get-coupon.py` |
| `references/modeofO_402-hardware` | https://github.com/modeofO/402-hardware | `e4c8899` (2026-07-19) | none (**read only**) | ESP32-S3 x402 vending terminal with QR + status polling: the closest prior art for iteration 2 | `README.md`, `docs/superpowers/specs/2026-06-23-x402-vending-terminal-design.md`, `backend/src/routes/{session,pay}.ts`, `firmware/src/` |

Already present and used here: `x402-foundation_x402` (`6a773db`), `MetaMask_smart-accounts-kit` (`555dd20`),
`MetaMask_delegation-framework`, `circlefin_arc-ecommerce-payments`, `circlefin_arc-escrow`, `circlefin_arc-node`,
`circlefin_skills` (`accept-agent-payments`), `worldcoin_agentkit`, `worldcoin_developer-docs`,
`nodestark_mdb-esp32-cashless`, `PlaiPin_solana-esp32-x402`, `LoupVaillant_Monocypher`.

## 6. Sources

**x402**
- Specs: https://github.com/x402-foundation/x402/tree/main/specs (`x402-specification-v2.md`, `schemes/exact/scheme_exact_evm.md`, `transports-v2/mcp.md`, `extensions/payment_identifier.md`, `extensions/extension-offer-and-receipt.md`, `extensions/extension-auth-hints.md`)
- ERC-7710 implementation draft: https://github.com/x402-foundation/x402/pull/1837
- Third-party extensions list: `docs/dev-tools/third-party-extensions.md`

**MetaMask**
- x402 overview: https://docs.metamask.io/smart-accounts-kit/1.5.0/guides/x402/overview/
- Buyer with delegation: https://docs.metamask.io/smart-accounts-kit/1.7.0/guides/x402/buyer/delegations/
- Seller guide: https://docs.metamask.io/smart-accounts-kit/development/guides/x402/seller/
- Packages: https://www.npmjs.com/package/@metamask/x402 · https://github.com/MetaMask/smart-accounts-kit/tree/main/packages/x402

**Arc**
- Memos: https://docs.arc.io/arc/concepts/transaction-memos.md
- USDC system events: https://docs.arc.io/arc/references/usdc-system-events.md
- EVM differences: https://docs.arc.io/arc/references/evm-differences.md
- arc-node source: https://github.com/circlefin/arc-node

**AP2**
- Repo: https://github.com/google-agentic-commerce/AP2
- Announcement: https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol
- FIDO working group: https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/
- a2a-x402: https://github.com/google-agentic-commerce/a2a-x402

**ACP and UCP**
- ACP: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol · https://developers.openai.com/commerce/guides/key-concepts
- UCP: https://github.com/Universal-Commerce-Protocol/ucp · https://ucp.dev
- UCP vs ACP comparison [S]: https://dev.to/ucptools/ucp-vs-acp-in-2026-a-technical-comparison-of-ai-commerce-protocols-50j7
- ACP explainer [S]: https://eco.com/support/en/articles/14845478-acp-agentic-commerce-protocol-explained

**Card networks**
- Visa TAP: https://github.com/visa/trusted-agent-protocol
- Visa Intelligent Commerce: https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22276.html · https://idtechwire.com/visa-reports-early-progress-on-agent-initiated-transactions-and-trusted-agent-protocol/
- Mastercard Verifiable Intent: https://www.pymnts.com/mastercard/2026/mastercard-unveils-open-standard-to-verify-ai-agent-transactions/ · https://github.com/agent-intent/verifiable-intent
- Mastercard on Know Your Agent: https://www.mastercard.com/global/en/news-and-trends/stories/2026/agentic-commerce-identity-know-your-agent.html

**Age and agent identity**
- x401 spec: https://x401.proof.com/spec/latest
- x401 launch: https://www.proof.com/blog/identity-infrastructure-agentic-internet-x401 · https://www.helpnetsecurity.com/2026/06/26/proofs-x401-establishes-an-open-protocol-for-ai-agent-identity-and-authorization/
- Age verification for agentic commerce [S]: https://xident.io/blog/age-verification-agentic-commerce-ai-agent-checkout-2026/
- Identity sector and agentic commerce [S]: https://www.biometricupdate.com/202606/identity-sector-moves-to-close-trust-gap-in-agentic-commerce

**World**
- AgentKit: https://docs.world.org/agents/agent-kit/integrate
- World ID for Agents, October 2026 [S]: https://www.biometricupdate.com/202610/world-brings-biometric-proof-of-human-to-banking-and-ai-agents · https://www.pymnts.com/news/artificial-intelligence/2026/sam-altmans-world-debuts-id-verification-for-ai-agents/
- Credentials: `references/worldcoin_developer-docs/world-id/idkit/credentials.mdx` and `world-id/credentials/9303.mdx`

**Circle**
- Nanopayments: https://developers.circle.com/gateway/nanopayments
- Seller skill: `references/circlefin_skills/plugins/circle/skills/accept-agent-payments/SKILL.md`

**Vending and IoT**
- 402-hardware: https://github.com/modeofO/402-hardware
- MDB cashless x402 rail: https://github.com/nodestark/mdb-esp32-cashless/pull/78
- x4pay: https://x4pay.org/

**Hackathon**
- MetaMask x 1Shot x Venice (x402 + ERC-7710 track): https://1shotapi.com/blog/metamask-1shot-api-dev-cook-off · https://www.hackquest.io/hackathons/MetaMask-Smart-Accounts-Kit-x-1Shot-API-x-Venice-AI-Dev-Cook-Off

**Protocol comparisons [S]**
- https://www.crossmint.com/learn/agentic-payments-protocols-compared
- https://www.digitalapplied.com/blog/agentic-commerce-standards-ucp-acp-ap2-2026-merchant-guide
