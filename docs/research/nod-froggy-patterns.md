# Nod and Froggy: patterns to port to the EVM/Arc wallet (research, 2026-11-05)

What this answers: what to take from Kris's two earlier agent wallets into system 1 (the personal wallet), and the
grant model that systems 2–4 (AI client, merchant, World proof) build on. Read it with `decisions.md`,
`infrastructure.md` and `research/evm-accounts-and-payments.md`. The stack choice (MetaMask Delegation Framework on
Arc) comes from that note and is not redone here.

Method: read-only. I read Nod (`~/code/hack-meridian-2026` at `26e3e37`, 2026-10-27) and Froggy
(`~/code/ethglobal-online-2026` at `214aa41`, 2026-09-13): READMEs, AGENTS.md, docs, spikes, evidence and the code
paths listed below. I checked the EVM claims against `references/MetaMask_delegation-framework` (`b4b8c41`),
`references/MetaMask_smart-accounts-kit` (`555dd20`) and `references/x402-foundation_x402`, plus `eth_getCode` on
`https://rpc.mainnet.arc.io` on 2026-11-05. Nothing in either repo was modified, built or run. I cloned nothing new.
The two central libraries Nod depends on were already cloned by another agent:
`references/cloudflare_workers-oauth-provider` (`b4cec31`) and `references/modelcontextprotocol_ext-apps` (`19256f5`).

Path prefixes: `nod:` = `~/code/hack-meridian-2026`, `froggy:` = `~/code/ethglobal-online-2026`, `refs:` =
`references/`, `MDF` = `refs:MetaMask_delegation-framework`.

## TL;DR

1. **Nod is the template.** In its own words, Froggy's limits "were enforced by its own server; … Nod moves the limit onto
   the account itself" (`nod:README.md:255`). Our `decisions.md` already says the same: "Database cannot authorise spend".
2. **Nod's core is already chain-agnostic.** These parts port as they are:
   - a `Chain` service with prepare/finalize steps for passkey approvals (`nod:packages/protocol/src/chain.ts`);
   - one Durable Object per wallet that serialises reserve → claim → submit → settle, with idempotency keys and request
     fingerprints;
   - a lane rule (alone vs needs the owner's nod) that records a reason;
   - OAuth 2.1 consent used as the grant ceremony;
   - MCP tools, MCP Apps cards, MCP Events and a skill.

   Only `nod:packages/stellar` and the two Soroban routers are Stellar code. The port is a new `Chain` for Arc under the
   same service.
3. **EVM makes four Nod parts simpler:**
   - **Installing a grant is an off-chain EIP-712 signature**, not a transaction.
   - **No "pocket":** x402 `exact` has an ERC-7710 transfer method where the delegation itself pays the seller, so the
     root caveats are counted (`refs:x402-foundation_x402/specs/schemes/exact/scheme_exact_evm.md:220-314`; MetaMask
     ships `@metamask/x402`, `refs:MetaMask_smart-accounts-kit/packages/x402`).
   - **No deposit router:** the account address exists before deployment (CREATE2, or the 7702 EOA), so an exchange can
     pay it.
   - **Fees are USDC at about $0.001**, so Nod's rent and fee-ceiling machinery goes.
4. **A passkey-owned account built only from stock, audited contracts is already live on Arc.** MetaMask's
   `HybridDeleGator` (P-256/WebAuthn signers, verified through precompile `0x100`) has code on 5042 at `0x48dB…FEC4`, and
   so does `SimpleFactory` at `0x69Aa…c77c`. It is the closest twin of Nod's "passkey is rule 0 of a contract account the
   relayer deploys". It conflicts with the 7702 lock in `decisions.md` only for passkey users. MetaMask users can stay on
   7702 + `EIP7702StatelessDeleGator`. Both use the same DelegationManager, so grants work the same either way. **This
   needs a decision.**
5. **Nod already has two kinds of grantee**, and they show how to generalise:
   - an AI app, whose key Nod's server holds (AES-GCM vault);
   - a **person link**, whose key lives only in a URL fragment and which Nod never sees.

   Generalised, a grantee is a delegate address, a display label, how it authenticates to us, and who holds its key
   (`service` or `self`). "Robot" or "AI app" is only a label, so the wallet can't tell a robot from anything else.
6. **One payment path for every grantee.** The grantee's key signs a one-shot leaf delegation (on the robot, in a
   browser, or in our vault for an MCP host). Our relayer redeems the chain `[leaf, …, root]`. Owner actions (payments
   past the allowance, revoke) can use the same path, as one-shot delegations the passkey signs. No bundler is needed.
   This is reasoned from code and needs a spike.
7. **Froggy adds policy and UX, not grants.** Its limits lived in Privy and its own server, and every agent shared one
   owner-wide mandate. Worth taking:
   - a pure, ordered `authorize` (allow / ask / deny, each naming its rule);
   - payee provenance enforced in code (addresses from the model or a page are never payable);
   - one `Allowance` value that generates both the signer policy and the server rule;
   - "refuse, don't queue" when no one can approve;
   - the human-wins-at-once takeover arbitration, which fits robot control;
   - Telegram as a delivery channel only;
   - loud stubs.
8. **The lessons that cost Nod the most** (§4):
   - Revoke is two steps; say so.
   - An unknown outcome is not "paid".
   - Never key on the OAuth `client_id`: CIMD ids are shared by every user of a client.
   - Name the target credential in `allowCredentials`.
   - Claude Code shows the model `structuredContent`, not the text.
   - claude.ai and Claude Code don't implement MCP Events, so poll with `wait_seconds`.
   - A host can cancel a URL elicitation early; return the plain result.
   - One fee-paying account serialises everything; use a pool.
   - Claim the evidence level you actually have ("8 PASS + 3 REF", not "9/9").

## 1. Nod end to end, with file paths

All under `nod:apps/web/src/server/` unless noted.

### 1.1 Signup: a passkey makes a smart account

- The browser creates a passkey (`attestation: "none"`). The Worker checks `clientDataJSON` (type, challenge, origin) and
  extracts the 65-byte P-256 key (`webauthn.ts`). Challenges are single-use rows in D1 (`webauthn_challenges`). The
  ceremonies are `registrationOptions` and `createWallet` (`owner.ts:65-165`); sign-in is `owner.ts:203`; the session
  cookie is `hm_owner`.
- The relayer deploys an OpenZeppelin Soroban smart account with the passkey as rule 0, the admin
  (`nod:packages/stellar/src/chain.ts:368`).
- **Deposit-first signup.** `planAccount` returns the future contract id (deployer + salt), so the wallet exists in D1
  before anything is onchain. The account deploys when the first USDC arrives, or before the first allowance
  (`deposit.ts:225-336`, `activateWallet`). On mainnet it deployed 83 s after a deposit
  (`nod:evidence/mainnet/deposit-2026-10-25T21-46Z.md`).
- **Throttles:** wallets per visitor (hashed IP) and per hour, and optional invite codes (`wallet-caps.ts`,
  `owner.ts:45-55`).
