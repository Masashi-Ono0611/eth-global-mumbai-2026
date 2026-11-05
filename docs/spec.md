# Vitaquack implementation spec

**This file is the build order.** Where it disagrees with any other document in this repo, this file wins; where it is
silent, `docs/decisions.md` wins, then `docs/plan.md`. Everything else under `docs/` is research, evidence or history.
Written Fri 6 Nov 2026 ≈ 07:00 IST. **Submission deadline: Sat 7 Nov 09:00 IST** (no late entries).

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
4. **No camera frames leave the chip.** The 0G decision is over structured input. Vision is out of scope.
5. **Restricted items need a human approval, never an "age check".** Say "approval for a restricted item".
6. **No keys, tokens, signatures' private inputs, World ID tokens or prompts in logs, commits or tool output.**
7. **Foundation rules apply** (`AGENTS.md`): Effect 4, Foldkit, Alchemy, gates. Commit per milestone with
   `git commit -- <paths>`. `heavy --wait bun run check` before every push. Record deviations here, not in your head.
8. **Report evidence, not status.** A milestone is done when its acceptance command passes and the output is in the
   report (and, for chain work, in `docs/evidence/`).

Done = the virtual loop runs **on Arc mainnet with real broadcasts** against the deployed app: passkey signup → grant to
a mock chip → "buy chai" (0G decides, chip signs, facilitator settles, gate shows OPEN) → "buy cigarettes" (World deny:
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
| **Contracts** | `contracts/` (Foundry; authored in Arc Studio for the prize; deployed by us) | `RobotPaymentPolicyEnforcer` on Arc, `EpisodeLog` on 0G Chain |

Deviation from `AGENTS.md`'s "Domain aggregates on Durable Objects own live coordination": for the event, live
coordination (errands, chip requests, invoices) is Effect services + D1 with HTTPS long-polling. Reason: 28 hours and
unproven DO wiring in this foundation. **Keep `packages/domain` and `DomainLive` wired exactly as they are** (empty
model): removing them broke the Worker types on 5 Nov (`RuntimeContext`, `FileSystem | Etag.Generator | HttpPlatform
| Path` went missing). Nobody deletes them during the event.

## 2. Milestones

Lanes: **Lead** (chain, contracts, facilitator), **Wallet** (auth, pages, World), **M+R** (merchant, chip, robot
agent, uploader). Critical path **M0 → M1 → M2 → M5 → M7**. M0a runs in parallel with M0. M3/M4 need only M0's
schemas. M6 needs M2's approver.

| M | Goal | Files (`+` create / `~` change / `-` delete) | Acceptance | h | Lane |
| --- | --- | --- | --- | --- | --- |
| **M0** | Protocol + chain packages, deps, golden fixtures | `+packages/protocol/{package.json,src/{index,Invoice,Chip,X402,Approval,Errand,Base32}.ts,test/*.test.ts,test/fixtures/*.json}` (`@ethmumbai/protocol`, dep `effect` only, browser-safe). `+packages/chain/{package.json,src/{index,Arc,Env,Owner,Grant,Leaf,Hashes,DeleGatorSignature,Facilitator,Relayer,Approver,ZeroG}.ts,test/*.test.ts}` (`@ethmumbai/chain`: `effect`, `viem@2.57.16`, `@metamask/smart-accounts-kit@2.0.0`, `@ethmumbai/protocol`; server-only). `~package.json` (catalog pins), `~tools/quality/graph.ts` (`web += protocol`; `server += protocol, chain`; `chain: [protocol]`; `protocol: []`; `assertBrowserSafe` adds `/^(viem\|@metamask\/)/` and `/^packages\/chain\//`), `~knip.config.ts` (add `protocol`, `chain`), `~tsconfig.json`; `bun install` | `bun run test:unit` green with fixtures: `invoiceHash` of the S2 spike invoice; 26-char base32 ↔ `invoiceId` round trip; `hashDelegation(leaf)` equals the kit's; DeleGator signature encoding vector; `Approval` EIP-712 vector. `bun run graph:check` green | 2 | Lead |
| **M0a** | Passkey-only auth (§4) | `-packages/auth/src/{config,live,storage,AttemptLimiter}.ts`, `+packages/auth/src/{Session,Passkey,Spki,Challenge}.ts`, `~packages/auth/src/{client,index}.ts` (browser `Passkeys` service over `navigator.credentials`); `-packages/server/src/{AuthHttp,AuthConfiguration}.ts`, `+packages/server/src/auth/{Routes,Session,Origin}.ts`; `-packages/server/test/{AuthHttp.test,IdentityFixture,IdentityBrowserAcceptance,AttemptLimiterFixture}.ts`, `+packages/server/test/{PasskeyFixture,PasskeyBrowserAcceptance}.ts`; `~package.json` (remove `@yielded/*`; add `@simplewebauthn/server@^14`, `@simplewebauthn/browser@^14`); `~drizzle.config.ts` (schema = `packages/db/src/schema.ts` only); the `accounts`/`passkeys`/`auth_challenges` tables go into Lead's migration (hand Lead the drizzle definitions). **i18n:** keep all five catalogs and the selector (Kris asked for ja/hi/mr on 5 Nov; nothing is deleted); every new key goes into `en` **and** the other four catalogs (write the translations; `bun run i18n:check` must stay green) | unit: register/login verify with `@simplewebauthn/server` against a software authenticator fixture; bad origin, bad rpId hash, UV unset, stale counter, replayed challenge all rejected; SPKI → x,y vector. Native: register → cookie → `GET /api/auth/session` 200; mutating POST without `Origin` → 403; `bun run i18n:check` green | 4 | Wallet |
| **M1** | Contracts + deploy | `+contracts/{foundry.toml,src/{RobotPaymentPolicyEnforcer,EpisodeLog}.sol,test/{RobotPaymentPolicyEnforcer,EpisodeLog}.t.sol,script/{DeployArc,DeployZg}.s.sol,README.md}` (Studio URL in README), `+docs/evidence/contracts.md` | `forge test` green: under-cap allowlisted ok; over-cap without approval reverts `RPP:approval-required`; off-list without approval reverts; valid approval ok; wrong payee, wrong amount, expired, reused nonce, wrong signer revert. `forge script script/DeployArc.s.sol --rpc-url $APP_ARC_RPC_URL --broadcast` prints `ENFORCER_ADDRESS`; `DeployZg` on Galileo prints `EPISODE_LOG_ADDRESS` | 4 | Lead |
| **M2** | Facilitator + relayer + first real payment | `~packages/chain/src/{Facilitator,Relayer}.ts` (port of `docs/research/spikes/s2-facilitator-spike.ts.txt` with the fixes in §6), `+packages/chain/scripts/smoke.ts`; `~packages/db/src/schema.ts` (all tables of §3), `+packages/db/migrations/*` (`bunx drizzle-kit generate --name vitaquack`); `~packages/server/test/Runtime.native.test.ts` (table list, secret binds); `~alchemy.run.ts`, `~.github/workflows/check.yml`, `~.env.main.local` (§9) | `heavy --wait bun packages/chain/scripts/smoke.ts --amount 0.01` on Arc mainnet exits 0 and prints: deploy tx, settle tx (receipt success), replay → `IdEnforcer:id-already-used`, revoke tx, next settle → `CannotUseADisabledDelegation`. Hashes in `docs/evidence/2026-11-06-smoke.md` | 3 | Lead |
| **M3** | Merchant | `+packages/server/src/merchant/{Catalogue,Invoices,X402,Status,GateKey}.ts`, `~packages/server/src/ApiWorker.ts` (merge `merchantRoutes`); `+apps/web/src/pages/{Merchant,Gate}.ts`, `~apps/web/src/{route,model,message,update,View,command}.ts`; keys in `packages/i18n/catalogs/en.json` + `bun run i18n:generate` | Native: `POST /api/merchants/duck-cafe/invoices {itemId:"chai"}` → 201; `GET /api/i/:id` → 402 (§7) with `PAYMENT-REQUIRED`; `GET /api/invoices/:id/status?nonce=abc` → signed `pending`; with a forced `paid` row: first read `paid`, second `used`; scene: `/gate/duck-cafe` renders CLOSED | 3 | M+R |
| **M4** | Chip protocol + mock chip | `+packages/server/src/chip/{Pairing,Poll,Responses,Lease}.ts`; `+apps/chip/{package.json,src/{main,policy,state,signer}.ts,test/policy.test.ts}` | Native: pair → empty poll returns ≤ 25 s with a lease → a queued request is delivered → response accepted; bad token 401; reused code 409. `bun apps/chip/src/main.ts --server http://127.0.0.1:8787 --pair CODE` logs `paired`, `lease ok`, `signed <invoiceId>`; with the network cut it logs `STOP motors (lease expired)` within 35 s. Unit: every refusal code of §5 | 3 | M+R |
| **M5** | Robot Agent + uploader | `+packages/server/src/robot/{routes,Errands,Decide,ZeroGClient,Evidence}.ts`; `+tools/evidence-uploader/{main.ts,README.md}` (`~knip.config.ts` root entry `tools/evidence-uploader/main.ts!`; root devDeps `@0gfoundation/0g-storage-ts-sdk@1.2.13`, `ethers@6.13.1`) | Native with a stub 0G server: `POST /api/robots/:id/errands {item:"chai"}` → `signing` + one `decisions` row with `request_id`; stub timeout → `safe_stop`, no `chip_requests` row. Live: `heavy --wait bun tools/evidence-uploader/main.ts --once` prints `rootHash`, the storage tx and the `EpisodeLog.record` tx; `GET /api/evidence/:id` shows them | 5 | M+R |
| **M6** | World approval | `+packages/server/src/world/{Authorize,Callback,Verify,Approve}.ts`; `+apps/web/src/pages/Approval.ts` | Live with Kris's Orb ID: approve → `approvals.approved` with a signature, errand `signing` → `paid`; deny → `denied`, no tx; replayed `code` 409; unit: a token whose `amr` contains `mfa` is rejected | 3 | Wallet |
| **M7** | Wallet pages, console, polish, evidence | `+apps/web/src/pages/{Home,Wallet,Robots,RobotConsole}.ts` (`/` = passkey signup/login), `+apps/web/src/Passkey.ts`, `-apps/web/src/{PasswordForm,ViewAccount}.ts`, `~apps/web/src/entry.ts` (provide `passkeysLayer(navigator)`), `~apps/web/test/app.scene.test.ts`; `+packages/server/src/wallet/{Signup,Grants,Revoke,Activity}.ts`; `+docs/evidence/{README,demo-run}.md`, `~README.md` | Scene tests per page; Playwright's virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator`) proves signup → counterfactual address shown → grant signed → revoke; deployed: the full loop recorded in `docs/evidence/demo-run.md` | 6 | Wallet (+all) |

Owner's prerequisites (Kris, in parallel with M0; they block M2/M5/M6): ≥ 5 USDC to the relayer EOA and 2 USDC to a
demo owner on Arc; a keyed Arc RPC URL; the 0G API key, base URL and model; 0G Galileo gas for the storage signer; a
World IdP client (redirect URI = the deployed app URL); an Arc Studio project and its URL.

## 3. D1 tables (`packages/db/src/schema.ts`, drizzle `sqliteTable`, snake_case)

Conventions: `id text PK` = 26-char base32 unless noted; `created_at integer (timestamp_ms) NOT NULL`; uint256 and USDC
amounts as decimal `text`; addresses checksummed `text`; hashes `0x` hex `text`; other `*_at integer` are unix seconds.
No `Date` or `crypto.randomUUID` in server code (Effect diagnostics): use `Clock` and `Random`.

| Table | Columns | Keys | States |
| --- | --- | --- | --- |
| `accounts` | `id`, `display_name text NOT NULL`, `security_revision text NOT NULL`, `smart_account text NOT NULL`, `deploy_salt text NOT NULL`, `eoa_owner text`, `deploy_status text NOT NULL`, `deploy_tx text`, `world_sub text`, `created_at` | unique `smart_account` | `deploy_status`: `counterfactual` `deploying` `deployed` `failed` |
| `passkeys` | `credential_id text PK` (base64url), `account_id text NOT NULL`, `alg integer NOT NULL`, `spki text NOT NULL` (base64), `x text NOT NULL`, `y text NOT NULL`, `sign_count integer NOT NULL`, `created_at`, `last_used_at integer` | index `account_id` | — |
| `auth_challenges` | `id text PK` (= challenge base64url), `kind text NOT NULL`, `account_id text`, `ref text`, `expires_at integer`, `used integer(boolean)`, `created_at` | index `expires_at` | `kind`: `register` `login` `grant` `revoke` |
| `robots` | `id`, `account_id`, `name`, `pairing_code text`, `pairing_expires_at integer`, `chip_address text`, `chip_token_hash text`, `paired_at integer`, `last_poll_at integer`, `lease_until integer`, `status text NOT NULL`, `created_at` | unique `pairing_code`, unique `chip_address`, index `account_id` | `status`: `unpaired` `paired` `revoked` |
| `grants` | `id`, `robot_id`, `account_id`, `delegation_hash text NOT NULL`, `delegation_json text` (signed; salt as a decimal string; null until signed), `daily_cap`, `per_payment_cap`, `allowlist_json`, `start_at`, `expires_at`, `status text NOT NULL`, `revoke_tx text`, `created_at` | unique `delegation_hash`, index `(robot_id, status)` | `status`: `unsigned` `active` `revoking` `revoked` `expired` |
| `invoices` | `id`, `merchant_id`, `item_id`, `pay_to`, `asset`, `amount`, `expires_at`, `lines_hash`, `rules_hash`, `invoice_hash text NOT NULL`, `restricted integer(boolean)`, `status text NOT NULL`, `paid_tx text`, `used_at integer`, `created_at` | unique `invoice_hash` | `status`: `pending` `paid` `used` `expired` |
| `payments` | `invoice_hash text PK`, `invoice_id`, `robot_id`, `episode_id`, `payer`, `delegation_manager`, `context_sha256`, `approval_id`, `status text NOT NULL`, `tx_hash`, `gas_used`, `fail_reason`, `created_at`, `settled_at integer` | index `episode_id` | `status`: `verifying` `settling` `settled` `failed` |
| `approvals` | `id`, `account_id`, `robot_id`, `episode_id`, `invoice_id`, `invoice_hash`, `payee`, `amount`, `expiry integer`, `nonce text NOT NULL` (bytes32), `oidc_state text NOT NULL`, `oidc_nonce text NOT NULL`, `status text NOT NULL`, `jti text`, `sub text`, `auth_time integer`, `amr_json text`, `signature text`, `error text`, `created_at`, `decided_at integer` | unique `nonce`, `oidc_state`, `jti` | `status`: `requested` `opened` `approved` `denied` `expired` `consumed` |
| `episodes` (= errands) | `id`, `robot_id`, `account_id`, `item`, `invoice_id`, `state text NOT NULL`, `decision_count integer`, `result text`, `request_ids_hash text`, `state_changed_at integer`, `created_at` | index `(robot_id, created_at)` | `state`: §6 |
| `decisions` | `id`, `episode_id`, `step integer`, `model`, `request_id`, `chat_id` (ZG-Res-Key), `provider`, `latency_ms integer`, `prompt_sha256`, `input_json`, `action text NOT NULL`, `reason`, `outcome`, `outcome_ref`, `error`, `created_at` | unique `(episode_id, step)` | `action`: `pay` `ask_human` `walk_away` `safe_stop`; `outcome`: `paid` `approved` `denied` `refused` `failed` `walked_away` `safe_stop` |
| `evidence_uploads` | `episode_id text PK`, `status text NOT NULL`, `payload_json`, `request_ids_hash`, `root_hash`, `storage_tx`, `log_tx`, `attempts integer`, `claimed_at integer`, `uploaded_at integer`, `error`, `created_at` | index `status` | `pending` `uploading` `uploaded` `failed` |
| `chip_requests` | `id`, `robot_id`, `episode_id`, `kind text NOT NULL`, `payload_json text NOT NULL`, `status text NOT NULL`, `expires_at`, `delivered_at`, `responded_at`, `signature`, `leaf_hash`, `refusal_code`, `created_at` | index `(robot_id, status)`, unique `episode_id` | `kind`: `sign-invoice`; `status`: `queued` `delivered` `signed` `refused` `expired` |
| `relayer_txs` | `key text PK` (`settle:<invoiceHash>` / `revoke:<delegationHash>` / `deploy:<smartAccount>`), `kind`, `nonce integer`, `to_address`, `data_sha256`, `tx_hash`, `status text NOT NULL`, `gas_used`, `error`, `created_at`, `updated_at integer` | unique `nonce` | `pending` `sent` `confirmed` `failed` |
| `used_nonces` | `nonce text PK` (approval nonce or `keccak(jti)`), `kind`, `ref`, `created_at` | — | `kind`: `approval` `jti` |

`relayer_txs` PK insert is the persistent per-invoice guard (a second settle → unique violation → 409). Relayer nonce =
`eth_getTransactionCount(relayer, 'pending')`, inserted before the send; on conflict re-read and retry ≤ 3. The native
test's table list becomes: `accounts, approvals, auth_challenges, chip_requests, decisions, episodes, evidence_uploads,
grants, invoices, passkeys, payments, relayer_txs, robots, used_nonces` (the `styld_auth_*` tables and
`auth_attempt_buckets` are dropped by the migration). The merchant catalogue is a constant in
`packages/server/src/merchant/Catalogue.ts`: `chai` 0.10, `samosa` 0.25, `cigarettes` 0.50 `restricted` with
`payTo = RESTRICTED_PAY_TO` (a second merchant address that no grant allowlists).

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
so a replayed cookie after logout is 401 (keep the native tests' logout-replay and Origin/CSRF equivalents). Every
mutating route under a session requires `Origin == AUTH_ORIGIN` (403 otherwise). `rp.id` and the expected origin are
derived from `AUTH_ORIGIN` at runtime (the native test stack has a different host). Challenges live in
`auth_challenges`, single-use, 5 min. P-256 on Arc: the precompile at `0x100` was verified live (research), so the
passkey can be the on-chain signer.

Chain signing with the same credential: `POST /api/wallet/grants/options {robotId, dailyCap, perPaymentCap, allowlist,
expiresAt}` → builds the unsigned grant (§5), stores it `unsigned`, returns `{grantId, challenge = delegationHash
bytes}`; `POST /api/wallet/grants/:id/sign {credentialId, authenticatorData, clientDataJSON, signature}` → the server
verifies the assertion exactly as a login (challenge = the hash) and encodes the DeleGator signature
`abi.encode(bytes32 keyIdHash, uint256 r, uint256 lowS, bytes authData, bool UV, string cdjPrefix, string cdjSuffix,
uint256 typeIdx)` (prefix/suffix split around the base64url challenge; `keyIdHash = keccak256(utf8(keyId))`), marks
the grant `active`. Revoke is the same pair under `/api/wallet/grants/:id/revoke/{options,sign}` (the challenge is the
hash of a one-time delegation whose execution is `DelegationManager.disableDelegation(grant)`). The relayer deploys the
account (`relayer_txs` key `deploy:<smartAccount>`, `SimpleFactory` via `getFactoryArgs()`) inside the first grant
`sign` request, before the grant can be redeemed.

Browser: `apps/web/src/Passkey.ts` is a Context.Service over `navigator.credentials` with live and fixture layers
(pattern: Nod's `~/code/hack-meridian-2026/apps/web/src/backend/passkey.ts`); commands call it, views never do. Tests
use Playwright's virtual authenticator.

## 5. Chain: accounts, grants, leaves, hashes (`packages/chain`, `packages/protocol`)

- **Addresses** come from `getSmartAccountsEnvironment(5042)` in `@metamask/smart-accounts-kit` 2.0.0
  (delegation-deployments 2.1.0 / Delegation Framework v1.3.0); never hard-code them. For reference: DelegationManager
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
  must be **deployed before any grant is redeemed** (the DM verifies ECDSA for codeless delegators; ERC-6492 is
  rejected). The optional EOA owner is the passkey fallback.
- **Delegation EIP-712:** domain `{name:"DelegationManager", version:"1", chainId:5042, verifyingContract:DM}`; types
  `Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)` and
  `Caveat(address enforcer,bytes terms)`; `args` and `signature` are not hashed. Hash with `hashDelegation` from
  `@metamask/smart-accounts-kit/utils`; encode contexts with `encodeDelegations`/`decodeDelegations`.
- **Grant (root)** = delegation owner → chip, authority `ROOT_AUTHORITY`, **unique salt per grant** (keccak of the grant
  id). Caveats in this order: `ValueLte(uint256 0)` · `ERC20PeriodTransfer(USDC ‖ uint256 dailyCap ‖ uint256 86400 ‖
  uint256 startAt)` · `Timestamp(uint128 0 ‖ uint128 expiresAt)` · `RobotPaymentPolicyEnforcer(abi.encode(uint256
  perPaymentCap, address[] allowlist, address approver))`. AllowedTargets/AllowedMethods are not needed (the period
  enforcer checks token and selector). Owner actions (revoke) are one-time delegations owner → relayer with
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
  spike's invoice (`docs/research/spikes/s2-facilitator-spike.ts.txt` lines 271–274).
- **Approval** (`packages/protocol/src/Approval.ts`): EIP-712 domain `{name:"VitaquackApproval", version:"1",
  chainId:5042, verifyingContract: ENFORCER_ADDRESS}`, struct `Approval(bytes32 invoiceHash,address payee,uint256
  amount,uint64 expiry,bytes32 nonce)`; signed by the approver key; travels in the enforcer caveat's `args =
  abi.encode(Approval, bytes signature)` (args are outside the signed delegation hash, so the server injects them).
- **Redeem call:** `redeemDelegations(bytes[] permissionContexts, bytes32[] modes, bytes[] executionCallDatas)`
  (selector `0xcef6d209`); `permissionContext` = `encodeDelegations([leaf, grantWithArgs])` (leaf first); execution =
  `encodePacked(address USDC, uint256 0, bytes transfer(payTo, amount))`.
- **Gas and RPC rules:** `maxFeePerGas ≥ 20 gwei` or Arc silently drops the tx (use 40 gwei max, 1 gwei priority,
  gas = estimate × 1.2); USDC moves emit both an ERC-20 `Transfer` and an EIP-7708 system log (don't double count);
  the public RPC has no `debug_traceCall`/`eth_simulateV1` and throttles (`-32005`): use `APP_ARC_RPC_URL` (keyed) with
  a small retry budget (`retryCount 3, retryDelay 500`), never the spike's minute-long retries inside a Worker.
- **Testing without broadcasting** (`packages/chain/test`, tag `live-arc`, skipped without `ARC_RPC_URL`): inject the
  owner's proxy code + storage via `stateOverride` and run `eth_call`/`eth_estimateGas` from the relayer; for multi-step
  cases (replay, cap, revoke) put Multicall3's code at the relayer address and `aggregate3` the steps. Technique and
  fixtures: `docs/research/spikes/s2-facilitator-spike.ts.txt` lines 76–89, 216–243, 342.

## 6. Robot Agent: errand state machine and 0G (`packages/server/src/robot/`)

One `episodes` row per errand. Transitions run inside the HTTP request that triggers them; `Errands.tick(episode)`
applies timeouts lazily on every read and every chip poll. No scheduler, no Durable Object.

| State | Leaves via |
| --- | --- |
| `queued` | same request (invoice created at the merchant) → `deciding` |
| `deciding` | 0G tool result `pay` ∧ ¬approvalRequired → `signing`; `pay` ∧ approvalRequired, or `ask_human` → `awaiting_approval`; `walk_away` → `walked_away`; error / timeout (10 s) / invalid JSON → `safe_stop` |
| `awaiting_approval` | `/api/world/callback` approved → `signing`; denied → `denied`; 300 s → `expired` |
| `signing` | chip response `ok` → `settling`; refused → `refused`; 60 s silent → `expired` |
| `settling` | receipt success → `paid`; verify failure or revert → `failed` |
| terminal: `paid` `walked_away` `safe_stop` `denied` `refused` `failed` `expired` | an `evidence_uploads` row `pending` is inserted on entry |

`approvalRequired = amount > perPaymentCap || !allowlist.includes(payTo)`; restricted items always have an
unallowlisted `payTo`, so they always require approval.

Routes (session cookie + Origin check): `POST /api/robots/:robotId/errands {item}` → 201 `{episodeId, state,
decision:{action, reason, requestId}, approvalUrl?}`; `GET /api/robots/:robotId/errands/:id` → `{episode, decisions[],
chipRequest?, payment?, approval?, evidence?}`; `GET /api/robots/:robotId` → `{robot, lease:{until, online}, grant}`.
Idempotency: unique `chip_requests.episode_id`; unique `approvals.nonce`; `relayer_txs.key`; the console disables
"Start" while a non-terminal errand exists.

0G call (`packages/chain/src/ZeroG.ts`; `POST ${ZG_BASE_URL}/chat/completions`, `Authorization: Bearer ${ZG_API_KEY}`,
timeout 10 s, `temperature 0`):

```json
{"model":"<ZG_MODEL>","messages":[
 {"role":"system","content":"You are the purchasing brain of a robot with a USDC budget. Decide only with the decide tool. Never pay when approvalRequired is true or merchant trust is untrusted."},
 {"role":"user","content":"<input JSON>"}],
 "tools":[{"type":"function","function":{"name":"decide","parameters":{"type":"object","required":["action","reason"],
  "properties":{"action":{"type":"string","enum":["pay","ask_human","walk_away"]},"reason":{"type":"string","maxLength":200}}}}}],
 "tool_choice":{"type":"function","function":{"name":"decide"}}}
