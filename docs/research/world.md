# World: Agent Pass (World IdP) + IDKit research

Researched 2026-11-05 (event day 1). Everything below was checked against live docs, live endpoints or
cloned source unless it is listed under "Open questions / unverified".

## TL;DR

- **"World ID Agent Pass" is the hackathon name for World IdP**, World's **OpenID Connect issuer** at
  `https://auth.world.org`. It is not IDKit, not MiniKit and not AgentKit. The ETHGlobal prize links point
  only at `auth.world.org`, `/docs` and `/portal`.
  Sources: <https://ethglobal.com/events/mumbai/prizes>, <https://auth.world.org/docs>, <https://auth.world.org/llms.txt>
- The fit for a robot is the **Device Authorization Grant (RFC 8628)**: the backend starts it, the human
  approves in World ID on their phone, and the backend polls and gets an RS256 **ID token**.
  `access_denied`, `expired_token` and 503 all mean **no approval**. That gives us the
  deny/cancel/expire path for free.
- **World ships an official reference for exactly our use case:** `worldcoin/human-in-the-loop`
  (`@worldcoin/human-in-the-loop` 0.2.1). It covers device flow, ID-token checks, an HMAC-signed approval
  receipt bound to an action string, and a 5-minute expiry. We cloned it.
- **Agent Pass has no age claim.** The ID-token claims are `iss sub aud exp iat jti nonce auth_time acr amr`
  (plus `email` relay). For age you need **IDKit** (`passport` preset, or the `identityCheck` preset with
  `minimum_age`, which is a *preview* and needs World's approval). IDKit is a separate $2.5k prize.
- **An on-chain World ID verifier exists on Arc mainnet:** the `WorldIDSatellite` proxy
  `0x304E14e4dC0508C0927e3b307a2C18422C07E394` on chain 5042. It is listed in the docs, we checked the code
  with `eth_getCode`, and `LATEST_ROOT()` returns a non-zero root. It verifies **IDKit 4.0 proofs**,
  **not** Agent Pass OIDC tokens.
- **Prize note:** "We are mocking proofs now, so you don't need sandbox app anymore … Proofs are using fake
  identities". So a real Orb is not needed for the demo. See the open questions for exactly where the mocking lives.

## 1. Prize text (ETHGlobal Mumbai): <https://ethglobal.com/events/mumbai/prizes>

World total is $12.5k across 4 prizes:

| Prize | Amount | Notes |
| --- | --- | --- |
| 🚀 **World ID Agent Pass** | **$5,000**: $2.5k / $1.5k / $1k | Our target. "We are mocking proofs now, so you don't need sandbox app anymore." "NOTE: Proofs are using fake identities, DO NOT rely in them for production" |
| 💿 World ID Agent Pass (Continuity only) | $2,500: $1.5k / $1k | Not for us (we are not entering Continuity) |
| 🪪 Best Use of IDKit | $2,500: up to 2 × $1,250 | Credentials: Proof of Human, Passport/NFC, Selfie Check. Rewards choosing the *minimum sufficient* credential and explaining why |
| 🎉 [Cont] Best Use of IDKit | $2,500 | Continuity only |

**Agent Pass requirements, quoted or close paraphrase:**

- "Integrate with the official World ID Agent Pass."
- Show the full flow: verification request → user completes it → validated result → **protected application or agent action**.
- Show a **denied, expired or cancelled** path "where the protected action does not occur".
- Validate on a secure backend; never treat an unvalidated client response as authorization; no exposed secrets.
- **Short integration debrief:** time to first success, friction, missing docs or features, top improvement.
- Judges want "a meaningful action that needs a human identity or approval layer, not simply a login screen". "Especially interested in agentic products."

**IDKit requirements** (only if we also go for it): IDKit in a working app, at least one credential verified
**on the server or on-chain**, an explanation of the trust event and why the credential is the minimum
sufficient one, a success path plus one alternative path, and the same debrief.

**Event resources:**

- Simulator: <https://simulator.worldcoin.org/id/0x18310f83> (IDKit staging)
- iOS sandbox app (TestFlight): <https://testflight.apple.com/join/Tub7zuyD>
- Workshop: <https://www.youtube.com/watch?v=MElIfoDffuw>

## 2. Agent Pass = World IdP (OIDC): facts

### Environments (checked live with curl)

| | Production | Sandbox |
| --- | --- | --- |
| Issuer | `https://auth.world.org` | `https://sandbox.auth.world.org` |
| Discovery | `https://auth.world.org/.well-known/openid-configuration` | `https://sandbox.auth.world.org/.well-known/openid-configuration` |
| Portal (Google sign-in) | `https://auth.world.org/portal` | `https://sandbox.auth.world.org/portal` |
| Playground | <https://oauth-playground.toolsforhumanity.dev/> (runs auth, step-up and device flow against sandbox) | |

Live discovery for production, fetched 2026-11-05:

- `authorization_endpoint` `/api/v1/authorize`
- `token_endpoint` `/api/v1/token`
- `device_authorization_endpoint` `/api/v1/device_authorization`
- `userinfo_endpoint` `/api/v1/userinfo`
- `revocation_endpoint` `/api/v1/revoke`
- `jwks_uri` `/.well-known/jwks.json`
- `grant_types_supported`: `authorization_code`, `urn:ietf:params:oauth:grant-type:device_code`
- `scopes_supported`: `openid` only
- `subject_types_supported`: `pairwise`
- `id_token_signing_alg_values_supported`: `RS256`; PKCE `S256`; `claims_parameter_supported: true`
- **`acr_values_supported`: only `https://world.org/oidc/acr/orb` and `.../orb-face`.** Sandbox shows the same. Selfie classes are in the docs but not advertised live.
- `claims_supported`: `iss sub aud exp iat jti nonce auth_time acr amr`

Sources: <https://auth.world.org/docs/guides/getting-started>, <https://auth.world.org/docs/guides/testing>

### Device flow: the robot path (<https://auth.world.org/docs/guides/oidc>)

1. `POST /api/v1/device_authorization` with `client_id`, `client_secret`, `scope=openid`, server-side only.
   You may add `acr_values` or `claims` (an essential `acr`). Device auth is **always fresh**; `prompt` and
   `max_age` do not apply.
2. Show the human `user_code` and `verification_uri_complete`. Keep `device_code` private. The code
   **expires 20 minutes after creation** and is single-use.
3. Poll `POST /api/v1/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`, at `interval`:

   | Poll result | Meaning for us |
   | --- | --- |
   | 400 `authorization_pending` | keep polling |
   | 400 `slow_down` | add 5 s to the interval (expiry is not extended) |
   | `access_denied` | **human denied**, or an essential acr/sub requirement was not met. Never a downgraded token |
   | `expired_token` | **expired**. Stop |
   | `invalid_grant`, other OAuth errors, **HTTP 503**, HTTP 429 | stop; "never an approval" |

4. Validate the ID token: RS256 against JWKS, `iss`, `aud`=client id, `exp`. **Require `auth_time`, `acr`
   and `amr`.** There is no `nonce` in device-flow tokens. Then atomically bind or match `(iss, sub)`.

- **`binding_message` and action terms are unsupported.** World App does not display or sign *what* is
  being approved. The docs say action binding is app-side: store the exact action, amount, destination,
  account and expiry against the attempt, show it to the user, record approve or deny, and mark it used
  in the same DB transaction that authorises the operation
  (<https://auth.world.org/docs/guides/step-up#human-checkpoints>).
- **Client auth:** `client_secret_basic` (portal default), `client_secret_post` or `private_key_jwt`
  (RS256, a fresh assertion per poll). The method is **fixed for the client's lifetime**. Secrets start
  `worldidp_client_secret_` (<https://auth.world.org/docs/guides/app-registration>).
- **Device-only clients still need a registered HTTPS redirect URI** in the portal, even though device flow
  does not use it.

### Claims and assurance (<https://auth.world.org/docs/guides/id-token>)

- `sub` is pairwise per *sector*: stable for one person across the apps in one sector, different across
  sectors. Store `(iss, sub)` together.
- `acr`: `.../orb` (Orb-verified account, authenticated by an Orb proof *or* an enrolled passkey),
  `.../selfie`, and `-face` variants that add a fresh face check.
- `amr`:
  - `["pop"]` = a World ID proof.
  - `["pop","face","user"]` = a proof plus a face check.
  - `["pop","user","mfa"]` = **passkey only, not a fresh proof**.
- `auth_time` is server verification time; a reused session keeps the old `auth_time`.
- **Nothing about age, name or documents.**

### Sandbox / testing

- The sandbox gives a test World ID with an Orb-level test credential via the sandbox World ID app
  (TestFlight, "Manual verify" with a selfie, about one hour to issue). Sandbox and production are fully
  separate (registrations, credentials, `sub`s).
- Failure-path checklist from the docs: cancel or expire must leave the op unexecuted; a token from another
  attempt is rejected; a different account is rejected; a consumed code or approval cannot be reused.
- Real-world friction (Ayush-e4/eth PR #45, 2026-10-31, <https://github.com/Ayush-e4/eth/pull/45>):
  - The deny path worked end to end.
  - The approve path was blocked: production needs an Orb, the sandbox TestFlight link was "not found",
    and the web Simulator's CSP blocked the sandbox bridge.
  - The prize-page "mocking proofs" note appears to be World's answer to this.

### Official reference implementation: `worldcoin/human-in-the-loop`

<https://github.com/worldcoin/human-in-the-loop> (MIT; packages `@worldcoin/human-in-the-loop`, `-react`):

- `startDeviceAuthorization` and `pollDeviceAuthorization` in `packages/human-in-the-loop/src/idp.ts`
  (265 lines, uses `oauth4webapi` and `jose`). It maps the errors to
  `pending | slow_down | connection_error | rejected | expired | approved`.
- Token checks: freshness (`auth_time` ≥ attempt start), `acr === 'https://world.org/oidc/acr/orb-v3'`
  (note: **`orb-v3`**, which is not what discovery or the docs list; see open questions), and `amr`
  includes `pop`.
- It then issues an **HS256 receipt JWT** `{action, workflowRunId}`, keyed by HMAC(clientSecret), with a
  ≤5-minute expiry.
- `verifyHumanAuthorization(result, expectedAction)` re-derives the action from the operation inputs. The
  caller must enforce `approvalId` as an idempotency key.
- It is tied to Vercel Workflow SDK and AI SDK 5. **For us, copy the `idp.ts` logic** (about 150 lines)
  into our Bun/Effect backend rather than adopting Workflow.

## 3. IDKit / World ID 4.0: facts (needed for age and for on-chain enforcement)

- **Packages** (npm, 2026-11-05):
  - `@worldcoin/idkit` **4.6.0** (React)
  - `@worldcoin/idkit-core` **4.6.0** (vanilla JS; `signRequest` at `@worldcoin/idkit-core/signing`)
  - `@worldcoin/idkit-server` 1.2.0
  - `@worldcoin/idkit-standalone` is **discontinued** in 4.x
  - `@worldcoin/minikit-js` 2.0.3
  - `@worldcoin/agentkit` 0.2.1 (the repo is marked deprecated)
- **4.0 changes** (<https://docs.world.org/world-id/4-0-migration>):
  - An RP context is required: `rp_id`, `nonce`, `created_at`, `expires_at` and a `signature` produced **on
    the backend** with `RP_SIGNING_KEY`.
  - Verify with `POST https://developer.world.org/api/v4/verify/{rp_id}`, forwarding the IDKit payload unchanged.
  - Two proof types: **uniqueness** (one-time nullifier) and **session** (`session_id` plus `session_nullifier`).
  - The portal is `developer.world.org`, a separate registration from World IdP.
- **Credentials** (<https://docs.world.org/world-id/idkit/credentials>):
  - `proofOfHuman` (Orb, issuer_schema_id 1)
  - `passport` (NFC, 9303)
  - `selfieCheck` (11, with `sybil_score`)
  - **`identityCheck` (preview, contact World)** with attributes including **`minimum_age`**,
    `document_type` and `issuing_country`. The response carries `identity_attested`. The error for a user
    who does not match is `identity_attributes_not_matched`.
  - `require_user_presence: true` adds liveness.
- **Error codes** (<https://docs.world.org/world-id/idkit/error-codes>):
  - `user_rejected`: the user cancelled in World App
  - `cancelled`: client abort
  - `timeout`: client poll timeout
  - `credential_unavailable`
  - `nullifier_replayed`
  - `rp_signature_expired`
  - `invalid_network`: staging/prod mismatch
  - …
- **Testing:** `environment: "staging"` plus <https://simulator.worldcoin.org>. Production backends must reject staging proofs.
- **On-chain** (<https://docs.world.org/world-id/idkit/onchain-verification>):
  - v3 `WorldIDRouter.verifyProof` is on World Chain, Ethereum, Base, Optimism and Polygon. **No Arc.**
  - v4 `WorldIDVerifier.verify(nullifier, action, rpId, nonce, signalHash, expiresAtMin, issuerSchemaId, credentialGenesisIssuedAtMin, uint256[5] proof)`:
    - World Chain prod `0x00000000009E00F9FE82CfeeBB4556686da094d7`
    - World Chain staging `0x703a6316c975DEabF30b637c155edD53e24657DB`
    - **Arc prod `WorldIDSatellite` `0x304E14e4dC0508C0927e3b307a2C18422C07E394`**
  - The `worldcoin/world-id-protocol` repo has `contracts/deployments/crosschain/production.json`, with arc
    chainId 5042: verifier `0x0fdB202F2228C732e0662fa48F6c5C382489216f`, satellite impl
    `0x2dDeF03a67f1DbD7de4151F5f8be5b278A879F37`. `staging.json` lists **the same proxy address on Arc
    testnet 5042002**.
  - The action must be `uint256(keccak256(bytes(action))) >> 8`.
  - The satellite accepts a root if it equals `LATEST_ROOT()` or is inside `ROOT_VALIDITY_WINDOW`
    (`contracts/src/crosschain/WorldIDSatellite.sol:153`).
- **Mini apps:** World ID inside MiniKit "has moved to IDKit"
  (<https://docs.world.org/mini-apps/commands/verify>). A mini app is not needed for Agent Pass.
- **Other World products (not what the prize asks for):**
  - **AgentKit** (x402 + AgentBook registration on Base; repo deprecated)
  - "World ID for Agents" (launched 2026-10-19 on World ID 4.0,
    <https://www.biometricupdate.com/202610/world-brings-biometric-proof-of-human-to-banking-and-ai-agents>)
  - Legacy Sign In with World ID (deprecated in favour of World IdP OIDC)

## 4. Our integration, mapped onto the duck demo

### Roles

- **Robot (Pi/ESP32):** never talks to World. It asks our backend "may I pay X to merchant M for item I?".
- **Backend (Bun/Effect):** the OIDC confidential client. It holds `WORLD_ID_CLIENT_SECRET` and is the only
  thing that can mint a World approval.
- **Owner's phone:** our dashboard shows the pending purchase (item, amount, merchant, photo from the duck,
  0G decision summary) plus the World `user_code`. The **Approve with World ID** button opens
  `verification_uri_complete` in World App. **Deny** is our own button.

### Flow (one approval = one payment intent)

```
duck scans QR → 0G decides "ask_human" (over per-tx cap, or age-restricted category)
  → backend: create PaymentIntent{id, robot, merchant, amount, item, category, deadline}
             attempt = POST /api/v1/device_authorization (scope=openid,
                       claims={"id_token":{"acr":{"essential":true,"values":[orb, orb-face]}}})
             store {intentHash, device_code(private), startedAt, expiresAt=min(expires_in,20m)}
  → phone: dashboard card "Duck wants to buy <item> for $X at <merchant>" + user_code
           [Approve with World ID] → World App (mock proof at event) → approve
           [Deny] → our backend marks the intent denied, stops polling
  → backend poll loop:
       authorization_pending/slow_down → keep going (duck shows "waiting for human")
       access_denied | expired_token | 503 | our Deny | our timeout → intent = DENIED/EXPIRED,
            duck walks away, nothing signed, nothing paid  ← the required failure path
       id_token → verify RS256/JWKS, iss, aud, exp, auth_time ≥ startedAt, acr ∈ {orb, orb-face},
                  amr ∋ "pop", (iss,sub) == owner's linked World ID
             → mark the intent APPROVED and consume it (single DB txn)
             → backend co-signs an EIP-712 HumanApproval{intentHash, robot, merchant, amount, nonce, deadline}
  → duck submits the payment with its session key + the co-signature → 7702 account verifies both on Arc
```

### On-chain enforcement options

| Option | How | Pros | Cons |
| --- | --- | --- | --- |
| **A. Backend co-signer (recommended for Agent Pass)** | The 7702 session-key policy: `amount ≤ perTxCap && category ∉ restricted` → session key alone. Anything else → also needs a valid `HumanApproval` sig from `approverKey` (the backend), bound to the exact intent hash, single-use nonce and deadline | Real on-chain gate: no World approval → no co-sig → revert. Works with the OIDC token (which can't be cheaply verified on-chain). Matches `coding-agent-brief.md` line 19 | Trusts our backend to verify World honestly. Mitigate with a log of `(sub, auth_time, jti, intentHash)` and a published approver address |
| B. IDKit proof verified on Arc | The IDKit 4.0 uniqueness proof's `signal` = `intentHash`; our contract calls `WorldIDSatellite.verify(...)` on Arc mainnet, then executes the payment | Trustless; uses the Arc satellite; strong IDKit-prize story | Not "Agent Pass", so it doesn't satisfy the main prize alone. Needs a developer-portal RP. Staging/simulator proofs probably won't verify on the **prod** satellite (unverified). The uniqueness nullifier means one approval per action string, so encode the intent in the action |
| C. Verify the RS256 JWT in Solidity | modexp precompile + JSON parsing | Fully on-chain | Too much work for a weekend; JWKS rotation; claim parsing. Skip |

Recommendation: **A for the Agent Pass prize.** B is only a stretch if we also chase IDKit for the
age-gated item.

### Age-gated item

Agent Pass proves *a fresh, Orb-verified human approved it*; it does **not** prove age.

- **Honest framing for the Agent Pass prize:** restricted category ⇒ the owner must personally approve with
  World ID, every time.
- **If we want real age:** a one-time IDKit `identityCheck({minimum_age: 18})` (preview; ask the World booth
  for access) or `passport` at owner onboarding. Store `ageVerified=true` against the owner and require
  `ageVerified && fresh Agent Pass approval` for restricted buys. This is a second integration and maps to
  the IDKit prize.

### Debrief to collect while building (required)

Record the timestamps for:

- portal registration
- the first successful device-flow token in sandbox or with a mocked proof
- the first deny
- the first end-to-end paid approval

Also write down friction as it happens: redirect URI needed for a device-only client, no `binding_message`,
`acr` value mismatch, simulator/CSP issues.

## 5. Cloned repos

All are under `references/`, shallow (`--depth 1`, `GIT_LFS_SKIP_SMUDGE=1`), cloned 2026-11-05. Not added to
`references/README.md`, because this task was scoped to the notes only.

| Path | Upstream | Commit | Licence | Why | Key paths |
| --- | --- | --- | --- | --- | --- |
| `references/worldcoin_human-in-the-loop` | <https://github.com/worldcoin/human-in-the-loop> | `9db036c` | MIT (README; no LICENSE file) | **Official Agent Pass device-flow approval reference.** Closest to what we build | `packages/human-in-the-loop/src/idp.ts` (device start, poll, token checks, receipt), `src/workflows/human-approval.ts`, `packages/human-in-the-loop-react/src/use-human-approval.ts`, `examples/flight-booking/`, `tests/` (mock IdP + signed test tokens) |
| `references/worldcoin_idkit` | <https://github.com/worldcoin/idkit> | `b199567` | MIT | IDKit 4.x SDK, if we add age or an on-chain proof | `js/packages/`, `js/examples/nextjs`, `js/examples/browser`, `go/idkit` (RP signing), `test-vectors/` |
| `references/worldcoin_world-id-protocol` | <https://github.com/worldcoin/world-id-protocol> | `95e5002` | MIT | v4 verifier and **Arc satellite** contracts and deployments | `contracts/src/crosschain/WorldIDSatellite.sol`, `contracts/src/core/WorldIDVerifier.sol`, `contracts/deployments/crosschain/{production,staging}.json`, `services/relay/tests/it/arc_cold_start_repro.rs` |
| `references/worldcoin_developer-docs` | <https://github.com/worldcoin/developer-docs> | `551cffc` | MIT (package.json) | Offline docs.world.org source (IDKit, on-chain, mini apps). **Does not contain the auth.world.org guides** | `world-id/idkit/*.mdx`, `world-id/credentials/`, `world-id/sandbox/`, `world-id/SKILL.md`, `agents/` |
| `references/worldcoin_agentkit` | <https://github.com/worldcoin/agentkit> | `cd85b5e` | MIT | Context only: AgentKit (x402 + AgentBook) is a *different* product from Agent Pass. **The repo is marked deprecated** | `README.md`, `contracts/src`, `skills/` |

The live auth.world.org guides are not in any repo. Fetch them as needed from
`https://auth.world.org/docs/guides/{getting-started,oidc,step-up,id-token,app-registration,testing,coding-agent-setup}`
(the `.md` variant exists for coding-agent-setup).

## 6. Open questions / unverified

1. **What exactly is "mocked"?** It is unclear whether the production IdP now accepts fake identities,
   whether the sandbox web flow works without the TestFlight app, or whether there is an event-only
   environment. **Ask at the World booth on day 1**, then pick the issuer (`auth.world.org` vs
   `sandbox.auth.world.org`) and register the client in *that* portal.
2. **The `acr` value:** the official HITL package requires `https://world.org/oidc/acr/orb-v3`. The docs and
   live discovery list `.../orb` and `.../orb-face`. Log the real token's `acr` and `amr` on the first
   success and accept what the issuer actually returns for Orb.
3. Is Selfie Check (`.../selfie`) accepted on the device flow? It is in the docs, but not in
   `acr_values_supported`.
4. Can mocked or staging IDKit proofs verify on the **production** Arc satellite? (Only relevant to option B.)
   How fresh is the Arc root relay? `LATEST_ROOT()` was non-zero on 2026-11-05, but the relay cadence is unknown.
5. `identityCheck` / `minimum_age` is a preview. Can a hackathon team get access this weekend?
6. Portal eligibility errors (`account_not_eligible`, `client_registration_disabled`) have been reported as
   possible. Register early.
7. Rate limits on device starts (`429`, `Retry-After: 60`): don't auto-restart in a loop during the live demo.
8. Unverified: whether judges count option A (backend co-signer) as "on-chain enforcement". The prize itself
   only requires server-side validation.