- **Wallet identity.** Approval pages show the wallet's name, short address and network. Prompts pass the target
  credential in `allowCredentials`; an empty list offered unrelated passkeys (`nod:docs/wallet-identity.md`).

### 1.2 Fund

- On testnet, a treasury sends 10 USDC on signup (`Chain.fundNewWallet`).
- **Deposit address** (Stellar only: exchanges cannot pay a `C…` contract address). A sponsored `G…` account is bound by
  an immutable router; anyone can sweep it, and the money can only go to that wallet. The wallet's DO alarm sweeps it
  every 60 s (`deposit.ts`, `wallet-object.ts:87-115`, `nod:contracts/deposit`, `nod:docs/spikes/s8-deposit.md`).
- **Cross-chain top-up** through NEAR Intents 1Click: quote → deposit address → sweep. Tools `wallet_topup_quote` and
  `wallet_topup_status`, and `topup.*` events (`topup.ts`, `nod:docs/NEAR-INTENTS.md`). Only dry-run quotes were proven.
- `wallet_overview` sets `low_balance` when the wallet holds less than the AI app may still spend.

### 1.3 Connecting an AI app: the OAuth consent is the grant ceremony

- **Library:** `@cloudflare/workers-oauth-provider` 1.2.4, with `/mcp` as the protected resource. Settings:
  - DCR and CIMD (`clientIdMetadataDocumentEnabled`);
  - scopes `wallet` + `offline_access`;
  - one-hour access tokens and PKCE (`oauth.ts:354-377`).

  CIMD needs the `global_fetch_strictly_public` flag. OAuth storage ran on a DO-backed KV shim because the API token had
  no KV permission (`kv-shim.ts`, `nod:docs/spikes/s4.md:23`).
- **`GET /authorize`:** sign in, or create a wallet. Then the consent page: "Allow **Claude** to spend up to **5 USDC**
  … until …", with the client's name, the domain that publishes it, and the redirect host (`oauth.ts:172-193`,
  `pages.ts`).
- **`POST /oauth/grant/prepare`:** a new key K (vault) and `prepareInstallGrant`, which returns a challenge. The
  prepared install is stored in `pending_grants` (`oauth.ts:87-160`).
- **`POST /authorize`:**
  1. A passkey assertion over that challenge.
  2. `installGrant` onchain.
  3. Create the pocket.
  4. `completeAuthorization`. Its `props` is a snapshot (`ConnectionProps`, `props.ts`): owner, wallet, connection,
     client, and the grant (id, allowance, expiry, rule id, signer key). Its plain `metadata` lets revoke find the grant
     (`oauth.ts:194-300`).
- **One consent = one OAuth grant = one connection = one spending grant.** Three permissions stay separate
  (`nod:docs/SPEC.md`, "Three permissions"):
  1. the connection: may talk, may not spend;
  2. the grant: may spend up to N until T;
  3. the owner's approval: one exact intent.

  A new chat, a reconnect, a token refresh or a top-up never creates a fresh allowance.
- `/mcp` decodes `props` with a Schema rather than trusting it. A token from an older shape gets 401 "reconnect"
  (`oauth.ts:329-352`).

### 1.4 The allowance

- **Onchain:** `add_context_rule(CallContract(USDC), [External(ED25519, K)], SPENDING_LIMIT{L+720, N}, valid_until)`.
  The product meaning is "N USDC in total until T", never replenished. The window is padded because OZ's policy is a
  rolling window (`nod:packages/stellar/src/grant.ts`).
- **Offchain mirror:** `spending_grants` holds total, spent, reserved, pocket balance, `valid_until`, rule id,
  `rule_status` and `status` (`nod:packages/protocol/src/entities.ts`, `migrations/0001_wallet.sql`).
- **Changing it:** `connection_grant_update` returns `/approve/allowance/<connection>`. That page makes a new key, a new
  rule and a new pocket, and re-points the grant with its counters reset. It refuses while a payment is in flight. A
  second tap removes the old rule (`allowance-page.ts:34-40`, `ledger.ts` `replaceGrant`).
- **"One number" (Kristjan, 2026-10-25 18:20 UTC).** A per-payment "nod line" was added at 17:10 and removed an hour
  later. Past the allowance, the passkey decides every time, with no upper cap (`nod:docs/SPEC.md`, decisions log).

### 1.5 Paying inside the allowance

- **`payment_prepare`** (`tools.ts:387`):
  - resolves the recipient from contacts, labels and past receipts; an ambiguous name returns candidates;
  - checks the recipient is ready;
  - freezes an intent under the idempotency key plus a request fingerprint, with the lane decided
    (`ledger.ts:510-600`).
- **The lane rule** (`ledger.ts:69-86`), checked in this order: forced to the owner → amount ≤ 0 → no live grant →
  recipient not ready → over what the allowance has left → otherwise autonomous. The owner lane records why:
  `owner_only | no_allowance | recipient_not_ready | over_allowance | new_contact`.
- **`payment_execute`** (`tools.ts:495-560`):
  1. The DO's `claimAutonomous` reserves the amount and marks the intent `submitted` *before* any chain call.
  2. `Chain.delegatedTransfer`: K signs, an enforce-mode simulation runs, the relayer submits.
  3. `settle` records the outcome: `Confirmed`, `Failed` or `Unknown` (`ledger.ts:780-930`).

  If the policy refuses (`#3221`), the intent moves to the owner lane. `Unknown` keeps the reservation and never
  resubmits.
- **One DO per wallet** (`WALLET_OBJECT.getByName(walletId)`) runs every money operation one at a time. Each operation's
  D1 writes commit in one batch (`wallet-object.ts:16-90`).
- A receipt exists only after confirmation. Every tool result carries `grant_remaining`.

### 1.6 x402: the pocket (a Stellar workaround)

- **Why:** hosted facilitators rejected smart-account payers, and Kristjan ruled out running a facilitator: "a product
  that only works with its own facilitator is not a product" (`nod:docs/SPEC.md`, x402 section).
- **How:** K also owns a classic `G…` pocket.
  1. K pulls `min(remaining, max(shortfall, 1 USDC))` into the pocket under the rule.
  2. The stock `@x402/stellar` client pays the seller from the pocket.

  The receipt carries both transactions (`tools.ts:954`, `grant.ts` `pullAmount`).
- **The cost:** up to about 1 USDC per app sits outside the policy (`.local/brainstorm/FINAL-REVIEW.md` §F).
- **Seller side** (`nod:apps/seller`): Hono x402 middleware, plus the `payment-identifier` extension. A DO dedup replays
  a settled response byte for byte (`dedup.ts`, `payment-ids.ts`). A fallback facilitator covers outages.

### 1.7 Past the allowance: "the nod"

- **The approval link.** The intent waits as `awaiting_approval` with `approval_url` = `/approve/<intent>`. Opening it
  changes nothing. The page shows:
  - the recipient's name **and** address, the amount and the network;
  - the fee ceiling and which app asked;
  - the agent's reason, marked as the agent's claim (`nod:docs/SPEC.md` "Approval link semantics", `routes.ts:150-270`).