```

Input JSON: `{"requested","catalogue":{"itemId","name","amount","restricted"},"invoice":{"id","payTo","amount",
"expiresAt"},"budget":{"dailyCap","spentToday","remainingToday","perPaymentCap"},"policy":{"payeeAllowlisted",
"restricted","approvalRequired"},"merchant":{"id","trust":"known"|"untrusted"}}`. Logged per call: `request_id` (body
`x_0g_trace.request_id`), `chat_id` (header `zg-res-key`), provider, model, `latency_ms`, `prompt_sha256`, `input_json`;
never the key. Episode evidence JSON = `{episodeId, robotId, item, decisions[], outcome:{state, txHash?, approvalId?},
requestIds[]}`; `request_ids_hash = keccak256(requestIds.join(","))`. The uploader (`tools/evidence-uploader`, Bun, on
netcup, `~/.config/secrets.env`) polls `GET /api/evidence/pending` (bearer `APP_EVIDENCE_TOKEN`), uploads the JSON to
0G Storage (`@0gfoundation/0g-storage-ts-sdk` 1.2.13, Galileo turbo indexer), calls `EpisodeLog.record(episodeId,
rootHash, requestIdsHash)` on 0G Chain 16602, then `POST /api/evidence/:id/uploaded {rootHash, storageTx, logTx}`.

## 7. Merchant, x402 and the gate (`packages/server/src/merchant/`, `packages/protocol/src/X402.ts`)

- `GET /api/merchants/:id/items` → the catalogue. `POST /api/merchants/:id/invoices {itemId}` → 201 invoice
  `{id (26-char base32), url: "https://<origin>/api/i/<id>", merchantId, payTo, asset, amount, expiresAt (= now + 600),
  linesHash, rulesHash, invoiceHash, restricted}`.
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
  The ≈ 12.7 KB base64 context does not fit Cloudflare's per-header margin, so the `PAYMENT-SIGNATURE` header is
  answered 415 `use POST /api/invoices/:id/pay`. Paid `GET /api/i/:id` → 200 `{invoiceId, status, item, amount, payTo,
  txHash}`.
- Facilitator `verify` (port of S2 with fixes): DelegationManager allowlisted; decode the context; leaf → grant chain
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
  virtual gate page `/gate/:merchantId` creates an invoice, shows its id and QR URL, polls the status every second with
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

Mock chip: `bun apps/chip/src/main.ts --server <URL> [--pair CODE] [--state ~/.vitaquack-chip]`. State dir: `key.json`
(`{"privateKey":"0x…"}`, mode 600, generated once), `pairing.json`, `used-invoices.json`, `spent.json` (`{day, total}`).
Deps: `viem`, `effect`, `@ethmumbai/protocol`. One log line per event; never the key or a signature.

**Hardware seam (the Mac agent):** the Radxa runs the same `apps/chip` code (Bun on arm64; the Python signer from bench
C1 is the fallback) with the same state files; the ESP32 uses `POST /api/merchants/:id/invoices`, draws the invoice
`url` as a QR, polls `/status?nonce=` and verifies `sig` with Monocypher `crypto_ed25519_check` against `gate-key`.
Nothing in the Worker changes for hardware.

## 9. World approval (`packages/server/src/world/`)

1. `POST /api/approvals {episodeId}` (or created by the errand) → `approvals` row: `nonce` = EIP-712 hash of
   `{invoiceHash, amount, payee, expiry}` (the `Approval` struct with the hash as nonce), `oidc_state` random,
   `status = requested`; the console shows `/wallet/approvals/:id` with item, amount, payee, invoice and the button.
2. `GET /api/world/authorize?approval=:id` → 302 to `${WORLD_ISSUER}/authorize?response_type=code&client_id=…&redirect_uri=
   ${AUTH_ORIGIN}/api/world/callback&scope=openid&state=<oidc_state>&nonce=<nonce hex>&max_age=0&prompt=login`;
   `status = opened`.
3. `GET /api/world/callback?code&state` → token exchange (`client_secret_basic`) → verify the RS256 ID token against
   the JWKS (cached 1 h): `iss`, `aud`, `exp`, `nonce == approvals.oidc_nonce`, `auth_time ≥ opened_at − 60`, `acr` is
   `…/acr/orb` or `…/acr/orb-face`, `amr` contains `pop` **and not `mfa`**, `jti` unused (`used_nonces`), `sub` ==
   `accounts.world_sub` (set on the first approval). On success: approver signs `Approval`, `status = approved`, the
   errand continues to `signing` with the approval attached to the chip request. `error=access_denied` or any failure
   → `status = denied` (reason stored), errand → `denied`. Replayed `state`/`code` → 409.
4. 300 s without a callback → `expired`. Nothing is ever signed without a token, so a denied or expired approval cannot
   pay.

Privacy note for the pitch: the backend sees the World token and is a trusted approver. The on-chain verifier
(`docs/research/spikes/s5b-jwt-verifier.sol.txt`) is the stretch that removes that trust at the cost of publishing the
token on Arc.

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
| `APP_ZG_STORAGE_PRIVATE_KEY`, `ZG_STORAGE_INDEXER` (`https://indexer-storage-testnet-turbo.0g.ai`), `ZG_CHAIN_RPC` (`https://evmrpc-testnet.0g.ai`, 16602), `EPISODE_LOG_ADDRESS`, `EVIDENCE_SERVER_URL`, `EVIDENCE_TOKEN` | netcup `~/.config/secrets.env` only, never the Worker | `tools/evidence-uploader/main.ts` |

