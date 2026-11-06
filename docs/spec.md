# Vitaquack implementation spec

**This file is the build order.** It wins over every other document in this repo; where it is silent,
`docs/decisions.md` wins, then `docs/plan.md`. **Submission deadline: Sat 7 Nov 09:00 IST.**

Vitaquack: a passkey wallet on Arc grants a USDC budget to a robot's chip. A Robot Agent (per robot) asks 0G what to
buy, the chip signs every payment, our x402 facilitator settles it, and Arc enforces every limit. Over the limit or for a
restricted item, the owner approves once in World App. The duck is the first robot; iteration 1 is fully virtual.

## 0. Rules and the definition of done

Rules every worker follows:

1. **Arc is the authority.** Caps, allowlist, replay protection, revocation and the approval requirement are checked by
   the DelegationManager and our enforcer when a payment lands. D1 is a mirror, never an authority.
2. **The chip signs every robot payment.** The Robot Agent never holds a spending key. The chip builds the leaf itself
   from the invoice and refuses anything that doesn't match its policy.
3. **Never fake a 0G decision.** If the 0G call fails, times out or returns garbage, the errand ends in `safe_stop` and
   nothing is paid. No local fallback decision.
4. **Camera frames are evidence, not decision input** (`docs/decisions.md`, Camera frames). The chip may attach
   **chip-signed frames or short clips** to an episode. R2 is the fast copy, served to the owner, and the evidence
   uploader also uploads each frame plain to 0G Storage. Each frame's sha256, chip signature and 0G Storage root
   (`observations[].rootHash`) are in the episode JSON that `EpisodeLog` anchors, and Verify downloads each frame from
   0G by root and re-hashes it. Today only the scan's JPEG crop (≤ 64 KB, `APP_SCANS_ENABLED`) is implemented; more
   frames per episode would use the same route and storage with a larger size limit. The **0G decision stays over
   structured input and never receives an image**, so it stays deterministic at temperature 0, replayable, and sealed
   in the glm-5.3 TEE. Vision from 0G would be a separate, explicitly labelled call. The **live view**
   (`APP_LIVE_ENABLED`, §3 `live_frames`) is owner-only, never evidence and never on 0G: the chip signs about one
   whole frame a second (`vitaquack-frame:v1|robotId|sha256|capturedAt`, never a scan message) to
   `POST /api/chips/:robotId/frames`, the Worker keeps only the latest, and the conversation reads it every 500 ms.
5. **Restricted items need a human approval, never an "age check".** Say "approval for a restricted item".
6. **No keys, tokens, signatures' private inputs, World ID tokens or prompts in logs, commits or tool output.**
7. **Foundation rules apply** (`AGENTS.md`): Effect 4, Foldkit, Alchemy, gates. Commit per milestone with
   `git commit -- <paths>`. `heavy --wait bun run check` before every push. Record deviations here, not in your head.
8. **Report evidence, not status.** A milestone is done when its acceptance command passes and the output is in the
   report (and, for chain work, in `docs/evidence/`).

Done = the virtual loop runs **on Arc mainnet with real broadcasts** against the deployed app: passkey signup → grant to
a mock chip → "buy chai" (0G decides, chip signs, facilitator settles, gate shows OPEN) → "buy thali" over the per-payment cap (World approve: paid; World deny:
nothing paid; World approve: paid) → revoke → next errand fails on-chain; every decision logged with a 0G request id and
the episode uploaded to 0G Storage with an `EpisodeLog` record. All of it recorded in `docs/evidence/`.

## 1. Architecture in one screen

| System | Where it runs | What it does |
| --- | --- | --- |
| **Wallet** | the app Worker (`packages/server`) + Foldkit pages (`apps/web`) | passkey signup/login, HybridDeleGator account, grants to chips, revoke, approvals (World), activity |
| **Robot Agent** | the app Worker, Effect services over D1 (no Durable Objects, no WebSockets, no MCP) | per-robot errand state machine, 0G `decide` call, chip sign requests, evidence records |
| **Merchant** | the app Worker + pages | catalogue, invoices, x402 402 + pay, Ed25519-signed gate status, virtual gate page |
| **Chip** | `apps/chip` (Bun) on a laptop now, the Radxa later | holds the robot key, long-polls for sign requests, enforces its policy, signs leaves, honours the lease |
| **Facilitator/relayer** | `packages/chain` inside the Worker | verifies x402 payloads, simulates, submits `redeemDelegations`, owner actions, account deploys |
| **Evidence uploader** | `tools/evidence-uploader` (Bun, on netcup, outside Cloudflare) | drains pending episodes to 0G Storage and `EpisodeLog` |
| **Contracts** | **Arc Studio is the source** (`contracts/studio/` = pinned pull; Foundry builds, tests and deploys that pull; no contract edits in this repo) | `RobotPaymentPolicyEnforcer` on Arc mainnet, `EpisodeLog` on 0G Galileo, both deployed from the pull |

Deviation from `AGENTS.md`'s Domain-on-Durable-Objects shape: live coordination is Effect services + D1 with HTTPS
long-polling (`docs/decisions.md`, Robot Agent). **Keep `packages/domain` and `DomainLive` wired exactly as they are**
(empty model): removing them broke the Worker types on 5 Nov.

## 2. Milestones

Lanes: **Lead** (chain, contracts, facilitator), **Wallet** (auth, pages, World), **M+R** (merchant, chip, robot
agent, uploader). Critical path **M0 → M1 → M2 → M5 → M7**. M0a runs in parallel with M0. M3/M4 need only M0's
schemas. M6 needs M2's approver.