- **What the passkey signs:** a WebAuthn challenge that is the chain digest of exactly that invocation
  (`prepareOwnerTransfer` / `finalizeOwnerTransfer`). Approved payments don't use the allowance. Intents expire after
  30 minutes.
- **How the nod reaches the person and the AI**, in four ways:
  - **A plain link in the tool text.** It works in every host.
  - **A URL elicitation on the 2026-07-28 lane.** When the client declares `elicitation.url`, the tool returns
    `elicitation/create` with `mode: url`, and the client retries with `requestState` (`mcp-modern.ts:1-130`).
  - **An `approval_message` sentence for the owner, plus the `approval.needed` event.**
  - **`payment_status` with `wait_seconds` ≤ 60**, which long-polls.

### 1.8 Revoke and sweep

- **Service half (instant):**
  - the connection and grant stop;
  - the OAuth grant is found by its metadata and revoked, which kills every token (`oauth-grants.ts`);
  - the pocket is swept back (`revoke.ts`).
- **Chain half:** the passkey removes the rule at `/approve/revoke/<connection>`. Until then `rule_status` is
  `removal_pending` and the service refuses to sign.
- **Kill switch:** `PAYMENTS_ENABLED=false` stops every money-moving signature, but revoke and sweep keep working
  (`routes.ts:131`).
- **Open items they recorded** (`nod:README.md`, "Known limits"):
  - destroy an app's key once revoke is confirmed;
  - an expiry job that sweeps pockets and removes the rules of expired allowances;
  - a watcher that settles payments whose outcome is unknown.

### 1.9 Links: three generations

- **v1, CAP-73 claim link** (Stellar only). A recipient without a trustline signs `trust`, and the sender's transfer rides
  in the same router call (`nod:contracts/onboard`).
- **v2, claim link** (`claims.ts:24-33`, `migrations/0009`). "1 USDC for Jan" is an intent without a destination. The
  person who opens it chooses where the money goes:
  - a new Nod wallet, created with a passkey;
  - their existing wallet;
  - an address.

  Then it takes the normal lanes. Nod holds nothing, and an unclaimed link expires after 7 days.
- **Person link** (`person-link.ts:20-30`, `migrations/0011`). Past the allowance, the sender's nod installs a one-shot
  rule: exactly the amount, for 7 days. Its only signer is an Ed25519 key that the sender's browser made and kept only
  in the URL fragment (`#k=…`). The recipient's browser signs the transfer; Nod checks it, enforce-simulates and relays
  it. Nod never holds the key or the money. A leaked link can take at most the amount, once.

### 1.10 Contacts, requests, recipient memory

- **Contacts an AI app adds** are marked `source: 'ai'`. The first payment to one needs the nod (`new_contact`), unless
  the wallet has paid that address before (`tools.ts:373-385`). Incoming payments never create trusted contacts.
- **Payment requests between wallets** (`requests.ts:29-37`, `migrations/0005`). A request is never authority to pay.
  One from outside the contacts always takes the owner lane. Its note is the requester's own words and never goes into
  an event payload.
- **Recipient memory.** A raw address with a name becomes a contact once a payment to it confirms (`migrations/0013`).

### 1.11 The MCP surface

- **Tools.** 24, plus two QR tools (`nod:apps/web/public/skill/nod-guide/references/tools.md`). Every tool has
  annotations (`mcp-tools.ts:111-335`). Every refusal is coded as `{ code, message, recovery, retry }`, with `retry` one
  of `same-key | new-key | after-approval | none | read` (`tool-errors.ts`).
- **MCP Apps.** One sealed HTML file (Foldkit, single-file build) serves three views: `ui://nod/card/v1`,
  `ui://nod/home/v1` and `ui://nod/recipient-scan/v1`.
  - Its CSP is empty, and it gets all its data through host-proxied `tools/call`.
  - Tools carry `_meta.ui.resourceUri`, plus `openai/outputTemplate` aliases for older hosts (`mcp-apps.ts`).
- **MCP Events.** Ten events, delivered by webhook (Standard Webhooks HMAC) or by poll. Payloads are written by Nod only
  (title, summary, URL, network), never third-party text (`events/catalog.ts`, `events/webhooks.ts`,
  `events/policy.ts`). The wire was ported from myapps.
- **Two MCP lanes:**
  - the SDK's stateless Streamable HTTP (1.32.2, a new server per POST);
  - a hand-written 2026-07-28 lane (`mcp-modern.ts`), because SDK 1.32.2 rejected that protocol version.
- **The skill.** `nod-guide` is served over MCP (`skills/list`, `skill://nod-guide/SKILL.md`), at `/SKILL.md`, and
  through the `get_guide` tool. CI checks the manifest hashes against the served bytes (`skill.ts`).
- **Logging.** One `mcp.tool` line per call, never the arguments, with the request id in `_meta`
  (`observe/tool-call.ts`).

### 1.12 Testing and evidence

- **`CHAIN=fixture`:** an in-memory `Chain` that refuses with the same error kinds as the real one
  (`nod:packages/protocol/src/fixture-chain.ts`). It drives the service tests and `VITE_BACKEND=fixture` site work.
- **Spikes S1–S8,** each with dated claims and transaction hashes (`nod:docs/SPIKES.md`). S1, the authority model, is the
  one to copy: exactly the limit passes, one stroop more fails, plus expiry, revoke, the owner lane and WebAuthn
  (`nod:docs/spikes/s1.md`).
- **Acceptance list** in the spec (1–9).
- **Scripts:**
  - `nod:scripts/demo/rehearse.ts` writes a `run.json` per run;
  - `smoke.ts` and `events-check.ts`;
  - `claude-code-check.ts`: a fresh Claude Code over CIMD, with a Chrome virtual authenticator for the passkey;
  - `site-e2e.ts`: the owner's path, with a real WebAuthn ceremony.
- **`/sample`** runs a sample agent through the same tool handlers on a demo wallet.
- **Evidence levels are named,** "code · committed · pushed · deployed · live-proven"
  (`.local/brainstorm/FINAL-REVIEW.md`). Every onchain claim links to the explorer.

## 2. Port map: Nod → Arc

Legend:

- **Stellar:** only exists because of Stellar.
- **Portable:** copy the code or the shape.
- **Shape:** the idea ports, the mechanics change.
- Confidence uses the §7 scale.

