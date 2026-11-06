# Demo walkthrough (deployed app)

Click-by-click for the 4-minute slot and the video (plan §0 "Demo script"). The app is English only (6 Nov). Times are what we expect on Arc mainnet, not measured on
the final run: replace them with the recorded ones in `docs/evidence/demo-run.md`.

`$APP` = <https://vitaquack.com> from the cutover on 6 Nov (before it: <https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev>). Pages are under `$APP/app/`, the API under `$APP/api/`.

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
| Owner funded | the owner's smart account (step 2) holds ≥ 2.50 USDC on Arc (the run spends chai 0.10 + one approved thali 2.00) | — |
| Second screen | `$APP/app/gate/duck-cafe` open | big **CLOSED** |

## The run

**Demo rules (Kris, 6 Nov: spending limits only):** the allowance defaults to **3.00 USDC a day and 1.00 for one
purchase**. A purchase over 1.00 needs the owner's fresh World approval; the daily cap can't be lifted, approved or not.
The beats: chai 0.10 pays → thali 2.00 is over the per-purchase limit, so 0G asks the owner → World approve → paid (2.10
spent today) → another thali asks → the owner taps **No**, nothing is signed → a third thali would take the day to 4.10,
past 3.00, so the robot walks away (Arc would refuse it anyway) → stop the allowance → the next chai is refused by Arc.