| M | Goal | Main paths | Acceptance | h | Lane |
| --- | --- | --- | --- | --- | --- |
| **M0** | Protocol + chain packages, golden fixtures | `packages/protocol` (`@ethmumbai/protocol`, dep `effect` only, browser-safe), `packages/chain` (`@ethmumbai/chain`: `viem@2.57.16`, `@metamask/smart-accounts-kit@2.0.0`; server-only); `tools/quality/graph.ts` (`web` → protocol; `server` → protocol, chain; `chain` → protocol; `assertBrowserSafe` rejects `/^(viem\|@metamask\/)/` and `/^packages\/chain\//`) | `bun run test:unit` green with fixtures: `invoiceHash` of the S2 spike invoice; 26-char base32 ↔ `invoiceId` round trip; `hashDelegation(leaf)` equals the kit's; DeleGator signature encoding vector; `Approval` EIP-712 vector. `bun run graph:check` green | 2 | Lead |
| **M0a** | Passkey-only auth (§4) | `packages/auth/src/{Session,Passkey,Spki,Challenge}.ts`, `packages/server/src/auth/`; `@simplewebauthn/server@^14`, `@simplewebauthn/browser@^14`, no `@yielded/*`. English only (`docs/decisions.md`, i18n) | unit: register/login verify with `@simplewebauthn/server` against a software authenticator fixture; bad origin, bad rpId hash, UV unset, stale counter, replayed challenge all rejected; SPKI → x,y vector. Native: register → cookie → `GET /api/auth/session` 200; mutating POST without `Origin` → 403; `bun run i18n:check` green | 4 | Wallet |
| **M1** | Contracts + deploy (**source = the Arc Studio project; `contracts/studio/` is a pinned pull, never edited**) | `contracts/` (Studio URL in its README), `docs/evidence/contracts.md` | `forge test` green: under-cap allowlisted ok; over-cap without approval reverts `RPP:approval-required`; off-list without approval reverts; valid approval ok; wrong payee, wrong amount, expired, reused nonce, wrong signer revert. `forge script script/DeployArc.s.sol --rpc-url $APP_ARC_RPC_URL --broadcast` prints `ENFORCER_ADDRESS`; `DeployZg` on Galileo prints `EPISODE_LOG_ADDRESS` | 4 | Lead |
| **M2** | Facilitator + relayer + first real payment | `packages/chain/src/{Facilitator,Relayer}.ts` (port of `docs/research/spikes/s2-facilitator-spike.ts.txt`), `packages/chain/scripts/smoke.ts`, `packages/db` (§3) | `heavy --wait bun packages/chain/scripts/smoke.ts --amount 0.01` on Arc mainnet exits 0 and prints: deploy tx, settle tx (receipt success), replay → `IdEnforcer:id-already-used`, revoke tx, next settle → `CannotUseADisabledDelegation`. Hashes in `docs/evidence/2026-11-06-smoke.md` | 3 | Lead |
| **M3** | Merchant | `packages/server/src/merchant/`, `apps/web/src/pages/{Merchant,Gate}.ts` | Native: `POST /api/merchants/duck-cafe/invoices {itemId:"chai"}` → 201; `GET /api/i/:id` → 402 (§7) with `PAYMENT-REQUIRED`; `GET /api/invoices/:id/status?nonce=abc` → signed `pending`; with a forced `paid` row: first read `paid`, second `used`; scene: `/gate/duck-cafe` renders CLOSED | 3 | M+R |
| **M4** | Chip protocol + mock chip | `packages/server/src/chip/`, `apps/chip` | Native: pair → empty poll returns ≤ 25 s with a lease → a queued request is delivered → response accepted; bad token 401; reused code 409. `bun apps/chip/src/main.ts --server http://127.0.0.1:8787 --pair CODE` logs `paired`, `lease ok`, `signed <invoiceId>`; with the network cut it logs `STOP motors (lease expired)` within 35 s. Unit: every refusal code of §5 | 3 | M+R |
| **M5** | Robot Agent + uploader | `packages/server/src/robot/`, `tools/evidence-uploader` (`@0gfoundation/0g-storage-ts-sdk@1.2.13`, `ethers@6.13.1`) | Native with a stub 0G server: `POST /api/robots/:id/errands {item:"chai"}` → `signing` + one `decisions` row with `request_id`; stub timeout → `safe_stop`, no `chip_requests` row. Live: `heavy --wait bun tools/evidence-uploader/main.ts --once` prints `rootHash`, the storage tx and the `EpisodeLog.record` tx; `GET /api/evidence/:id` shows them | 5 | M+R |
| **M6** | World approval | `packages/server/src/world/`, `apps/web/src/pages/Approval.ts` | Live with Kris's Orb ID: approve → `approvals.approved` with a signature, errand `signing` → `paid`; deny → `denied`, no tx; replayed `code` 409; unit: a token whose `amr` contains `mfa` is accepted with its `amr` recorded | 3 | Wallet |
| **M7** | Wallet pages, console, polish, evidence | `apps/web/src/pages/`, `apps/web/src/Passkey.ts`, `packages/server/src/wallet/`, `docs/evidence/` | Scene tests per page; Playwright's virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator`) proves signup → counterfactual address shown → grant signed → revoke; deployed: the full loop recorded in `docs/evidence/demo-run.md` | 6 | Wallet (+all) |

Owner's prerequisites (block M2/M5/M6): ≥ 5 USDC to the relayer EOA and 2 USDC to a demo owner on Arc; a keyed Arc
RPC URL; the 0G API key, base URL and model; 0G Galileo gas for the storage signer; a World IdP client (redirect URI =
the deployed app URL); an Arc Studio project and its URL.

## 3. D1 tables (`packages/db/src/schema.ts`, drizzle `sqliteTable`, snake_case)

Conventions: `id text PK` = 26-char base32 unless noted; `created_at integer (timestamp_ms) NOT NULL`; uint256 and USDC
amounts as decimal `text`; addresses checksummed `text`; hashes `0x` hex `text`; other `*_at integer` are unix seconds.
No `Date` or `crypto.randomUUID` in server code (Effect diagnostics): use `Clock` and `Random`.

| Table | Columns | Keys | States |
| --- | --- | --- | --- |
| `accounts` | `id`, `display_name text NOT NULL`, `security_revision text NOT NULL`, `smart_account text NOT NULL`, `deploy_salt text NOT NULL`, `eoa_owner text`, `deploy_status text NOT NULL`, `deploy_tx text`, `world_sub text`, `created_at` | unique `smart_account` | `deploy_status`: `counterfactual` `deploying` `deployed` `failed` |
| `passkeys` | `credential_id text PK` (base64url), `account_id text NOT NULL`, `alg integer NOT NULL`, `spki text NOT NULL` (base64), `x text NOT NULL`, `y text NOT NULL`, `sign_count integer NOT NULL`, `created_at`, `last_used_at integer` | index `account_id` | none |
| `auth_challenges` | `id text PK` (= challenge base64url), `kind text NOT NULL`, `account_id text`, `ref text`, `expires_at integer`, `used integer(boolean)`, `created_at` | index `expires_at` | `kind`: `register` `login` `grant` `revoke` |
| `robots` | `id`, `account_id`, `name`, `pairing_code text`, `pairing_expires_at integer`, `chip_address text`, `chip_token_hash text`, `paired_at integer`, `last_poll_at integer`, `lease_until integer`, `status text NOT NULL`, `created_at` | unique `pairing_code`, unique `chip_address`, index `account_id` | `status`: `unpaired` `paired` `revoked` |
| `grants` | `id`, `robot_id`, `account_id`, `delegation_hash text NOT NULL`, `delegation_json text` (signed; salt as a decimal string; null until signed), `daily_cap`, `per_payment_cap`, `allowlist_json`, `start_at`, `expires_at`, `status text NOT NULL`, `revoke_tx text`, `created_at` | unique `delegation_hash`, index `(robot_id, status)` | `status`: `unsigned` `active` `revoking` `revoked` `expired` |
| `invoices` | `id`, `merchant_id`, `item_id`, `pay_to`, `asset`, `amount`, `expires_at`, `lines_hash`, `rules_hash`, `invoice_hash text NOT NULL`, `restricted integer(boolean)`, `status text NOT NULL`, `paid_tx text`, `used_at integer`, `created_at` | unique `invoice_hash` | `status`: `pending` `paid` `used` `expired` |
| `payments` | `invoice_hash text PK`, `invoice_id`, `robot_id`, `episode_id`, `payer`, `delegation_manager`, `context_sha256`, `approval_id`, `status text NOT NULL`, `tx_hash`, `gas_used`, `fail_reason`, `created_at`, `settled_at integer` | index `episode_id` | `status`: `verifying` `settling` `settled` `failed` |
| `approvals` | `id`, `account_id`, `robot_id`, `episode_id`, `invoice_id`, `invoice_hash`, `payee`, `amount`, `expiry integer`, `nonce text NOT NULL` (bytes32), `oidc_state text NOT NULL`, `oidc_nonce text NOT NULL`, `status text NOT NULL`, `jti text`, `sub text`, `auth_time integer`, `amr_json text`, `signature text`, `error text`, `created_at`, `decided_at integer` | unique `nonce`, `oidc_state`, `jti` | `status`: `requested` `opened` `approved` `denied` `expired` `consumed` |
| `episodes` (= errands) | `id`, `robot_id`, `account_id`, `item`, `invoice_id`, `state text NOT NULL`, `decision_count integer`, `result text`, `request_ids_hash text`, `state_changed_at integer`, `created_at` | index `(robot_id, created_at)` | `state`: §6 |
| `decisions` | `id`, `episode_id`, `step integer`, `model`, `request_id`, `chat_id` (ZG-Res-Key), `provider`, `latency_ms integer`, `prompt_sha256`, `input_json`, `action text NOT NULL`, `reason`, `outcome`, `outcome_ref`, `error`, `created_at` | unique `(episode_id, step)` | `action`: `pay` `ask_human` `walk_away` `safe_stop`; `outcome`: `paid` `approved` `denied` `refused` `failed` `walked_away` `safe_stop` |
| `evidence_uploads` | `episode_id text PK`, `status text NOT NULL`, `payload_json`, `request_ids_hash`, `root_hash`, `storage_tx`, `log_tx`, `attempts integer`, `claimed_at integer`, `uploaded_at integer`, `error`, `created_at` | index `status` | `pending` `uploading` `uploaded` `failed` |
| `live_frames` | `robot_id text PK`, `frame_sha256`, `bytes integer`, `captured_at integer` (unix ms, chip-signed), `received_at integer` (unix ms, Worker clock) | none | the robot's latest live frame only, written only while it has an open intent; JPEG in R2 `live/<robotId>.jpg`, overwritten each time; `received_at` caps the rate at one per 200 ms (`APP_LIVE_ENABLED`) |
| `observations` | `id text PK`, `robot_id`, `episode_id`, `invoice_id`, `frame_sha256` (0x + 64 lowercase hex), `bytes integer`, `captured_at integer` (unix ms), `chip_sig` (0x + 65 B), `r2_key`, `zg_root_hash`, `zg_storage_tx`, `created_at` | unique (`robot_id`, `invoice_id`); index `episode_id` | one chip-signed QR crop per scan-initiated errand; the JPEG is in R2 under `r2_key` and on 0G Storage once uploaded (`zg_*`, null until then); the evidence JSON carries hash, signature and root, never the image (`APP_SCANS_ENABLED`) |
| `chip_requests` | `id`, `robot_id`, `episode_id`, `kind text NOT NULL`, `payload_json text NOT NULL`, `status text NOT NULL`, `expires_at`, `delivered_at`, `responded_at`, `signature`, `leaf_hash`, `refusal_code`, `created_at` | index `(robot_id, status)`, unique `episode_id` | `kind`: `sign-invoice`; `status`: `queued` `delivered` `signed` `refused` `expired` |
| `relayer_txs` | `key text PK` (`settle:<invoiceHash>` / `revoke:<delegationHash>` / `deploy:<smartAccount>`), `kind`, `nonce integer`, `to_address`, `data_sha256`, `tx_hash`, `status text NOT NULL`, `gas_used`, `error`, `created_at`, `updated_at integer` | unique `nonce` | `pending` `sent` `confirmed` `failed` |
| `used_nonces` | `nonce text PK` (approval nonce or `keccak(jti)`), `kind`, `ref`, `created_at` | none | `kind`: `approval` `jti` |