| # | Component | Nod (path) | Kind | EVM / Arc equivalent | Conf. |
|---|---|---|---|---|---|
| 1 | Owner account | OZ Soroban account, passkey = rule 0, deployed by the relayer (`packages/stellar/src/chain.ts:368`) | Stellar | **Passkey users:** `HybridDeleGator` (WebAuthn P-256 signer, precompile `0x100`, MDF `src/HybridDeleGator.sol:369`), deployed by our relayer through `SimpleFactory` (CREATE2). Both have code on Arc. **MetaMask users:** their EOA via 7702 → `EIP7702StatelessDeleGator` (`decisions.md`). Same DelegationManager for both | Uncertain |
| 2 | Passkey ceremonies | `webauthn.ts`, `owner.ts` | Portable | Same server code. Onchain, the DelegationManager checks a contract delegator's signature through ERC-1271 → `HybridDeleGator._isValidSignature` (WebAuthn). viem side: `smart-accounts-kit/src/webAuthn.ts` + `signer.ts:69-92` | Known (server) / Uncertain (onchain path) |
| 3 | Deposit-first signup | `planAccount`, `deployPlannedAccount`, `deposit.ts:274` | Shape | CREATE2 counterfactual address: money can arrive before the deploy. Deploy lazily with the first owner action. A 7702 EOA exists from the start | Known |
| 4 | Deposit address + router | `contracts/deposit`, `deposit.ts` | Stellar | **Drop.** Exchanges pay the account address directly (whether exchanges withdraw to Arc is a separate question) | Known |
| 5 | Fee payer | relayer pool, fee ceilings, rent (`packages/stellar/src/relayers.ts`) | Shape | A pool of relayer EOAs holding native USDC. Each submits `redeemDelegations`. `maxFeePerGas` ≥ 20 gwei (lower is dropped silently). One DO per relayer key for its nonce. A gas-price ceiling replaces the fee ceilings | Known |
| 6 | Welcome funding | `fundNewWallet` | Portable | Treasury → wallet USDC. We are on mainnet, so keep it tiny or off | Known |
| 7 | Cross-chain top-up | NEAR Intents 1Click (`topup.ts`) | Provider | Circle Gateway (domain 26, forwarder) or CCTP into Arc (`research/arc-and-circle.md`). Keep Nod's tool, event and DO-tick shape | Uncertain |
| 8 | Grantee key at rest | `packages/stellar/src/vault.ts`: `hmk1.<address>.<iv‖AES-GCM(seed)>`, address as AAD, HKDF from `VAULT_KEY` | Portable | The same format for a secp256k1 key. Unseal only inside the signer package | Known |
| 9 | Grant install | `prepareInstallGrant` / `installGrant`: a passkey-signed tx | Stellar | **Root delegation owner → grantee key.** Caveats: `ERC20TransferAmountEnforcer(USDC, N)` (this *is* "N until T"; it pins target, `transfer` and amount, `MDF src/enforcers/ERC20TransferAmountEnforcer.sol:87-97`), `TimestampEnforcer(T)`, `ValueLteEnforcer(0)`. Optional: `ERC20PeriodTransferEnforcer` for a daily cap, plus our per-payment, allowlist and co-sign enforcer (evm research). Signed offchain over EIP-712; no gas | Known (enforcers) / Uncertain (passkey signature) |
| 10 | Read the grant onchain | `readGrant`; spending history replay in `grant.ts` | Stellar | `ERC20TransferAmountEnforcer.spentMap(delegationManager, delegationHash)`, `DelegationManager.disabledDelegations(hash)`, plus `block.timestamp` against T | Known |
| 11 | Delegated payment | `delegatedTransfer`: K signs, enforce-simulation, relayer (`chain.ts:565`) | Shape | The grantee key signs a **leaf delegation** (grantee → relayer or `ANY_DELEGATE`, with `ExactExecution(USDC.transfer(to, amt))` + `LimitedCalls(1)` + `Timestamp`). The relayer runs `eth_call`, then `redeemDelegations([[leaf, root]])`. Same path whoever holds the key | Uncertain (spike) |
| 12 | Error kinds | `chainErrorKindFromCode` (#3221, #3002, #3000…) | Shape | Map revert strings to the same kinds: `ERC20TransferAmountEnforcer:allowance-exceeded` → `limit_exhausted`; `TimestampEnforcer:expired-delegation` → `expired`; `CannotUseADisabledDelegation` → `removed` | Known |
| 13 | Owner-lane payment | `PreparedOwnerAuth` → passkey → `finalizeOwnerTransfer` | Shape | A **one-shot delegation owner → relayer**, with `ExactExecution(transfer)` + `LimitedCalls(1)` + `Timestamp(+30 min)`. The passkey signs its EIP-712 hash as the WebAuthn challenge, and the relayer redeems it. Fallback: a 4337 userOp that our relayer submits through `EntryPoint.handleOps` (no hosted bundler) | Uncertain (spike) |
| 14 | Onchain revoke | remove the rule with the passkey (`routes.ts:273-345`) | Shape | `DelegationManager.disableDelegation(root)` must be called by the delegator (`DelegationManager.sol:90`). Use the same one-shot owner delegation with `ExactExecution(disableDelegation(…))`. There is no reentrancy guard in the way. The service half is copied as it is | Uncertain (spike) |
| 15 | Pocket for x402 | `createPocket`, `sweepPocket`, `pullAmount` | Stellar | **Drop.** Use x402 `exact` with `assetTransferMethod: "erc7710"`: the payer hands the facilitator a delegation, and the facilitator simulates and redeems it, so the caps apply. Or our relayer settles directly | Uncertain (Arc facilitator) |
| 16 | CAP-73 claim (trustline + pay) | `contracts/onboard`, routes `/claim/<intent>` | Stellar | **Drop.** ERC-20 needs no trustline | Known |
| 17 | Claim link v2 | `claims.ts` | Portable | Copy as it is. On open, the destination is a new passkey wallet, an existing wallet or an address | Known |
| 18 | Person link | `person-link.ts` | Shape | A one-shot delegation owner → link key. The link key is secp256k1, made in the browser and kept only in `#k=`. Caveats: `ERC20TransferAmountEnforcer(amount)` + `LimitedCalls(1)` + `Timestamp(7d)`. The recipient's browser signs the leaf; the relayer redeems. Revoke = `disableDelegation`. It is also the **pairing template for robots** (§5) | Uncertain (spike) |
| 19 | Wallet ledger DO | `ledger.ts`, `wallet-object.ts` | Portable | Copy the state machine (reserve → claim → submit → settle, `Unknown` never resubmits, idempotency + fingerprint), in our Domain-on-DO foundation. USDC uses 6 decimals (ERC-20 at `0x3600…`) | Known |
| 20 | Lane rule | `ledger.ts:69-86`, `ApprovalReason` | Portable | Copy it. New reasons: `restricted_item` (18+ rule), `attestation_missing`, `per_payment_cap` | Known |
| 21 | Recipient readiness | `readiness.ts` (trustline, account exists) | Stellar | Mostly drop. Keep "contract or EOA" and a revert path for Arc's runtime blocklist | Known |
| 22 | OAuth for MCP hosts | `oauth.ts`, `props.ts`, `oauth-grants.ts` | Portable | The same library (`refs:cloudflare_workers-oauth-provider`) with CIMD + DCR. The consent POST signs the root delegation instead of installing a rule | Known |
| 23 | MCP lanes | `mcp.ts`, `mcp-modern.ts` | Portable | Copy, including the URL elicitation for the nod and its cancel fix | Known |
| 24 | MCP Apps cards | `src/card/*`, `mcp-apps.ts` | Portable | Copy the shape (Foldkit single-file, empty CSP, `ui://…/v1`). The network label becomes "Arc", and links point to `explorer.arc.io` | Known |
| 25 | MCP Events | `events/*` | Portable | Copy. The chain watcher becomes `eth_getLogs` on USDC `Transfer(to = account)`; de-duplicate the EIP-7708 native `Transfer` (`infrastructure.md`) | Known |
| 26 | Skill + `get_guide` | `skill.ts`, `public/skill/nod-guide` | Portable | Copy the mechanism and rewrite the text. Put each sentence in `structuredContent` too | Known |
| 27 | Contacts, AI-added contact rule | `contacts-tools.ts`, `tools.ts:373` | Portable | Copy | Known |
| 28 | Payment requests | `requests.ts` | Portable | Becomes the merchant invoice / x402 `PaymentRequired`. Keep "a request is never authority to pay" | Known |
| 29 | x402 seller | `apps/seller` (Hono, payment-identifier dedup DO) | Shape | The system 3 merchant template, on `eip155:5042`, with the `exact` scheme (`erc7710` or 3009) | Uncertain |
| 30 | Fixture chain | `fixture-chain.ts` | Portable | Write `FixtureArcChain` with the same error kinds. Use an anvil fork of Arc for contract truth | Known |
| 31 | Kill switch, signup caps | `network.ts` caps, `wallet-caps.ts` | Portable | Keep both | Known |
| 32 | Evidence scripts | `scripts/demo/rehearse.ts`, `claude-code-check.ts`, `site-e2e.ts` | Portable | Copy the approach | Known |
| 33 | `stellar.toml`, `home_domain` | `stellar-toml.ts` | Stellar | Drop. ERC-8004 identity for robots is optional (evm research) | Known |
| 34 | *(Froggy)* pure `authorize` + rule ids + payee provenance | `froggy:packages/wallet/src/policy.ts:406`, `packages/domain/src/address.ts` | Portable | Our lane function: Nod's lanes inside Froggy's ordered rules, each refusal naming its rule. QR or camera addresses are payable only through a merchant-signed invoice | Known |
| 35 | *(Froggy)* human-wins takeover | `froggy:packages/browser/src/arbitration.ts` | Portable | Robot control: the joystick preempts the AI at once, the AI waits at most N s, and safe stop aborts the run first | Known (pattern) |
| 36 | *(Froggy)* Telegram pager | `froggy:apps/server/src/telegram/pager.ts` | Portable | Notification channel only (mygram). It carries Nod's approval link and never approves money itself | Known (pattern) / unproven live in Froggy |

## 3. What Froggy adds

Froggy (ETHOnline 2026) is a web workspace where a person and an AI share one Chrome. The spending leash is a Privy
policy on the person's embedded EOA plus Froggy's own server. Its limits are *not* onchain, and every agent shares one
owner-wide mandate. So it is not a template for grants. What it adds is a sharper policy engine, the approval and
handover UX, and a long list of failures. A subagent read it in full; I spot-checked the claims marked ✓.

**Policy engine (reuse the shape)**

- **Mandate rules are a tagged union, each with its own `RuleId`,** so every refusal names its rule
  (`froggy:packages/domain/src/mandate.ts:23-111`): `per_tx_cap`, `window_cap` (rolling `windowMs`), `payee_allowlist`,
  `host_allowlist`, `network_allowlist`, `expiry`, `approval_threshold`, and `ask_exemption`, which only an "allow for
  this session" answer writes.
- **`authorize` is pure:** no I/O, no clock (`froggy:packages/wallet/src/policy.ts:406-495`) ✓. It returns
  `allow{satisfied[]} | ask{question, ruleId} | deny{code, message, ruleId}`, in a fixed order: provenance → exact
  purchase grant → expiry → allowlists → caps → kind ceiling → the human line *last*. So "ask" is only offered for a spend
  that would otherwise be allowed. This is a richer version of Nod's `laneDecision`; use it as our lane function.
- **Payee provenance is enforced in code** (`froggy:packages/domain/src/address.ts:34-68`) ✓. A payee is `mandate`,
  `server`, `user` (the server checks the person's own typed text), `model` or `page`, and only the first three are
  payable. Nod's "an AI-added contact needs the nod first" is the same idea. **For us,** an address from a robot's camera
  or a merchant QR is `page`-grade. It becomes payable only when it resolves to an invoice our merchant service signed
  (`server`).
- **An authority table** (`froggy:packages/domain/src/authority.ts:42-222`) of action kind × `standing | ask`. A kind
  with no row is refused: "A missing leash must never fail open". In Froggy, transfers, trades and dapp signatures always
  ask.
- **One `Allowance` object generates both the signer policy and the server mandate**
  (`froggy:packages/wallet/src/person-policy.ts:240-290`). Ask-side kinds get *no* signer rule, so the standing key
  cannot sign them. For us, `grants.terms` should generate the caveats *and* feed the lane function, with a test that
  the two agree. Froggy's drift between them was a real bug (§4).

**Money path (same lessons as Nod)**

- **Reserve before the outbound call,** under a per-user lock. The key is a unique `(user, idempotencyKey)`, and only the
  caller that created the row may settle it. This came from a real double settle ("settle() ran 2 time(s)",
  `froggy:packages/wallet/src/ledger.ts:1-60`).
- **`uncertain` counts against the cap and is never refunded automatically** (`receipt.ts:118`).
- **Re-judge after an approval, and check for an abort once more before money leaves** (`session.ts:1135-1940`).
- **Exact-request approvals.** A purchase approval binds origin, URL, method/body, network, token, recipient and amount,
  plus the quote fingerprint. It is single use and lives 5 minutes (ADR 0014). A dapp signature is allowed by a one-shot
  Privy rule pinned to the exact calldata, live for 10 minutes (`wallet-requests.ts`). On EVM this is precisely a
  one-shot delegation with `ExactExecution` + `LimitedCalls(1)` + `Timestamp`, the same artifact as port-map rows 13 and
  18.

**Approvals and handover (reuse the UX)**

- **Four answers:** `deny_stop`, `deny`, `allow_session` (a 24 h exemption) and `allow_once`. Plus three non-answers:
  timeout (120 s), aborted, unavailable. The first outcome wins (`approval.ts:19`, `session.ts:1634-1725`). When no one
  can be asked, the spend is **refused, not queued** (`approval_unavailable`). That is our robot's rule if the owner
  doesn't answer, and the World deny/expire path.
- **"Two places to approve the same thing is how a person pays twice."** Home shows only a count; the approval lives in
  one place.
- **Telegram** (`apps/server/src/telegram/pager.ts`, `pairing.ts`). Pairing is a single-use 6-character code that lasts
  10 minutes. A button tap resolves the server registry and *signs nothing*. System posts carry a `[Froggy …]` marker so
  the model doesn't read them as its own words. A delivered message was never proven live, and there are known pairing
  holes (B-17: pairing silently takes over another account's pairing; B-18: the pairing still approves after sign-out).
  **For us,** Telegram (or mygram) can only *deliver* Nod's approval link. A money approval needs the passkey on our
  origin.
- **Human takeover** (`froggy:packages/browser/src/arbitration.ts:1-23`) ✓. There is no lock: human input wins at once
  (a 1.5 s quiet window), and the agent waits at most 15 s. `browser.take` aborts the run first. The agent hands off with
  `task_report{status: "blocked"}` for a login or CAPTCHA. **This maps directly onto robot control in iteration 2:** the
  browser joystick preempts the AI's commands at once, and "safe stop" aborts the run before anything else.

**OAuth for external agents**

- **Froggy hand-rolled its OAuth 2.1 server** (`apps/server/src/oauth.ts`, ADR 0012):
  - DCR, PKCE S256, RFC 8707 `resource`, RFC 9207 `iss`, RFC 7009 revoke;
  - tokens stored as SHA-256 hashes, with rotating refresh tokens;
  - replaying a code or an old refresh token revokes the whole grant.
- **Scopes name things to buy or read, never things to change.** Every operation re-checks scopes and revocation
  (ADR 0032), including before signing and before sending (ADR 0014).
- **But a grant held no spend limits of its own.** Agents spent owner-wide credits ("No per-agent caps" was an explicit
  cut, `docs/plan/NEXT_ITERATION.md:24`).
- **Use Nod's library choice instead** (`workers-oauth-provider`, CIMD). Keep Froggy's two rules:
  - re-check grant status on every operation;
  - no scope or tool can widen authority. In Froggy's words: "Nothing that changes spending authority is a tool."

**Testing and evidence**

- **Loud stubs.** A stub is selected only in `environment.ts`, from a placeholder value. Receipts carry
  `stubbed: true`, `/health` names each adapter's mode, and production refuses stubs at boot (ADR 0042).
- **The memory and Postgres stores run one shared contract-test suite.**
- **Spikes probe a control case first,** so an acceptance can't be mistaken for validation that never happened
  (ADR 0019 ✓).
- **Evidence files mark what is unproven with `TODO(tx)`.**

## 4. Lessons and mistakes to avoid

### From Nod

1. **Say that revoke is two steps.** The service stops at once; the onchain removal needs the passkey. The explainers
   first said "one step", and that had to be corrected (`FINAL-REVIEW.md` §D–E). Show both states in the UI, as
   `removal_pending`.
2. **An unknown outcome is not "paid".** `settle` keeps `Unknown` reserved and never resubmits, but the watcher that
   resolves those payments was never built (README "Known limits"; K2 "unknown outcome reads as paid" was a watch item).
   On Arc, finality is under a second, so resolve it by `eth_getTransactionReceipt` on the stored hash.
3. **Never key on the OAuth `client_id`.** CIMD ids are shared by every user of that client (`props.ts`, `entities.ts`).
   Key on a connection or grantee id of our own.
4. **Approval prompts must ask for the target credential.** An empty `allowCredentials` offered unrelated passkeys
   (`docs/wallet-identity.md`).
5. **Claude Code shows the model `structuredContent`, not the text block.** The guide and the sentences had to move into
   the structured value (`4506a1f`, `ab64a2f`).
6. **claude.ai and Claude Code don't implement MCP Events.** Cards poll, and the AI uses `payment_status`
   `wait_seconds`. Live events reached only Goblin and ChatGPT (README "Known limits").
7. **Hosts end URL elicitations early.** claude.ai closed the request while the owner was approving in another tab, and
   the error showed as "Failed". The fix: a cancelled request returns the plain result
   (`nod:evidence/mcp-apps/README.md`).
8. **One fee-paying account serialises everything.** They added a relayer pool, and still saw "wallet creation not final
   after 60 s when both relayers are busy" (`FINAL-REVIEW.md` K1). On Arc, use a pool of EOAs and a nonce DO each.
9. **A float outside the policy is a hole.** The pocket held up to about 1 USDC per app beyond the onchain limit
   (`FINAL-REVIEW.md` §F). On EVM, use ERC-7710 x402 and keep no float.
10. **Holding the app keys server-side is a custodial slice.** Disclose it: "If the Worker were compromised, an attacker
    could spend each active app's remaining allowance plus its pocket float" (`FINAL-REVIEW.md` §F). Our robot keys
    never leave the robot (`decisions.md`), which removes that slice for robots.
11. **The passkey signs a payload, not the words on the page.** A compromised approval page could misdescribe what it
    asks for (`FINAL-REVIEW.md` §F). Bind the displayed recipient and amount to the signed hash, and show the hash.
12. **Say which evidence level you have.** "All nine acceptance tests passed" became "8 PASS + 3 REF" (S1 proved test 3,
    which the product can't reach). Evidence levels: unit / local workerd / testnet / mainnet.
13. **Product creep, reverted.** The per-payment "nod line" lived one hour. Per-payment, grant and x402 caps were set to
    1,000,000 ("if people want to, let them"). One number, then the passkey, every time. For us, add per-payment or
    daily limits only where a merchant or robot story needs them.
14. **ChatGPT's app store bars crypto transfers.** Nod ran only as a developer-mode connector. Claude was the host they
    demoed in (`docs/SPEC.md`, decisions log).
15. **Read each library's real behaviour in a spike before building on it.** OZ's spending limit turned out to be a
    rolling window, and Soroban record-mode simulation skips custom auth (`nod:docs/research/smart-accounts.md:131`).
    The EVM equivalents to check: `ERC20PeriodTransferEnforcer` uses fixed windows and forfeits unused allowance; Arc
    drops transactions under 20 gwei silently.
16. **Infra surprise.** The Cloudflare API token had no KV permission, so OAuth storage ran on a DO-backed KV shim
    (`s4.md:23`). Check the token's scopes on day 1.

### From Froggy

1. **No server-side signing with the owner's credential, ever.** Privy refused `user_jwts` for every user, and the owner
   decided to sign in the browser only (`froggy:docs/decisions/0038-browser-signed-credit-purchases.md:5` ✓). Our
   passkey ceremonies are browser-only from day 1, as in Nod.
2. **A leash that is tighter on screen than in the signer.** The authority table was shown to the person but never
   consulted, and allowance edits never reached the live mandate (B-02/B-03, `froggy:docs/plan/REVIEW_2026-09-11.md:14`
   ✓). Generate the caveats and the lane rule from one `terms` value, and test that they agree.
3. **Check whether a cap is atomic before relying on it.** Privy aggregates only by recipient and updates the value
   *after* signing, so two signatures at once can both pass (ADR 0019 ✓). Our onchain `spentMap` is updated inside the
   redemption, so a second redemption reverts. We still reserve offchain so we don't send a transaction we know will
   fail.
4. **Fail-open defaults.** An unknown MCP scope defaulted to `services` (B-13). One agent could read another's tasks
   (B-07). A test fixture run against production latched the account to simulated credits (ADR 0042). Default-deny
   everywhere, and refuse stub adapters in a deployed stage.
5. **Don't promise controls or evidence that don't exist.** The signed-out page promised a freeze after it was removed
   (B-01). Telegram delivery was claimed but never proven.
6. **Unit and format traps:**
   - seconds vs milliseconds for expiry;
   - `chainId` as a decimal string, or rules "match nothing and refuse everything, quietly" (`person-policy.ts:40-100`);
   - a policy merge that only appends missing rule names, so a changed rule never ships (ADR 0027).

   Our versions: USDC has 6 decimals on the ERC-20 and 18 natively; Arc drops `maxFeePerGas` under 20 gwei silently.
7. **Transport limits on payment headers.** A payment header of about 10 KB got HTTP 431, and Bun's 10 s idle timeout
   returned 502 while the payment still settled (`docs/evidence/MAINNET_RELEASE.md`). An ERC-7710 `permissionContext`
   for a 2–3 hop chain is large, so measure it against x402 header limits.
8. **Users held USDC but no gas,** and the first live conversion failed (ADR 0026). Arc removes the gas token, but only
   if the relayer always submits.
9. **Address poisoning with homoglyph `USDC` tokens** (`docs/plan/STATUS.md`, 13 Sep). Count incoming money only from
   the canonical USDC `0x3600…0000` and the EIP-7708 native `Transfer` logs, never by symbol.
10. **The agent door was built twice,** because nobody knew the MCP surface already existed (REVIEW_2026-09-11). Keep one
    map of entry points in the docs.

## 5. An abstract grantee model

### How Nod represents an AI app today

- **`connections`:** the OAuth client as the owner saw it (`oauth_client_id`, name, publishing domain,
  `oauth_grant_id`, status). It is never keyed on `client_id`.
- **`spending_grants`:** the authority. Signer public key and key ref, total, spent, reserved, `valid_until`, rule id,
  rule status, pocket.
- **OAuth `props`:** a read-only snapshot taken at consent. Mutable state lives in D1 under `grant_id` (`props.ts`).
- **Intents and receipts** carry `requester` (the client's name, or `"owner"`) and a nullable `connection_id`.
- **A person link is a second grantee** in a different table (`claim_links`: `signer_public_key`, `rule_id`, …), with
  no connection at all.

So Nod already separates authority (grant) from transport (connection). But its schema hardcodes two kinds of grantee
in two tables, and only the `service`-held key kind can call tools.

### Generalised model (proposal)

D1 holds read models only. The authority is the signed delegation chain on Arc.

```
grantees      id, owner_id, wallet_id, label ("Claude", "Duck #1", "Link for Jan"), publisher?,  -- display only
              auth: oauth{oauth_grant_id, client_id, client_domain} | key | bearer,
              custody: service{key_ref} | self,
              delegate_address, status, created_at, revoked_at
grants        id, grantee_id, parent_grant_id?, delegation_hash, delegation (signed EIP-712 JSON), delegate,
              terms {asset, total, valid_until, period?, per_payment_max?, recipients?, merchant_rules?},
              attestations[] (refs, disclosed per grant), status (active|revoked|expired),
              chain_status (signed|disable_pending|disabled), spent, reserved, created_at
attestations  id, owner_id, kind (world.human | world.age_over_18 | …), issuer, evidence (proof ref, nullifier),
              verified_at, expires_at
intents       as in Nod, with grantee_id/grant_id in place of connection_id; requester label snapshotted
```

Rules:

- **No code branches on what the grantee is.** Only `auth` (how it proves itself to our service) and `custody` (who
  signs its leaf delegation) change behaviour. The chain only ever sees `delegate` and the caveats. This is what makes
  "the wallet must not know the grantee is a robot" true.
- **One payment path** (port map row 11). The leaf delegation is signed by the vault (`service`) or by the grantee
  itself (`self`). Our relayer redeems `[leaf, …, root]` and the ledger DO settles. Online and offline payments are the
  same artifact (evm research, option A).
- **Three permissions, as in Nod:** may talk (auth), may spend (grant), one exact owner approval (intent). Reconnecting
  never mints a new grant. Froggy put the first two this way: "Its grant bounds what it may ask for, and the leash
  independently bounds what it may spend" (`froggy:docs/product-description/foundations/identity-and-agents.md`).
  Froggy had the leash per owner. We make it per grant.
- **`terms` is the single source.** The caveats, the lane function and the consent text are all generated from it
  (Froggy lesson 2).

| Grantee | Authenticates to the wallet service by | Key custody | Who signs a payment | Nod precedent |
|---|---|---|---|---|
| Claude, ChatGPT, any MCP host | OAuth 2.1 (CIMD/DCR) | `service` (vault) | the vault, on a tool call | AI app key K |
| Our AI client (0G) | OAuth 2.1 at first; later it signs with its own key | `service` first, `self` later | either | AI app key K |
| Robot | requests signed by its delegate key, after pairing by QR (address + nonce) | `self`: the key never leaves the robot | the robot, offline if needed | person link (Nod never sees the key) |
| A person (link) | holding the link (bearer) | `self`: the URL fragment | their browser | person link |

**Sub-grants (AI client → robot)** are how "the robot can pay too" works in the headless iteration. The AI client holds
grant G (owner → client, say 10 USDC). It re-delegates to the robot with tighter caveats (client → robot, say 2 USDC for
1 hour). The robot's payment chain is then `[robot leaf, client→robot, owner→client]`.

- Every caveat in the chain runs. `ERC20TransferAmountEnforcer` keys its `spentMap` by each delegation's own hash, so
  both caps apply (`ERC20TransferAmountEnforcer.sol:96`).
- Disabling the parent breaks the children.
- In the wallet it is `grants.parent_grant_id`.
- When the client's key is `service`-held, this becomes one tool, `grant_delegate({ to, amount, expiry })`, which the
  service signs inside the parent.
- Nod had the same idea as application-level "task budgets" (SPEC "Remaining ideas"). On EVM it is onchain.
- **Decision for Kris:** does a sub-grant inside the parent need the owner's nod, or is "visible on the dashboard and
  revocable" enough?

**Carrying the World proof with a grant** (the details belong to `research/world.md`; the grant model only needs a slot):

1. The owner verifies once in the wallet; the server checks the proof. That creates an `attestations` row.
2. The consent or grant page lists which attestations this grantee may present ("Share: over 18, verified by World").
   Disclosure is opt-in per grant, like an OAuth scope.
3. The grantee receives a **grant credential**: an EIP-712 `GrantAttestation{ delegationHash, delegator, claim, issuer,
   verifiedAt, expiresAt }` signed by our attester key, handed over with the permission context.
4. The merchant checks the signature, and that the redeemed chain's root hash equals `delegationHash`.

A stronger version is a custom caveat that checks a World proof onchain against Arc's `WorldIDSatellite`
(`research/world.md`). Either way: no personal data in the grant, and per-action nullifiers.

**The MCP surface, generalised:**

- **Keep Nod's tools.** `wallet_overview`, `payment_prepare`, `payment_execute`, `payment_status`,
  `payment_approve_url`, `paid_resource_fetch`, and the `connection_grant_*` tools renamed to `grant_*`.
- **Add for self-held keys:** `grant_context`, which returns the signed chain plus its attestations for a `self` grantee
  to redeem.
- **Add for robots:** `grant_delegate`, for sub-grants.

Keep Nod's rule that tools changing the owner's authority only *return links*. The one open exception is
`grant_delegate`, which stays inside an existing grant.

## 6. Recommendations

1. **Port Nod's service skeleton first, onto our foundation:**
   - the `Chain` boundary, rewritten for Arc;
   - the wallet ledger DO (as an alchemy-domain aggregate);
   - the lane rule and its reasons;
   - intents, operations and receipts;
   - coded tool errors;
   - a fixture chain.

   That is iteration 1's backbone, and it can be built before any contract work.
2. **Run one 4-hour "S1-Arc" spike before building on the owner account.** It decides #1/#2/#9/#11/#13/#14 of the port
   map. On a 5042 fork, then on mainnet with cents:
   1. Deploy a `HybridDeleGator` with a WebAuthn key through `SimpleFactory`.
   2. The passkey signs a root delegation (exact N, T).
   3. A grantee key signs a leaf; the relayer redeems: N passes, N+1 base unit fails `allowance-exceeded`.
   4. After T it fails; after `disableDelegation` (passkey one-shot) it fails.
   5. Make an owner-lane one-shot transfer.

   Record each claim with an `explorer.arc.io` link, as Nod's S1 did. If the passkey path fails, fall back to 7702 for
   everyone (`decisions.md`) with the browser EOA key, and record the recovery trade-off.
3. **Grant semantics:** Nod's single number ("N USDC until T", `ERC20TransferAmountEnforcer` + `TimestampEnforcer`).
   Add the period, per-payment and allowlist enforcers only for the robot and merchant stories.
4. **One payment path** (leaf → relayer), for both custody modes and for online and offline payments.
5. **OAuth consent as the grant ceremony:** copy `oauth.ts` almost line for line. Turn CIMD on. Set
   `revokeExistingGrants: false`. Decode `props` with a Schema.
6. **Revoke:** the service half instantly (stop signing, revoke the OAuth grant), then the onchain `disableDelegation`
   with the passkey. Both states are visible to the owner and in `wallet_overview`.
7. **x402 through `erc7710`, with no pocket.** Run our own facilitator or settle directly (evm research).
8. **Robot pairing as an inverted person link:**
   1. The robot makes its key and shows a QR with its address and a nonce.
   2. The owner's passkey signs owner → robot.
   3. The robot authenticates by signing requests.
9. **MCP Apps and Events as in Nod,** with a sentence in `structuredContent`, `wait_seconds` polling, and the
   URL-elicitation cancel fix.
10. **Evidence discipline:** a fixture chain for unit tests, anvil fork tests for contracts, a rehearsal script, a
    Claude Code check, and claims tagged with their level.
11. **From Froggy:**
    - Make the lane function a pure, ordered `authorize` whose refusals name their rule.
    - Enforce payee provenance in code.
    - When no one can approve, refuse rather than queue.
    - Make stubs loud, and refuse them in a deployed stage.
    - Use the human-wins arbitration for robot control.
    - Use Telegram or mygram only to deliver approval links.

## 7. Confidence

| Item | Level | Why / what decides it |
|---|---|---|
| Ledger DO state machine, idempotency, lanes, receipts (port as is) | **Known** | Proven in Nod on mainnet; nothing chain-specific in it |
| OAuth 2.1 + CIMD on Workers with `workers-oauth-provider` | **Known** | Nod S4 and three real hosts (claude.ai, ChatGPT, Goblin) |
| MCP tools, Apps cards, Events, skill delivery | **Known** | Nod evidence in `evidence/mcp-apps/README.md` |
| Grant = root delegation with `ERC20TransferAmountEnforcer` + `TimestampEnforcer` (+ `ValueLte(0)`) | **Known** | Enforcer source read; addresses have code on Arc |
| Relayer pays gas in USDC; revert strings → error kinds | **Known** | Arc facts (`arc-and-circle.md`); MDF source |
| Vault for `service`-held keys | **Known** | Nod `vault.ts`; same crypto for secp256k1 |
| Deposit router, CAP-73 router, pocket, rent/fee ceilings: dropped | **Known** | Stellar-only constraints |
| Pure `authorize` with rule ids, payee provenance, refuse-not-queue (Froggy) | **Known** | Froggy code read and spot-checked |
| Human-wins takeover arbitration reused for robot control | **Known** (pattern) | Froggy `arbitration.ts`; robot transport is another note's topic |
| Telegram as a delivery channel for approval links | **Uncertain** | Froggy never proved a delivered message live; mygram exists on this box |
| `permissionContext` size for a 2–3 hop chain inside x402 headers | **Uncertain** | Froggy hit HTTP 431 at about 10 KB; measure it |
| Passkey owner via `HybridDeleGator` + `SimpleFactory` on Arc | **Uncertain** | Code exists on 5042; WebAuthn-signed EIP-712 through ERC-1271 not run yet (S1-Arc spike) |
| Leaf delegation (grantee → relayer/`ANY_DELEGATE`) redeemed with root caveats counted | **Uncertain** | Reasoned from `DelegationManager.sol:126-300`; also open in the evm research |
| Owner actions (owner-lane payment, `disableDelegation`) as passkey-signed one-shot delegations to the relayer | **Uncertain** | No reentrancy guard in the way (`DelegationManager.sol:90,126`); not run |
| Sub-grant chain owner → client → robot, both caps enforced | **Uncertain** | `spentMap` is keyed per delegation hash; three-hop chain not run |
| Person link / robot pairing as a one-shot delegation to a browser- or robot-held key | **Uncertain** | Same mechanics as the two rows above |
| x402 `exact` with `erc7710` on `eip155:5042` | **Uncertain** | The spec and `@metamask/x402` exist; no Arc facilitator yet, so we run our own or settle directly |
| Cross-chain funding with no visible gas (Gateway/CCTP) in place of 1Click | **Uncertain** | See `arc-and-circle.md`; not run by us |
| Owner account choice: passkey HybridDeleGator vs 7702 for everyone vs both | **Unknown (decision)** | `decisions.md` locks 7702; the passkey-only signup requirement points to HybridDeleGator |
| Whether MetaMask will 7702-upgrade an EOA on Arc 5042 ("connect MetaMask") | **Unknown** | MetaMask enables 7702 per chain; not checked |
| Sub-grants without the owner's nod? | **Unknown (decision)** | Product call for Kris |
| How the World credential travels: wallet-signed `GrantAttestation` vs an onchain caveat against `WorldIDSatellite` | **Unknown** | Depends on the World research (IDKit `minimum_age` access, proof-binding) |
| Whether the AI client (system 2) holds its own key from day 1 | **Unknown (decision)** | `service` custody is proven (Nod) and enough for iteration 1 |