| # | Screen and click | What the screen must show | If it goes wrong |
| --- | --- | --- | --- |
| 1 | `$APP/app/` → type a name in **Your name** → **Create passkey wallet** → approve the passkey prompt (Face ID / Touch ID / phone) | "Signed in. Opening your wallet...", then the wallet home (`/app/wallet`). The avatar (your initial) opens a sheet with your name, the smart account `0x…` address, **Payment records** and **Sign out** | Prompt dismissed: the alert "The passkey step did not finish. Please try again." → click again. Already have a wallet: **Sign in with passkey** returns the same address |
| 2 | The wallet home | The balance in large type, "Your robots spent … in the last 24 hours", **Send** (marked Soon), **Receive**, **+ Robot**; **Receive** opens a sheet with the address as a QR code, in four-character groups, and **Copy address** | "Balance unavailable right now": the public RPC throttled; reload |
| 3 | **+ Robot** (or **Add a robot**) → `/app/wallet/robots` → "What's your robot called?" → type "Duck" → **Next** | "Give Duck this code (works once, 10 minutes). On the robot, run:", the code in two groups, `./vitaquack-chip --pair CODE`, and "Waiting for Duck to connect..." | Code expired: "The code expired before the robot connected." → **Start again** |
| 4 | Laptop: `bun apps/chip/src/main.ts --server $APP --pair CODE` (the Radxa: `./vitaquack-chip --server $APP --pair CODE`) | chip log `paired`, `lease ok`; within 3 s the page says **Duck connected**, the duck says hello and asks how much it can spend | Nothing happens: the chip is not polling (network); the page keeps waiting until the code expires |
| 5 | Keep the presets **3.00** a day, **1.00** for one purchase, **Duck Café**, **1 day** → read the sentence aloud → **Confirm with passkey** → passkey prompt | "Duck can spend up to 3.00 USDC a day, at most 1.00 at a time, only at Duck Café, for the next day. A purchase over 1.00 asks you first in World App; nothing goes past 3.00 a day. Arc enforces this, so not even our server can go past it."; then "Signing and activating on Arc..." (the first grant also deploys the account), then Duck's conversation opens with **3.00 a day** in its header | "Something went wrong: arc refused…" → the reason is Arc's; retry once. `not configured: …` → a binding is missing on the deploy |
| 6 | In Duck's conversation (`/app/robot/:id`) tap **Get me a chai** (or type it and **Send**), then let Duck scan the counter's chai QR | "Get me a chai" from you, "Waiting for Duck to scan the QR code at the counter.", then what Duck saw at the counter, "Asking 0G...", then **0G decided: buy it** with 0G's reason quoted (a line reading **The rehearsal brain (not 0G) decided** means the deploy is on the rehearsal brain: never present that as 0G), "My chip is signing the payment...", "Paying on Arc...", then the receipt **Paid with my chip 0.10 USDC** with **On Arc** (explorer) and **Show proof** (the audit page: 0G request id, brain, latency, chip, payment, evidence). The errand pays the counter's open chai invoice, the one the gate shows | 0G slow/down: "I stopped safely and paid nothing: …": that *is* the safe-stop beat, never fake it. Chip silent 60 s: "It timed out. Nothing was paid." The conversation has no pay-now button since 7 Nov: every errand starts from Duck's own scan |
| 7 | Second screen, the gate | **OPEN** (the merchant's Ed25519-signed status verified), then it asks for a fresh invoice | Still CLOSED: the errand paid a different invoice; send Duck again with **Get me a chai** and let it scan the gate's QR |
| 8 | Conversation → **Get me a thali**, Duck scans the thali QR | **0G decided: ask you first**, then Duck asks in a yellow bubble "I need your OK" with **Approve with World ID** and **No**; the wallet home shows the same request under **Needs you** | No buttons, only "Waiting for your answer": World or the approver is not configured (the errand expires after 300 s). A **walked away** or **stopped safely** stays on screen as it is (never faked): tap **Thali** again |
| 9 | **Approve with World ID** → World sign-in (scan with World App) → **approve** in World App → back on the approval page (`/app/wallet/approvals/:id`) | "Duck wants to buy thali", **2.00 USDC**, "This payment is over the robot's per-payment limit (2.00 > 1.00 USDC)…", then **Approved: the chip signs the payment now** and the page follows the errand to **Paid · view on Arc**; **Back to Duck** shows the thali receipt in the conversation | "World token rejected: acr (…)" = the World account is not Orb-verified (the brackets name the class World sent); "stale" = the sign-in was not fresh: approve again. "a different World account than the one bound to this wallet": the first approval binds the World account |
| 10 | The approval page's **Payee and invoice** (optional) | the Duck Café payee and the invoice id | — |
| 11 | **Back to Duck** → **Get me a thali** again, Duck scans | **0G decided: ask you first** and the yellow **I need your OK** bubble, as in step 8 | — |
| 12 | **No** in the yellow bubble (or **Approve with World ID** → **deny** in World App) | "You said no. Nothing was paid."; no chip request, no transaction; on the wallet home the payment shows **Not paid** | — |
| 13 | **Get me a thali** a third time, Duck scans | 2.10 is spent today and 2.00 more would make 4.10, past the 3.00 daily cap: **0G decided: walk away** with its reason quoted, then "I walked away. Nothing was paid." | If 0G asks instead, tap **No** and say why: an approval cannot lift the daily cap, Arc's period enforcer would refuse 4.10 > 3.00 on-chain |
| 14 | The **3.00 a day** pill in the header → the allowance sheet → **Stop Duck's allowance** → passkey | "Stopping on Arc...", the sheet closes and the header says **No allowance**; the dock says "Duck's allowance is stopped. Send it anyway and Arc refuses the payment on-chain." | 202 / still revoking: reload; the wallet settles it from Arc's DelegationManager |
| 15 | Conversation → **Get me a chai**, Duck scans | "The payment failed: …CannotUseADisabledDelegation…": Arc refused the revoked grant | — |
| 16 | Evidence (after `heavy --wait bun tools/evidence-uploader/main.ts --once` on netcup) | a receipt's **Show proof** (or **All of Duck's errands, with their proof**): the episode on 0G Storage and the EpisodeLog record on 0G Chain | `pending`: the uploader has not run yet |
| 17 | **If a judge asks for a replay:** open any receipt's **Show proof** (or `/app/wallet/episodes`, pick the errand) → **Replay** | The page re-asks 0G with the decision's stored input (temperature 0, 10 s, nothing written) and shows the original decision and the replayed one side by side: action, reason, both 0G request ids, provider, latency, and **same: yes** when the actions match. **Verify** next to it re-downloads the episode from 0G Storage, re-hashes it against the `EpisodeLog` record, re-checks the chip signature on the QR crop and the TEE signature on the decision | `not configured: ZG_API_KEY`: the deploy has no 0G key. A replay that differs is shown as it is; say that the log is the decision that was made, the replay is today's answer |

Talking points per beat are in plan §0. The approval is for **a purchase over the robot's limit**; the daily cap is never lifted.

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