All bindings are decoded in `ApiWorker.ts` `onFirstUse` with Schema (`^0x[0-9a-f]{64}$` for keys), `Effect.orDie`.
Adding a secret = `alchemy.run.ts` + `check.yml` + `.env.main.local` + the native test bind + the Schema decode **+
`gh secret set` on the repo** (the deploy job needs every secret present, or it fails after a green check). Removing
`APP_AUTH_SECRET` = all of those plus `gh secret delete`. Until Kris supplies a value (RPC URL, 0G key, World client),
set a placeholder (`pending`) so deploys keep working and the feature fails at runtime with a clear error. The Lead
generates fresh relayer, approver and gate keys (never reused from anywhere) and sets them as GitHub secrets.

## 11. Mainnet smoke runbook and evidence

1. Fund ≥ 5 USDC to the relayer EOA on Arc; `cast balance --rpc-url $APP_ARC_RPC_URL <relayer>`.
2. `cd contracts && forge test && forge script script/DeployArc.s.sol --rpc-url $APP_ARC_RPC_URL --broadcast
   --private-key $APP_RELAYER_PRIVATE_KEY` → `ENFORCER_ADDRESS`; `forge script script/DeployZg.s.sol --rpc-url
   https://evmrpc-testnet.0g.ai --broadcast` → `EPISODE_LOG_ADDRESS`.