`relayer_txs` PK insert is the persistent per-invoice guard (a second settle → unique violation → 409). Relayer nonce =
`eth_getTransactionCount(relayer, 'pending')`, inserted before the send; on conflict re-read and retry ≤ 3. The
merchant catalogue is a constant in `packages/server/src/merchant/Catalogue.ts`: `chai` 0.10, `samosa` 0.25, `thali`
2.00 (normal items, merchant payee). The catalogue has **no restricted item**: the approval story is spending limits
only (thali is over the 1.00 per-payment cap; `docs/decisions.md`, Demo story). The `restricted` flag and
`RESTRICTED_PAY_TO` stay as general capability.

## 4. Passkey-only auth (replaces Yielded Auth)

The passkey is both the login and the wallet's signer. Verification uses `@simplewebauthn/server` v14
(`verifyRegistrationResponse`, `verifyAuthenticationResponse`), which runs on Workers. No viem or kit in the browser.

| Route | Request → Response |
| --- | --- |
| `POST /api/passkeys/register/options {displayName}` | `{challenge (base64url 32 B), rp:{id:<host of AUTH_ORIGIN>, name:"Vitaquack"}, user:{id, name}, pubKeyCredParams:[{alg:-7}], authenticatorSelection:{residentKey:"required", userVerification:"required"}}`; challenge stored in `auth_challenges` (5 min) |
| `POST /api/passkeys/register/verify {credentialId, clientDataJSON, attestationObject, publicKeySpki, publicKeyAlgorithm, authenticatorData}` | `verifyRegistrationResponse` (expected challenge, origin = `AUTH_ORIGIN`, rpId, UV required); `alg == -7`; SPKI = 26-byte P-256 prefix ‖ `04` ‖ x ‖ y (91 B) → `x`, `y`; inserts `accounts` + `passkeys`; computes the counterfactual Hybrid address (`deployParams [eoaOwner ?? 0x0, [keyId], [x], [y]]`, `keyId` = credentialId base64url, `deploySalt` = keccak(accountId)); sets the cookie → `{accountId, smartAccount}` |
| `POST /api/passkeys/login/options` | `{challenge, rpId, userVerification:"required"}` (discoverable credential) |
| `POST /api/passkeys/login/verify {credentialId, clientDataJSON, authenticatorData, signature}` | `verifyAuthenticationResponse` (challenge, origin, rpId, UV, counter > stored or both 0); updates `sign_count`, `last_used_at`; sets the cookie → `{accountId, smartAccount}` |
| `GET /api/auth/session` / `POST /api/auth/logout` | `{accountId, displayName, smartAccount}` or 401 / clears the cookie |

Session cookie `vq_session=<base64url payload>.<base64url HMAC-SHA256>`, payload `{accountId, securityRevision, keyId,
iat, exp}` (7 days), key = the active entry of `APP_AUTH_SESSION_KEYS` (the existing keyring JSON); `HttpOnly; Secure;
SameSite=Lax; Path=/`. `requireSession` provides `CurrentSession` and rejects a cookie whose `securityRevision` differs
from `accounts.security_revision`; **logout bumps `security_revision`** (invalidating every session of that account),
so a replayed cookie after logout is 401. Every mutating route under a session requires `Origin == AUTH_ORIGIN` (403
otherwise). `rp.id` and the expected origin are derived from `AUTH_ORIGIN` at runtime. Challenges live in
`auth_challenges`, single-use, 5 min. The passkey is the on-chain signer through Arc's P-256 precompile at `0x100`.

Chain signing with the same credential: `POST /api/wallet/grants/options {robotId, dailyCap, perPaymentCap, allowlist,
expiresAt}` → builds the unsigned grant (§5), stores it `unsigned`, returns `{grantId, challenge = delegationDigest
bytes}`. **The challenge is the EIP-712 typed-data digest** `keccak256(0x1901 ‖ domainSeparator(DelegationManager,
5042) ‖ hashDelegation(grant))` (`delegationDigest` in `@ethmumbai/protocol/Delegation`), which `DelegationManager`
passes to `isValidSignature`. `delegation_hash` in D1 stays the struct hash (unique key, `revoke:<delegationHash>`). `POST /api/wallet/grants/:id/sign {credentialId, authenticatorData,
clientDataJSON, signature}` → the server verifies the assertion exactly as a login (challenge = the digest), encodes the
DeleGator signature `abi.encode(bytes32 keyIdHash, uint256 r, uint256 lowS, bytes authData, bool UV, string cdjPrefix,
string cdjSuffix, uint256 typeIdx)` (prefix/suffix split around the base64url challenge; `keyIdHash =
keccak256(utf8(keyId))`), checks it with an `isValidSignature(digest, sig)` `eth_call` on the deployed account, and
marks the grant `active`. Revoke is the same pair under `/api/wallet/grants/:id/revoke/{options,sign}` (the challenge is
the digest of a one-time delegation whose execution is `DelegationManager.disableDelegation(grant)`). The relayer deploys the
account (`relayer_txs` key `deploy:<smartAccount>`, `SimpleFactory` via `getFactoryArgs()`) inside the first grant
`sign` request, before the grant can be redeemed.

