# Demo walkthrough (deployed app)

Click-by-click for the 4-minute slot and the video (plan §0 "Demo script"). The app is English only (6 Nov). Times are what we expect on Arc mainnet, not measured on
the final run: replace them with the recorded ones in `docs/evidence/demo-run.md`.

`$APP` = <https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev>

## Already proven on mainnet (do not re-prove on stage)

| What | Evidence |
| --- | --- |
| Settle, replay refused, revoke, next payment refused (stock enforcers) | `docs/evidence/2026-11-06-smoke.md` |
| Our `RobotPaymentPolicyEnforcer` on Arc | `docs/evidence/contracts.md` (`0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3`) |
| A passkey-signed grant on the deployed app: the Worker's relayer deployed the Hybrid account and Arc's ERC-1271 check accepted the passkey signature | [0xddd15708…4a0b](https://explorer.arc.io/tx/0xddd15708400a776ba01c383aede146e83d737c6e6bf815269d3e77e59cbf4a0b) (`docs/evidence/2026-11-06-deployed-e2e.md`) |
| Through the deployed pages (rehearsal brain = LiteLLM, not 0G): Buy Chai paid, a reload mid-errand restored, revoke, the next chai refused by Arc (`CannotUseADisabledDelegation`) | [0x782f8dfc…8875](https://explorer.arc.io/tx/0x782f8dfc25083a5b9328deb949aa037487eb1d2c688492db7fd4e9225a598875) paid, [0xaaa018d2…27c6](https://explorer.arc.io/tx/0xaaa018d2ee34ccd3647c22cb1ec532dd595f468451839e2b8b9b5696a7fe27c6) revoke (`docs/evidence/2026-11-06-deployed-browser.md`, run 4) |
| Through the deployed pages with the **stub issuer** (rehearsal, not World; rehearsal brain, not 0G): Buy Cigarettes (0.50, restricted and over the 0.30 cap) → **Approve with World** → the stub page → Approve → **cigarettes: paid**; a second one → Deny → **cigarettes: denied**, nothing signed | [0xc0e507b6…5fa7](https://explorer.arc.io/tx/0xc0e507b6a5b9da03061f98afe4f64a9aeb6879e6d8927cfd43be1504937f5fa7) paid with the co-signed approval (`docs/evidence/2026-11-06-deployed-browser.md`, runs 5–6) |
| **The whole stage journey through the deployed pages, decisions from 0G Compute** (router, `qwen3-vl-plus`; World = stub, rehearsal only): grant → 0G `pay` → chai paid → gate OPEN → cigarettes → 0G `ask_human` → approve (stub) → paid 0.50 → cigarettes → deny (stub) → denied → revoke → the next chai refused by Arc | [0xa18da6c6…814a](https://explorer.arc.io/tx/0xa18da6c6aa0b5963839d53133c72dc0e75616450779e534efedc6d687090814a) chai, [0xedeaf0e0…0548](https://explorer.arc.io/tx/0xedeaf0e06604c93a226f731a7499a9be7096813f209d6bac9ff96a8cb0790548) cigarettes, [0x4f1ba8e1…8e02](https://explorer.arc.io/tx/0x4f1ba8e1625008ec90242657948a8291c495f86aa12011e7a2c7b4bc4afc8e02) revoke (`docs/evidence/2026-11-06-deployed-browser.md`, run 7; screenshots in `docs/evidence/screens/`) |
| **Live World (real Orb ID, World App), real 0G, a real passkey owner on a Mac:** Buy Cigarettes → 0G `ask_human` → **Approve with World** → World App → token accepted (`acr` orb, `amr` `["pop","user","mfa"]`) → co-signed → **paid 0.50**; the attempt before the `amr` fix was refused, nothing paid | [0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9) (`docs/evidence/2026-11-06-live-world.md`) |

## Before the slot (10 minutes)

| Check | How | Expected |
| --- | --- | --- |
| Worker healthy, right release | `curl -s $APP/api/health` | `"status":"ok"` and `"release"` = the commit you deployed |
| Chain configured | `curl -s $APP/api/merchants/duck-cafe/items` | `"payTo":"0x…"` (not `null`) |
| World configured | the approval page shows **Approve with World** (not "World approval is not configured…") | World client id/secret/issuer set; redirect URI `$APP/api/world/callback` registered at the World portal |
| Rehearsal issuer (until the World client exists) | `APP_WORLD_ISSUER=$APP/api/dev/world`, client id and secret `stub` | **Approve with World** opens a page that says "STUB IdP — not World — rehearsal only": **rehearsal only; the submission uses auth.world.org** (`docs/evidence/2026-11-06-world-stub.md`) |
| 0G configured | starting an errand does not answer `not configured: ZG_API_KEY` | — |
| Mock chip ready | laptop terminal in the repo | `bun apps/chip/src/main.ts --server $APP --pair <CODE>` ready to paste |
| Owner funded | the owner's smart account (step 2) holds ≥ 1 USDC on Arc | — |
| Second screen | `$APP/gate/duck-cafe` open | big **CLOSED** |

## The run

| # | Screen and click | What the screen must show | If it goes wrong |
| --- | --- | --- | --- |
| 1 | `$APP/` → type a name in **Your name** → **Create passkey wallet** → approve the passkey prompt (Face ID / Touch ID / phone) | **Signed in as …**, **Your smart account on Arc** with a `0x…` address, "This address exists before any transaction: the wallet is deployed with your first grant." | Prompt dismissed: the alert "The passkey step did not finish. Please try again." → click again. Already have a wallet: **Sign in with passkey** returns the same address |
| 2 | **Open wallet** (`/wallet`) | **Balance** (Arc USDC), the address as a link to the Arc explorer, **Copy address**, "Send USDC on Arc to this address…" | Balance says "Arc did not report a balance right now." → **Refresh** (public RPC throttling) |
| 3 | **Robots** → **Robot name** "Duck" → **Add robot** | "Pair Duck with this code:" and an 8-character code, "Start the chip with --pair CODE within 10 minutes. The code works once." | Code expired: add the robot again |
| 4 | Laptop: `bun apps/chip/src/main.ts --server $APP --pair CODE` → back in the browser **Refresh** | chip log `paired`, `lease ok`; the card says **paired · online** and shows the chip address | `offline`: the chip is not polling (network); the console says "Chip offline: motors stay stopped until it polls again." |
| 5 | **Grant a budget** → keep 1.00 / 0.30 / the Duck Café address / 24 → read the sentence aloud → **Sign grant with passkey** → passkey prompt | the sentence "Vitaquack may spend up to 1.00 USDC a day, at most 0.30 USDC per payment, only at Duck Café, for the next 24 hours. You sign this with your passkey; Arc enforces it."; then "Signing and activating on Arc..." (the first grant also deploys the account), then **Budget: 1.00 USDC a day, at most 0.30 USDC per payment (active)** | "Something went wrong: arc refused…" → the reason is Arc's; retry once. `not configured: …` → a binding is missing on the deploy |
| 6 | **Open console** (`/robot/:id`) → leave **Invoice from the gate (optional)** empty → **Buy Chai (0.10 USDC)** | "Asking 0G about chai...", then **0G decided to pay: …** with **request id … · brain · N ms** (brain `router-api.0g.ai/qwen3-vl-plus@0x…8044`, request ids like `5ca4a212-…`; a line reading **The rehearsal brain (not 0G) decided …** means the deploy is on the rehearsal brain: never present that as 0G), the chip line ("The chip is checking the invoice and signing" → "The chip signed the payment"), then **chai: paid** and **Payment on Arc** (explorer link). With the field empty the errand pays the counter's open chai invoice, which is the one the gate is showing | 0G slow/down: the errand ends **safe stop** with "Reason: …": that *is* the safe-stop beat, never fake it. Chip silent 60 s: **expired**. To pay one exact invoice, paste the gate's payment link (or its 26-character id) into the field first |
| 7 | Second screen, the gate | **OPEN** (the merchant's Ed25519-signed status verified), then it asks for a fresh invoice | Still CLOSED: the errand paid a different invoice; paste the gate's link into the console field and buy again |
| 8 | Console → **Buy Cigarettes (0.50 USDC)** | **0G decided to ask you first**, state **waiting for approval**, **Approve in World App** | No approval link: World or the approver is not configured (the errand expires after 300 s). 0G asked the owner in every restricted call so far (run 7: 2 of 2; the probe: 5 of 5); a **walked away** or **safe stop** stays on screen as it is (never faked): press **Buy Cigarettes** again |
| 9 | **Approve in World App** → the approval page (`/wallet/approvals/:id`) | **Approval for a restricted item**, item, amount 0.50 USDC, payee, invoice, "Waiting for your answer", **Approve with World**, **Deny** | — |
| 10 | **Approve with World** → World sign-in (scan with World App) → **deny** in World App | back on the page: **Denied: nothing is paid** and the reason; console: **cigarettes: denied**, no payment link | The owner's own **Deny** button gives the same result without World |
| 11 | Buy Cigarettes again → **Approve with World** → **approve** in World App | **Approved: the chip signs the payment now**; console: the chip signs, **cigarettes: paid**, **Payment on Arc** | "World token rejected: acr (…)" = the World account is not Orb-verified (the brackets name the class World sent); "stale" = the sign-in was not fresh: approve again from the page. "a different World account than the one bound to this wallet": the first approval binds the World account |
| 12 | **Robots** → **Revoke grant** → passkey | "Revoking on Arc...", then the budget line ends **(revoked)** and **Revoke transaction** links the explorer | 202 / still revoking: **Refresh**; the page settles it from Arc's DelegationManager |
| 13 | Console → **Buy Chai** | ends **failed** with "Reason: …CannotUseADisabledDelegation…": Arc refused the revoked grant | — |
| 14 | Evidence (after `heavy --wait bun tools/evidence-uploader/main.ts --once` on netcup) | console: **Episode log: uploaded**, **Episode on 0G Storage**, **EpisodeLog record on 0G Chain** | `pending`: the uploader has not run yet |

Talking points per beat are in plan §0. Never say "age check": it is an **approval for a restricted item**.

## Fallbacks for the wallet lane

| If this fails | Then |
| --- | --- |
| The phone's passkey prompt | use the laptop's platform passkey (same flow); the EOA fallback owner exists on the account but has no UI |
| The first grant's deploy is slow | it is one relayer transaction; wait for "active", do not click twice (a second click answers 409) |
| World IdP down or the client not approved in time | show **Deny** (owner) for the deny beat; the approve beat needs World, say so |
| Arc RPC throttled | **Refresh**; balances and revoke status are read lazily from Arc |

## World debrief (Agent Pass prize)

Built Fri 6 Nov for M6 (`packages/server/src/world/`): browser OIDC code flow with `max_age=0&prompt=login`, the
approval's EIP-712 digest as the OIDC `nonce`, RS256 verification against the JWKS, and a backend co-signer.

- **Time to first success.** Discovery and JWKS answered on the first request; a verified token in our tests took
  under an hour of work. The live round trip with Kris's Orb ID: approved and paid on Arc at 14:55 IST on
  the day the client was registered, after the PKCE and `amr` fixes (`docs/evidence/2026-11-06-live-world.md`).
- **Friction.**
  1. The endpoints are not under the issuer root: discovery gives `/api/v1/authorize` and `/api/v1/token`, so code that
     assumes `${issuer}/authorize` breaks. We read discovery at runtime.
  2. `amr` semantics are undocumented: our research-derived rule "`pop` and not `mfa`" refused Kris's real Orb sign-in
     with World App, whose token carries `mfa`. We now judge `acr` (Orb) + a fresh `auth_time` and record `amr`
     (`docs/world-debrief.md`, friction 1). PKCE is also mandatory at the token endpoint (friction 2).
  3. There is no transaction binding in the token: we overload `nonce` with the EIP-712 digest of {invoice, amount,
     payee, expiry}. It works, but every integrator has to invent it.
  4. `sub` is pairwise per client, so a wallet must bind the World account on its first approval and check it after.
  5. The JWKS says `max-age=300` and there is one key with no published rotation: a cache longer than 5 minutes needs a
     refresh-on-unknown-`kid` path.
- **One improvement.** A signed approval claim for a specific action (OAuth Rich Authorization Requests,
  `authorization_details` echoed in the ID token), so a relying party binds "approve 0.50 USDC to 0x… for invoice X"
  without overloading `nonce`, and a single documented claim that means "fresh Orb proof now".