3. `heavy --wait bun packages/chain/scripts/smoke.ts --amount 0.01` → deploy tx, settle tx, replay revert, revoke tx,
   post-revoke revert.
4. `heavy --wait bun run check`; `APP_RELEASE="$(git rev-parse HEAD)" heavy --wait bunx alchemy deploy --stage main
   --env-file .env.main.local --no-input --yes`; `curl $URL/api/health`.
5. `$URL/` → "Create passkey wallet" (phone passkey) → the counterfactual address; send 2 USDC to it.
6. `/wallet/robots` → "Add robot" → pairing code; `bun apps/chip/src/main.ts --server $URL --pair <CODE>`; grant daily
   1.00 / per-payment 0.30 / allowlist `[merchant payTo]` / 24 h → the passkey signs (deploy tx, grant active).
7. `/robot/<id>` → "buy chai" → `paid`; note `request_id`, invoice id, tx; `GET $URL/api/invoices/<id>/status?nonce=1`
   → `paid`, again → `used`; `/gate/duck-cafe` shows OPEN.
8. "buy cigarettes" → `awaiting_approval` → `/wallet/approvals/<id>` → "Approve with World" → **deny** → `denied`, no
   tx; repeat → **approve** → `paid`.
9. Revoke on `/wallet/robots` → "buy chai" → `failed` (`CannotUseADisabledDelegation`).
10. `heavy --wait bun tools/evidence-uploader/main.ts --once` → root hashes + `EpisodeLog.record` txs;
    `curl -s $URL/api/evidence/<episodeId>`.