Browser: `apps/web/src/Passkey.ts` is a Context.Service over `navigator.credentials` with live and fixture layers;
commands call it, views never do. Tests use Playwright's virtual authenticator.

## 5. Chain: accounts, grants, leaves, hashes (`packages/chain`, `packages/protocol`)

- **Addresses** come from `getSmartAccountsEnvironment(5042)` in `@metamask/smart-accounts-kit` 2.0.0
  (Delegation Framework v1.3.0); never hard-code them. For reference: DelegationManager
  `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`, HybridDeleGator impl `0x48dBe696A4D990079e039489bA2053B36E8FFEC4`,
  SimpleFactory `0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c`, USDC `0x3600000000000000000000000000000000000000`
  (native balance in 18 dp = ERC-20 balance in 6 dp), Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11`,
  ValueLte `0x92Bf12322527cAA612fd31a0e810472BBB106A8F`, ERC20PeriodTransfer `0x474e3Ae7E169e940607cC624Da8A15Eb120139aB`,
  Timestamp `0x1046bb45C8d673d4ea75321280DB34899413c069`, Id `0xC8B5D93463c893401094cc70e66A206fb5987997`,
  ExactExecution `0x146713078D39eCC1F5338309c28405ccf85Abfbb`, Redeemer `0xE144b0b2618071B4E56f746313528a669c7E65c5`,
  Nonce `0xDE4f2FAC4B3D87A1d9953Ca5FC09FCa7F366254f`. `ANY_BENEFICIARY = 0x0000000000000000000000000000000000000a11`,
  `ROOT_AUTHORITY = 0xff…ff`, `ExecutionMode.SingleDefault = 0x00…00`.
- **Owner account:** `toMetaMaskSmartAccount({ client, implementation: Implementation.Hybrid, deployParams:
  [eoaOwner | zeroAddress, [keyId], [x], [y]], deploySalt, signer })`; `getFactoryArgs()` for the deploy. The account
  must be **deployed before any grant is redeemed** (the DM rejects ERC-6492). The optional EOA owner is the passkey
  fallback.
- **Delegation EIP-712:** domain `{name:"DelegationManager", version:"1", chainId:5042, verifyingContract:DM}`; types
  `Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)` and
  `Caveat(address enforcer,bytes terms)`; `args` and `signature` are not hashed. Hash with `hashDelegation` from
  `@metamask/smart-accounts-kit/utils`; encode contexts with `encodeDelegations`/`decodeDelegations`.
- **Grant (root)** = delegation owner → chip, authority `ROOT_AUTHORITY`, **unique salt per grant** (keccak of the grant
  id). Caveats in this order: `ValueLte(uint256 0)` · `ERC20PeriodTransfer(USDC ‖ uint256 dailyCap ‖ uint256 86400 ‖
  uint256 startAt)` · `Timestamp(uint128 0 ‖ uint128 expiresAt)` · `RobotPaymentPolicyEnforcer(abi.encode(uint256
  perPaymentCap, address[] allowlist, address approver))`. No AllowedTargets/AllowedMethods (the period enforcer checks
  token and selector). Owner actions (revoke) are one-time delegations owner → relayer with
  `ExactExecution(DM, 0, disableDelegation(grant))` + `LimitedCalls(1)`.
- **Leaf (chip voucher)** = delegation chip → `ANY_BENEFICIARY`, authority = `hashDelegation(grant)`, salt = keccak of
  the invoice hash, caveats in this order: `ExactExecution(USDC ‖ uint256 0 ‖ transfer(payTo, amount))` (120 B) ·
  `Id(invoiceHash)` (32 B) · `Timestamp(uint128 0 ‖ uint128 expiresAt)` · `Redeemer(relayer)` (20 B). 65-byte `r‖s‖v`
  signature. The chip signs this with `privateKeyToAccount(pk).signTypedData` (viem). ≈ 505k gas to settle.
- **Invoice hash** (`packages/protocol/src/Invoice.ts`, the only implementation): EIP-712 with domain type
  `EIP712Domain(string name,string version,uint256 chainId)` = `{"AgentMerchant","1",5042}` (no verifyingContract),
  struct `Invoice(bytes32 merchantId,bytes16 invoiceId,address payTo,address asset,uint256 amount,uint64 expiresAt,
  bytes32 linesHash,bytes32 rulesHash)`; `merchantId = keccak256(utf8(id))`; `invoiceId` = the first 16 bytes of the
  base32 (`a-z2-7`, lowercase, no padding) decode of the 26-char id; `linesHash`/`rulesHash` = keccak256 of
  sorted-key compact JSON of `lines` / `restrictions`. The Id caveat's term is this digest. Golden fixture: the S2
  spike's invoice (`docs/research/spikes/s2-facilitator-spike.ts.txt` lines 271 to 274).
- **Approval** (`packages/protocol/src/Approval.ts`): EIP-712 domain `{name:"VitaquackApproval", version:"1",
  chainId:5042, verifyingContract: ENFORCER_ADDRESS}`, struct `Approval(bytes32 invoiceHash,address payee,uint256
  amount,uint64 expiry,bytes32 nonce)`; signed by the approver key; travels in the enforcer caveat's `args =
  abi.encode(Approval, bytes signature)` (outside the signed delegation hash, so the server injects them).
- **Redeem call:** `redeemDelegations(bytes[] permissionContexts, bytes32[] modes, bytes[] executionCallDatas)`
  (selector `0xcef6d209`); `permissionContext` = `encodeDelegations([leaf, grantWithArgs])` (leaf first); execution =
  `encodePacked(address USDC, uint256 0, bytes transfer(payTo, amount))`.
- **Gas and RPC rules:** `maxFeePerGas ≥ 20 gwei` or Arc silently drops the tx (use 40 gwei max, 1 gwei priority,
  gas = estimate × 1.2). USDC moves emit both an ERC-20 `Transfer` and an EIP-7708 system log (don't double count).
  The public RPC has no `debug_traceCall`/`eth_simulateV1` and throttles (`-32005`): use `APP_ARC_RPC_URL` (keyed),
  `retryCount 3, retryDelay 500`.
- **Testing without broadcasting** (`packages/chain/test`, tag `live-arc`, skipped without `ARC_RPC_URL`): inject the
  owner's proxy code + storage via `stateOverride` and `eth_call`/`eth_estimateGas` from the relayer; multi-step cases
  put Multicall3's code at the relayer and `aggregate3` the steps (`docs/research/spikes/s2-facilitator-spike.ts.txt`).

## 6. Robot Agent: errand state machine and 0G (`packages/server/src/robot/`)

One `episodes` row per errand. Transitions run inside the triggering HTTP request; `Errands.tick(episode)` applies
timeouts lazily on every read and chip poll (no scheduler).

| State | Leaves via |
| --- | --- |
| `queued` | same request → `deciding`. The invoice: the optional `invoiceId` in the request (must be pending, this merchant, ≥ 60 s from expiry, unclaimed, else 409); otherwise the **counter's open invoice** for the item (newest pending one with ≥ 60 s left that no episode references, or only episodes that ended unpaid **without a chip signature**, since the chip refuses a signed one as `replayed_invoice`); otherwise one minted now. The claim is one conditional UPDATE; a lost race → 409, that episode `failed`. A settled payment marks the episode's approval `consumed`. So the robot pays what the gate (or the ESP32's QR) is showing; restricted items always mint |
| `deciding` | 0G tool result `pay` ∧ ¬approvalRequired → `signing`; `pay` ∧ approvalRequired, or `ask_human` → `awaiting_approval`; `walk_away` → `walked_away`; error / timeout (10 s) / invalid JSON → `safe_stop` |
| `awaiting_approval` | `/api/world/callback` approved → `signing`; denied → `denied`; 300 s → `expired` |
| `signing` | chip response `ok` → `settling`; refused → `refused`; 60 s silent → `expired` |
| `settling` | receipt success → `paid`; verify failure or revert → `failed` |
| terminal: `paid` `walked_away` `safe_stop` `denied` `refused` `failed` `expired` | an `evidence_uploads` row `pending` is inserted on entry |

`approvalRequired = amount > perPaymentCap || !allowlist.includes(payTo)`. **An approval never lifts the daily cap**
(`ERC20PeriodTransfer` counts approved payments too), so `amount > budget.dailyRemaining` → the brain answers
`walk_away` (demo defaults 3.00/day, 1.00 per payment). Restricted items always have an unallowlisted `payTo`, so they
always require approval.

Routes (session cookie + Origin check): `POST /api/robots/:robotId/errands {item}` → 201 `{episodeId, state,
decision:{action, reason, requestId}, approvalUrl?}`; `GET /api/robots/:robotId/errands/:id` → `{episode, decisions[],
chipRequest?, payment?, approval?, evidence?}`; `GET /api/robots/:robotId` → `{robot, lease:{until, online}, grant}`.
Idempotency: unique `chip_requests.episode_id`, `approvals.nonce` and `relayer_txs.key`. The app has no pay-now
button: an errand starts from a scan or an owner intent (§15).

0G call (`packages/chain/src/ZeroG.ts`; `POST ${ZG_BASE_URL}/chat/completions`, `Authorization: Bearer ${ZG_API_KEY}`,
timeout 10 s, `temperature 0`). After a `429` the call is asked once more after 1 s with what is left of the 10 s; a
second `429` is `safe_stop`. The owner picks the brain per message by hand, and there is no automatic fallback. `POST …/errands` and `POST …/intents` take an optional `model`: ZG_MODEL (glm-5.3, its provider in a TEE) or
the allowlisted `qwen3-vl-plus` (no TEE proof, so its decisions read "Not TEE-verifiable"). Any other value is a 400.
The model is stored on the episode and the intent, the scan that claims the intent decides with it, and an absent
`model` means ZG_MODEL:

```json
{"model":"<ZG_MODEL>","messages":[
 {"role":"system","content":"You are the purchasing brain of a robot with a USDC budget. Decide only with the decide tool. Never pay when approvalRequired is true or merchant trust is untrusted. When approvalRequired is true and the owner asked for this item, answer ask_human so the owner can approve it in World App; answer walk_away only when the item is not what the owner asked for, the price is wrong, or the merchant is unknown."},
 {"role":"user","content":"<input JSON>"}],
 "tools":[{"type":"function","function":{"name":"decide","parameters":{"type":"object","required":["action","reason"],
  "properties":{"action":{"type":"string","enum":["pay","ask_human","walk_away"]},"reason":{"type":"string","maxLength":200}}}}}],
 "tool_choice":{"type":"function","function":{"name":"decide"}}}
```

Input JSON: `{"requested","catalogue":{"itemId","name","amount","restricted"},"invoice":{"id","payTo","amount",
"expiresAt"},"budget":{"dailyCap","spentToday","remainingToday","perPaymentCap"},"policy":{"payeeAllowlisted",
"restricted","approvalRequired"},"merchant":{"id","trust":"known"|"untrusted"}}`. Logged per call: `request_id` (body
`x_0g_trace.request_id`), `chat_id` (header `zg-res-key`), provider, model, `latency_ms`, `prompt_sha256`,
`input_json`; never the key. Episode evidence JSON = `{episodeId, robotId, item, decisions[], outcome:{state, txHash?,
approvalId?}, requestIds[]}`; `request_ids_hash = keccak256(requestIds.join(","))`. The uploader (§10,
`tools/evidence-uploader/README.md`) polls `GET /api/evidence/pending` (bearer `APP_EVIDENCE_TOKEN`), uploads the JSON
to 0G Storage (`@0gfoundation/0g-storage-ts-sdk` 1.2.13, Galileo turbo indexer), calls `EpisodeLog.record(string episodeId,
bytes32 rootHash, bytes32 requestIdsHash)` on 0G Chain 16602 (event `EpisodeRecorded(address indexed recorder, bytes32
indexed episodeKey, string episodeId, bytes32 rootHash, bytes32 requestIdsHash, uint64 recordedAt)`, `episodeKey =
keccak256(bytes(episodeId))`, duplicate → `AlreadyRecorded`; the uploader reads `records(episodeKey)` first and never
records twice), then `POST /api/evidence/:id/uploaded {rootHash, storageTx, logTx}`.

**Public proof pages** (no sign-in; `packages/server/src/robot/Proofs.ts`, `packages/protocol/src/Proof.ts`):
`/app/proofs` and `/app/proofs/:episodeId`. `GET /api/proofs` answers newest first, 50 a page,
`?after=<uploadedAt>.<episodeId>` cursor (400 if bad), 15 s public cache. `GET /api/proofs/:episodeId` is 404 until
uploaded, then answers the root, the storage and `EpisodeLog` txs, the `EpisodeLog` contract, the 0G Chain RPC and the
Storage indexer. The page downloads the episode JSON from the indexer by root. "Verify against 0G" runs in the browser:
`eth_call` of `EpisodeLog.records` must show the episode recorded, the same root and a request-ids hash equal to
keccak256 of the downloaded `requestIds`; each frame is re-hashed with SHA-256. Only fields already public on 0G are
shown (the robot id; never its name, the owner, the decision input or World claims).

## 7. Merchant, x402 and the gate (`packages/server/src/merchant/`, `packages/protocol/src/X402.ts`)

- `GET /api/merchants/:id/items` → the catalogue. `POST /api/merchants/:id/invoices {itemId}` → 201 invoice
  `{id (26-char base32), url: "https://<origin>/api/i/<id>", merchantId, payTo, asset, amount, expiresAt (= now + 600),
  linesHash, rulesHash, invoiceHash, restricted}`.
- **Counter screen:** `POST /api/merchants/:id/counter {itemId}` mints exactly as `POST …/invoices` and puts the
  invoice on the counter display (`counter_display`, one row per merchant, replaced by each tap, written only here);
  `GET /api/merchants/:id/counter` → compact
  `{"invoice":{"id","itemId","name","amount","expiresAt","status"}}`, or `{"invoice":null}` when nothing is displayed,
  it is not `pending`, or it has under 60 s left; `GET …/counter/latest` is the till's read of the same invoice in any
  status. No session, no Origin. Displaying never claims. The till (`apps/merchant`) puts it up; the ESP32 pulls it
  (`docs/hardware-handoff.md` §6).
- `GET /api/i/:id` unpaid → **402**, header `PAYMENT-REQUIRED: <base64 of the body>`, body:

```json
{"x402Version":2,"error":"payment-required",
 "resource":{"url":"https://<origin>/api/i/<id>","description":"Chai","mimeType":"application/json"},
 "accepts":[{"scheme":"exact","network":"eip155:5042","asset":"0x3600000000000000000000000000000000000000",
   "payTo":"0x<merchant>","amount":"100000","maxTimeoutSeconds":120,
   "extra":{"assetTransferMethod":"erc7710","invoiceHash":"0x…","invoiceId":"<26>","expiresAt":1762000000,
     "delegationManager":"0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3","facilitators":["0x<relayer>"],"paymentIdentifier":"<26>"}}]}