11. Write `docs/evidence/<date>-<run>.md`.

Evidence file (indexed by `docs/evidence/README.md`): a header block with commit, deployed URL, `ENFORCER_ADDRESS`,
`EPISODE_LOG_ADDRESS`, relayer and approver addresses, owner smart account, chip address; then one table per run:
`step | time (IST) | actor | invoiceId | invoiceHash | arc tx (https://explorer.arc.io/tx/<hash>) | result/revert |
0G request_id | chat_id | rootHash (storagescan-galileo.0g.ai) | EpisodeLog tx (chainscan-galileo.0g.ai)`. Never paste
tokens, keys, signatures or World ID tokens.

## 12. Submission checklist (Sat 09:00 IST; aim for 08:00)

- ETHGlobal: name and description; public GitHub with real history (no large product commit); a README section on
  **code that predates the event** (the foundation boilerplate from the public `styld.app` repo, commit `370a0e23`,
  imported as one commit on 5 Nov); demo video 2–4 min, ≥ 720p, real narration (no AI voice, not sped up, not filmed
  on a phone), ≤ 4 bullets per slide; up to 3 partner prizes (Arc, 0G, World), each with how we integrated it and
  feedback.
- Arc (Advanced Stablecoin Logic): the shareable Studio URL; Studio shown in the demo; working frontend and backend; an
  architecture diagram (the site page); the video with the Arc/Circle tools used; name the bounty.
- 0G (Physical AI): a 0G call in the decision loop; an episode log on 0G Storage with a request id per decision; a live
  demo at the booth or a replayable run; a safe-stop; **contract deployment addresses**; README setup steps; keep the
  video under 3 minutes (2:30–2:59 satisfies both).
- World (Agent Pass): the official Agent Pass; the full journey including a deny / expired path; validation in the
  backend; a debrief (time to first success, friction, one top improvement).

## 13. Stretch (only after §0's "done" is recorded)

On-chain Agent Pass verification (S5b prototype) · camera frames and a vision decision · duck walking · a read-only
MCP server over the wallet · the float path replaced by a policy-bound escrow · CCTP funding · ENS names · MPP.