```

- `POST /api/invoices/:id/pay` body `{"paymentPayload":{"x402Version":2,"accepted":<accepts[0]>,"payload":
  {"delegationManager":"0x…","permissionContext":"0x<encodeDelegations([leaf, grantWithArgs])>","delegator":"0x<owner
  smart account>"}}}` → facilitator `verify` then `settle` → 200 `{"success":true,"transaction":"0x…","network":
  "eip155:5042","payer":"0x…","invoiceId","status":"paid"}` + header `PAYMENT-RESPONSE: <base64>`; 400
  `{"success":false,"errorReason":"<check or revert reason>","checks":[{"name","ok","detail"}]}`; 409 already settled.
  The `PAYMENT-SIGNATURE` header (a ≈ 12.7 KB context, too big for Cloudflare) is answered 415
  `use POST /api/invoices/:id/pay`. Paid `GET /api/i/:id` → 200 `{invoiceId, status, item, amount, payTo,
  txHash}`.
- Facilitator `verify`: DelegationManager allowlisted; decode the context; leaf → grant chain
  links (`authority`, `delegator`/`delegate`); the leaf's ExactExecution equals the requirements (asset, payTo,
  amount); Id term = `invoiceHash`; both Timestamp bounds; grant not expired; the Redeemer term decoded as 20-byte
  chunks and containing the relayer; off-chain ECDSA recovery of the chip's leaf signature; **always simulate from the
  relayer** (`eth_estimateGas`); persistent guard = `relayer_txs` key `settle:<invoiceHash>`. `settle`: serialised
  nonce, send, `waitForTransactionReceipt`, mark `payments.settled` and `invoices.paid` with the tx hash. Revert
  reasons are decoded with `decodeRevertData` and returned verbatim (`IdEnforcer:id-already-used`,
  `CannotUseADisabledDelegation`, `ERC20PeriodTransferEnforcer:transfer-amount-exceeded`, `RPP:approval-required`).
- **Gate status:** `GET /api/invoices/:id/status?nonce=<≤ 32 chars>` → `{"invoiceId","status","nonce","expiresAt",
  "sig"}`, `sig` = base64 Ed25519 over UTF-8 `<invoiceId>|<status>|<nonce>|<expiresAt>`; the first read of `paid`
  flips the invoice to `used`; `GET /api/merchants/:id/gate-key` → `{"alg":"ed25519","publicKey":"<base64>"}`. The
  virtual gate page `/app/gate/:merchantId` creates an invoice, shows its id and QR URL, polls the status every second with
  a fresh nonce, verifies the signature (WebCrypto Ed25519) and shows OPEN on `paid`, then requests a fresh invoice.

## 8. Chip protocol and the mock chip (`packages/server/src/chip/`, `packages/protocol/src/Chip.ts`, `apps/chip`)

| Message | Shape |
| --- | --- |
| `POST /api/chips/pair` | `{"pairingCode":"K7Q2M9XZ","address":"0x…","sig":"0x…"}`; `sig` = EIP-191 `personal_sign` of `Vitaquack pair <code> <address lowercase> 5042`; code = 8 chars of `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, 10 min, single use → 200 `{"robotId","chipToken":"<base64url 32 B>","serverTime"}`; 404 unknown/expired; 409 already paired |
| `GET /api/chips/:robotId/poll` (`Authorization: Bearer <chipToken>`) | returns on a queued request or after 25 s: `{"serverTime":<ms>,"lease":{"until":<ms>},"requests":[SignRequest]}`; 401 bad token |
| SignRequest | `{"id","kind":"sign-invoice","expiresAt","invoice":{"id","url","merchantId","payTo","asset","amount","expiresAt","linesHash","rulesHash","invoiceHash","restricted"},"grant":{"delegation":{"delegate","delegator","authority","caveats":[{"enforcer","terms","args"}],"salt":"<decimal>","signature"},"dailyCap","perPaymentCap","allowlist":[],"expiresAt"},"approval":null|{"invoiceHash","payee","amount","expiry","nonce","signature"},"leaf":{"delegate":"0x…0a11","delegator":"<chip>","authority":"<grant hash>","caveats":[ExactExecution,Id,Timestamp,Redeemer],"salt":"<decimal>"},"chainId":5042,"delegationManager":"0x…"}` |
| `POST /api/chips/:robotId/responses` | `{"requestId","ok":true,"signature":"0x…","leafHash":"0x…"}` or `{"requestId","ok":false,"refused":{"code","detail"}}` → 200 `{"accepted":true,"payment":{"status":"settled"|"failed","txHash"?,"reason"?}}`; 409 if the request is not `delivered` |

Chip policy before the key is touched, in order: network is `eip155:5042`; asset is USDC; `0 < amount ≤
min(perPaymentCap, dailyCap − spentToday)` unless a valid `approval` for this invoice is attached; `payTo` on the
allowlist unless approved; `invoice.url == ${allowedOrigin}/api/i/${id}`; `now < expiresAt ≤ now + 900`; the invoice
hash is not in the used list; the `leaf` caveats equal the ones the chip re-derives from the invoice. Then sign EIP-712
`Delegation`, persist the invoice hash and the spend, respond. Refusal codes: `wrong_network` `wrong_asset`
`over_per_payment_cap` `over_daily_cap` `payee_not_allowed` `bad_invoice_origin` `invoice_expired` `expiry_too_far`
`replayed_invoice` `leaf_mismatch` `no_grant` `no_lease`.

Lease: `until = serverTime + 35 000 ms`; the chip re-polls immediately after each response; when `now > until` it logs
`STOP motors (lease expired)`, answers every request `no_lease`, and resumes on the next successful poll. The server
stores `last_poll_at` and `lease_until`; `online = now < lease_until`.

Mock chip: `bun apps/chip/src/main.ts --server <URL> [--pair CODE] [--state ~/.vitaquack-chip]`; state files
(`key.json` mode 600, `pairing.json`, `used-invoices.json`, `spent.json`) and log lines are in `apps/chip/README.md`.
Never logs the key or a signature.

**Hardware seam:** the Radxa runs the same `apps/chip` code; the ESP32 uses the merchant API and verifies `sig` with
Monocypher `crypto_ed25519_check` against `gate-key` (`docs/hardware-handoff.md`). Nothing in the Worker changes for
hardware.

## 9. World approval (`packages/server/src/world/`)

1. `POST /api/approvals {episodeId}` (or created by the errand) → `approvals` row: `nonce` = EIP-712 hash of
   `{invoiceHash, amount, payee, expiry}` (the `Approval` struct with the hash as nonce), `oidc_state` random,
   `status = requested`; the console shows `/app/wallet/approvals/:id` with item, amount, payee, invoice and the button.
2. `GET /api/world/authorize?approval=:id` → 302 to `${WORLD_ISSUER}/authorize?response_type=code&client_id=…&redirect_uri=
   ${AUTH_ORIGIN}/api/world/callback&scope=openid&state=<oidc_state>&nonce=<nonce hex>&max_age=0&prompt=login
   &code_challenge=<S256 of a fresh verifier>&code_challenge_method=S256`; `status = opened`.
3. `GET /api/world/callback?code&state` → token exchange (`client_secret_basic` + `code_verifier`) → verify the RS256
   ID token against the JWKS (cached 1 h): `iss`, `aud`, `exp`, `nonce == approvals.oidc_nonce`, `auth_time ≥ opened_at
   − 60`, `acr` is `…/acr/orb` or `…/acr/orb-face` (`amr` is recorded in `amr_json`, not judged), `jti` unused (`used_nonces`), `sub` ==
   `accounts.world_sub` (set on the first approval). On success: approver signs `Approval`, `status = approved`, the
   errand continues to `signing` with the approval attached to the chip request. `error=access_denied` or any failure
   → `status = denied` (reason stored), errand → `denied`. Replayed `state`/`code` → 409.
4. 300 s without a callback → `expired`. Nothing is signed without a token, so a denied or expired approval cannot pay.

The backend sees the World token and is a trusted approver; the on-chain verifier
(`docs/research/spikes/s5b-jwt-verifier.sol.txt`) is the §13 stretch that removes that trust.

## 10. Secrets and config

| Name | Set in | Used by |
| --- | --- | --- |
| `APP_AUTH_SESSION_KEYS` (kept) | `alchemy.run.ts` `Config.Redacted` → `AUTH_SESSION_KEYS`; `check.yml`; `.env.main.local`; native test | `packages/auth/src/Session.ts`. `APP_AUTH_SECRET` is removed |
| `APP_RELAYER_PRIVATE_KEY` | same pattern → `RELAYER_PRIVATE_KEY` | `chain/Relayer.ts`: settle, revoke, account deploy; `scripts/smoke.ts` |
| `APP_APPROVER_PRIVATE_KEY` | → `APPROVER_PRIVATE_KEY` | `chain/Approver.ts`; its address is the enforcer's `approver` term |
| `APP_GATE_ED25519_SEED` (32-byte hex; pkcs8 = `302e020100300506032b657004220420` ‖ seed) | → `GATE_ED25519_SEED` | `merchant/Status.ts`, `merchant/GateKey.ts` |
| `APP_ARC_RPC_URL` (keyed) | → `ARC_RPC_URL` | `chain/Arc.ts` |
| `APP_ZG_API_KEY` / `APP_ZG_BASE_URL` / `APP_ZG_MODEL` | → `ZG_*` | `chain/ZeroG.ts` |
| `APP_WORLD_CLIENT_ID` / `APP_WORLD_CLIENT_SECRET` / `APP_WORLD_ISSUER` (`https://auth.world.org`) | → `WORLD_*` | `world/*` |
| `APP_ENFORCER_ADDRESS` / `APP_EPISODE_LOG_ADDRESS` / `APP_EVIDENCE_TOKEN` | plain env strings (the token redacted) | `chain/Grant.ts`, `robot/Evidence.ts`, `/api/evidence/*` bearer |
| `APP_ZG_STORAGE_PRIVATE_KEY`, `ZG_STORAGE_INDEXER` (`https://indexer-storage-testnet-turbo.0g.ai`), `ZG_CHAIN_RPC` (`https://evmrpc-testnet.0g.ai`, 16602), `EPISODE_LOG_ADDRESS`, `EVIDENCE_SERVER_URL`, `EVIDENCE_TOKEN` | netcup, in the repo's `.env.main.local` (then the process environment), never the Worker | `tools/evidence-uploader/main.ts` |

Only `AUTH_SESSION_KEYS` and `AUTH_ORIGIN` are decoded fatally in `onFirstUse`. **Every feature secret is decoded
optionally** (missing or schema-invalid → absent, with a logged warning) and the feature's routes answer 503
`{error:"not configured: <name>"}` until it is set, so a placeholder never turns every `/api` request into a 500.
Check `/api/health` after every deploy. Adding a secret = `alchemy.run.ts` + `check.yml` + `.env.main.local` + the
native test bind + the Schema decode **+ `gh secret set` on the repo** (the deploy job fails without it). An unknown
value is set as `pending`. Relayer, approver and gate keys are fresh (never reused) and live as GitHub secrets.

## 11. Mainnet smoke runbook and evidence

1. Fund ≥ 5 USDC to the relayer EOA on Arc; `cast balance --rpc-url $APP_ARC_RPC_URL <relayer>`.
2. `cd contracts && forge test` (50 tests), then deploy (the scripts read `DEPLOYER_PRIVATE_KEY` and refuse any other
   chain): `DEPLOYER_PRIVATE_KEY="$APP_RELAYER_PRIVATE_KEY" forge script script/DeployArc.s.sol --rpc-url
   "$APP_ARC_RPC_URL" --broadcast --with-gas-price 40gwei --priority-gas-price 1gwei` → `ENFORCER_ADDRESS` (≈ 1.3M
   gas, ≤ 0.052 USDC); `DEPLOYER_PRIVATE_KEY="$APP_ZG_STORAGE_PRIVATE_KEY" forge script script/DeployZg.s.sol
   --rpc-url https://evmrpc-testnet.0g.ai --broadcast` → `EPISODE_LOG_ADDRESS` (≈ 0.35M gas). Details:
   `contracts/README.md`.
3. `heavy --wait bun packages/chain/scripts/smoke.ts --amount 0.01` → deploy tx, settle tx, replay revert, revoke tx,
   post-revoke revert.
4. `heavy --wait bun run check`; `APP_RELEASE="$(git rev-parse HEAD)" heavy --wait bunx alchemy deploy --stage main
   --env-file .env.main.local --no-input --yes`; `curl $URL/api/health`.
5. `$URL/app` → "Create passkey wallet" (phone passkey) → the counterfactual address; send 2 USDC to it.
6. `/app/wallet/robots` → "Add a robot" → pairing code; `bun apps/chip/src/main.ts --server $URL --pair <CODE>`; grant daily
   1.00 / per-payment 0.30 / allowlist `[merchant payTo]` / 24 h → the passkey signs (deploy tx, grant active).
7. `/app/robot/<id>` → "Get me a chai" (the duck or the mock chip scans the gate's QR) → `paid`; note `request_id`,
   invoice id, tx; `GET $URL/api/invoices/<id>/status?nonce=1` → `paid`, again → `used`; `/app/gate/duck-cafe` shows
   OPEN.
8. "Get me a thali" (over the per-payment cap) → `awaiting_approval` → `/app/wallet/approvals/<id>` → "Approve with
   World" → **deny** → `denied`, no tx; repeat → **approve** → `paid`.
9. Revoke on `/app/wallet/robots` → "Get me a chai" → `failed` (`CannotUseADisabledDelegation`).
10. The uploader service (or `heavy --wait bun tools/evidence-uploader/main.ts --once`) → root hashes +
    `EpisodeLog.record` txs; `curl -s $URL/api/evidence/<episodeId>`; the episode appears on `$URL/app/proofs`.
11. Write `docs/evidence/<date>-<run>.md`.

Evidence file (indexed by `docs/evidence/README.md`): a header block with commit, deployed URL, `ENFORCER_ADDRESS`,
`EPISODE_LOG_ADDRESS`, relayer and approver addresses, owner smart account, chip address; then one table per run:
`step | time (IST) | actor | invoiceId | invoiceHash | arc tx (https://explorer.arc.io/tx/<hash>) | result/revert |
0G request_id | chat_id | rootHash (storagescan-galileo.0g.ai) | EpisodeLog tx (chainscan-galileo.0g.ai)`. Never paste
tokens, keys, signatures or World ID tokens.

## 12. Submission checklist (Sat 09:00 IST; aim for 08:00)

- ETHGlobal: name and description; public GitHub with real history; a README section on **code that predates the
  event** (the `styld.app` foundation, commit `370a0e23`, one import commit on 5 Nov); demo video 2 to 4 min, ≥ 720p,
  real narration (no AI voice, not sped up, not filmed on a phone), ≤ 4 bullets per slide; up to 3 partner prizes (Arc,
  0G, World), each with how we integrated it and feedback.
- Arc (Advanced Stablecoin Logic): the shareable Studio URL; Studio shown in the demo; working frontend and backend; an
  architecture diagram (the site page); the video with the Arc/Circle tools used; name the bounty.
- 0G (Physical AI): a 0G call in the decision loop; an episode log on 0G Storage with a request id per decision; a live
  demo or a replayable run; a safe-stop; **contract deployment addresses**; README setup steps; video under 3 minutes
  (2:30 to 2:59 satisfies both).
- World (Agent Pass): the official Agent Pass; the full journey including a deny / expired path; validation in the
  backend; a debrief (time to first success, friction, one top improvement).

## 13. Stretch (only after §0's "done" is recorded)

On-chain Agent Pass verification (S5b prototype) · a vision decision · the real duck walking · a read-only MCP server
over the wallet · the float path replaced by a policy-bound escrow · CCTP funding · ENS names · MPP.

Built since: camera frames to 0G Storage as evidence (rule 4) and the sim duck walking on 0G navigation turns (§15).

## 14. Telegram notifications

The bot `@vitaquack_bot` tells the owner, without the wallet page open, that the robot wants an approval, paid, was
refused, or lost its allowance. Telegram informs and **may deny, never approve** (`docs/decisions.md`, Telegram): a
**Deny** button under the approval message denies that approval only when the chat is linked to the approval's account
and the approval is still waiting (the same `denyApproval` path the approval page uses; nothing is signed). Approving
stays World ID gated on `/app/wallet/approvals/:id`, the Arc enforcer is unchanged, and the chip never sees the token.

**One-time World link.** Once the account has a bound `world_sub` (from an earlier approval), the `approval_needed`
message also carries **Approve with World ID**. Each render mints a fresh single-use link
`/api/world/link?approval=<id>&t=<24 random bytes, base64url>`; only the token's sha256 is stored (`auth_challenges`
kind `world_link`, ref = the approval). The link works for that one approval, expires when the approval closes
(300 s), is spent atomically on first use, checks the approval belongs to the token's account and that `world_sub` is
still set, then sends the session route's World redirect. It **stands in for the passkey session only**; §9's fresh
World sign-in is still required. Without a bound World account, for a used, late, foreign or forged link, or with the
rehearsal stub World, the button falls back to the approval page and its passkey sign-in. A link attempt ends on a
no-session result page (approved / not approved / expired). Native acceptance covers minting, the button, single use
and the fallbacks against the stub World; the real World IdP path is **untested** until run on the deployed app.

- **Link.** The wallet's avatar sheet has **Connect Telegram**: `POST /api/telegram/link` (session, same origin) answers a
  single-use code (10 min) and the page opens `https://t.me/vitaquack_bot?start=<code>`. Telegram calls
  `POST /api/telegram/webhook`, verified by the `X-Telegram-Bot-Api-Secret-Token` header against
  `TELEGRAM_WEBHOOK_SECRET`. `/start <code>` consumes the code and stores `telegram_links {account_id, chat_id,
  linked_at}`, `/stop` unlinks, anything else gets a short help reply. The webhook is set by hand after a deploy
  (`docs/DEPLOYMENT.md`, Telegram). No chat id is ever hard-coded.
- **Events.** Each is a row in a D1 `notifications` outbox `{id, account_id, kind, payload_json, status, attempts,
  created_at}`, unique per `(kind, subject id)` so an event is delivered once. Delivery runs in `ctx.waitUntil` after
  the triggering request; undelivered rows are retried at the next enqueue. **A notification failure never fails or delays a payment or an approval.**
  1. `approval_needed` (where the approval row is written): "🦆 I want to buy Thali, 2.00 USDC at Duck Café. That's
     over your 1.00 per-payment limit." with an inline URL button **Review and approve** → the approval page.
  2. `payment_settled`: "✅ Paid 0.10 USDC for Chai at Duck Café" with **View on Arc** → `explorer.arc.io/tx/<hash>`.
  3. `approval_denied` / `approval_expired`: "⛔ Okay, I didn't buy the Thali."
  4. `grant_revoked`; `budget_low` (under 20 % of the daily cap left) is nice-to-have.
- **Secrets** (§10 pattern): `APP_TELEGRAM_BOT_TOKEN` → `TELEGRAM_BOT_TOKEN`, `APP_TELEGRAM_WEBHOOK_SECRET` →
  `TELEGRAM_WEBHOOK_SECRET`, decoded optionally (§10). Messages carry amounts, item names and links only.
- **Paths.** `packages/server/src/telegram/**` and one enqueue call at each event's writer (`world/Approve.ts`, whose
  approval insert checks `changes` so a skipped insert never answers an approval URL; the settlement path in `robot/`;
  the revoke path).
- **Tests.** Webhook secret check (403), link code single-use and expiry, outbox dedup, and the payment path still
  succeeding when Telegram answers 500 (mocked). Live: link Kris's chat, buy chai → the paid message, buy thali → the
  approval message with a working button.

## 15. Simulator robot

A robot is either `kind = chip` (hardware or the CLI mock chip, §8) or `kind = sim`: a duck in a browser physics sim at
`/sim/?robot=<id>#pair=<CODE>` (`apps/sim`, served from the Edge Worker's assets on the same origin). The sim duck gets
the same wallet, allowance, merchant, 0G `decide`, chip signature, Arc settlement, gate and evidence as the real one
(`docs/spikes/sim-results.md`).

- **Body.** `apps/sim` vendors Pollen's Apache-2.0 Microduck sandbox (MuJoCo WASM + the ONNX walking policy at 50 Hz),
  a stand-in for our Open Duck Mini. Meshes, GLB and policies (CC BY-NC-SA / model licence) are fetched at runtime,
  never committed. Three Duck Café stalls (chai, samosa, thali) each show a `vq1:<invoiceId>`
  QR of an invoice the sim minted through the public merchant API; a stall's gate opens on the signed `paid` status.
- **Software chip (deviation from §8's hardware seam).** The sim's chip runs in the browser (`apps/sim/src/chip`, on
  the shared `apps/chip/src/client.ts`, the unchanged `policy.ts` and `signer.ts`), with its secp256k1 key in IndexedDB.
  It pairs with the Add-robot code, long-polls and signs every payment and scan. The Worker still never holds a robot
  key.
- **Errand intents.** `POST /api/robots/:robotId/intents {instruction ≤ 200, item?}` (owner) creates the one open
  intent per robot (`intents` table; 409 while one is open; lazy expiry after 10 min without a turn). The dock's Get
  me pills, typed text and Vita's voice use `createIntent` (`robot/Intents.ts`). The voice
  (`POST /api/robots/:robotId/voice`, no flag, needs only the `APP_ZG_*` bindings) turns a held clip into an intent and
  never decides; its rules are the Vita's voice row in `docs/decisions.md`. A scan by that robot claims the running intent
  before `decide`, which receives `owner: {instruction, item?}` and `requested = owner.item ?? item` and walks away
  when the invoice is not what the owner asked for. Without an intent a scan behaves as in §6. Decisions store the
  instruction only as its hash.
- **0G navigation.** For a sim robot the intent is also the navigation session. `POST /api/chips/:robotId/intents/:id
  /turn {results, scene}` (chip token) stores the sim's tool results, rebuilds the prompt from D1, calls the intent's
  brain (§6; `reasoning_effort: "low"`, `tool_choice: "required"`, 12 s, one retry on 429), stores the turn
  (`nav_turns`: ids, calls, short reasoning, TEE proof) and returns the next calls: `go_to(place)`, `look()`, `scan_qr()`, `say(text)`,
  `wait(s)`, `finish(summary)`. Results of `scan_qr` and `wait` are written by the Worker from the real errand, never by
  the sim. `look()` is text from sim state, never pixels; the only images leaving the sim are the scan's chip-signed
  QR crop and the live frames (rule 4). A 0G failure stops the intent ("0G brain busy/offline"), never a scripted
  fallback. At most 2 nav turns are in flight globally and `decide` never waits for them. The episode evidence carries `navigation:
  {instructionSha256, turns}` (optional key).
