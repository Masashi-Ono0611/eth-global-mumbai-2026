# Deployed app through the real UI in Chromium — 2026-11-06, runs 1–3 ≈ 06:30–06:40 IST, runs 4–7 ≈ 12:15–12:36 IST

**Definitive run: run 7** (below; release 563edcb, real 0G decisions, World = the stub, rehearsal only); `screens/`
holds its shots. Runs 1–6 are the way there.

`packages/server/scripts/wallet-browser.ts` (Wallet lane): Playwright Chromium with Chrome's CDP virtual authenticator
(`WebAuthn.addVirtualAuthenticator`, ctap2, resident key, user verification), clicking the deployed pages only; the mock
chip (`apps/chip`) runs as a child process with a fresh key. Spec §2 M7 acceptance: signup → counterfactual address
shown → grant signed → revoke, in a real browser.

| | |
| --- | --- |
| App | <https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev> |
| Release | `b8ab06fb0c59b120a878d1c05fb187f2ae90b9e8` (`GET /api/health`) |
| Command | `heavy --wait bun --env-file=.env.main.local packages/server/scripts/wallet-browser.ts [--fund 0.15]` |

## Runs

| Run | Owner (smart account) | Chip | Result |
| --- | --- | --- | --- |
| 1 (`--fund 0.15`) | `0x95df114c8e0C9616F5985C12E6Ce79bDD9050BB4` | `0x3127CaF4b11aaDEf1Fba92411d6bE095416A4Bfb` | signup, funded 0.15 USDC ([0x305da5f3…2345](https://explorer.arc.io/tx/0x305da5f34f4d116a8cc7da91e051f2747e226ee94debe834b6b8748519992345)), wallet shows **0.15 USDC**, robot paired; the script then waited for the robots page's Refresh button, which this release did not have yet (80eb19d). **The 0.15 USDC is written off:** the account is counterfactual and its virtual passkey ended with the browser |
| 2 | `0x67b3C733A4cfE2fDefCBce31D7A723c3f20b7043` | `0x66B48f7008F49b3efc584C3215Fb1bef91018411` | signup → paired → **grant signed in the browser, active** (relayer deployed the account) → errand 503 `not configured: ZG_API_KEY` → gate CLOSED; revoke: the script reloaded the page while the revoke request was in flight (script bug, fixed) |
| 3 | `0xf58e4ed8916c8B2dC8A3BCBdF0bE14752dDa1A6C` | `0xcEEF288c985c4C1B279A762D6422adbE57299e98` | as run 2, then **Revoke grant**: the Worker revoked (relayer deploy + revoke = relayer nonces 10 → 12, seen by the Lead) but the page said "Something went wrong: unexpected response": the client still expected `revokeTx` after 893bebe changed the answer to `{grantId, status}` (200/202). Fixed in c1e8b59 (client accepts `{grantId, status, revokeTx?}`, server sends `revokeTx`), with command tests |

What the screens showed (run 3, `screens/`): `01-signed-up.png` (Signed in as …, the counterfactual address),
`02-wallet.png` (balance, Copy address, "Send USDC on Arc to this address…"), `03-pairing-code.png`,
`04-grant-consent.png` ("Vitaquack may spend up to 0.50 USDC a day, at most 0.25 USDC per payment, only at Duck Café,
for the next 24 hours. You sign this with your passkey; Arc enforces it."), `05-grant-active.png` ("Budget: 0.50 USDC a
day, at most 0.25 USDC per payment (active)"), `06-console-not-configured.png` (Buy Chai → "not configured:
ZG_API_KEY": no decision is faked), `08-gate.png` (CLOSED).

## Run 4 — the funded journey on release 1395f65 (≈ 12:20 IST), **rehearsal: brain = LiteLLM → DeepSeek, not 0G**

`heavy --wait bun --env-file=.env.main.local packages/server/scripts/wallet-browser.ts --fund 0.65` against release
`1395f6500909c3703fe3872a9f590eb22afda2c1` (`/api/health` features all true; World = the rehearsal stub). The robot's
brain on this deploy is the **rehearsal brain** (LiteLLM on Railway → `deepseek-v4.1-flash`), and the console labels
every decision "The rehearsal brain (not 0G) decided …" with its provider; none of this run is a 0G decision.

| Step | Result | Arc |
| --- | --- | --- |
| Signup (virtual passkey) | owner `0xaa55C05FfA28774128fbd39eEf2D8891970237Cb` | — |
| Fund 0.65 USDC from the relayer | balance shown on `/wallet` | [0x78059dda…a051](https://explorer.arc.io/tx/0x78059dda4eadc89d087cd1e44edde223c283d14dabf9c27d35770d50b308a051) |
| Add robot → mock chip pairs | chip `0x5cad670504eC53237406b191061c76e221FebBa3` | — |
| Grant 1.00/day, 0.30/payment, Duck Café, 24 h, signed with the passkey in the browser | `(active)`; the relayer deployed the account | — |
| **Buy Chai** → rehearsal brain `pay` (request id `chatcmpl-f2778f51-…`, 1407 ms) → chip signs → **paid**; a reload mid-errand restored it from activity and the console polled 3 more times | `chai: paid`, **Payment on Arc** | [0x782f8dfc…8875](https://explorer.arc.io/tx/0x782f8dfc25083a5b9328deb949aa037487eb1d2c688492db7fd4e9225a598875) |
| Gate (`/gate/duck-cafe`) | had already turned the page by the screenshot: OPEN lasts a few seconds, then it shows a fresh invoice (`rehearsal/08-gate.png`, CLOSED with the next invoice). The script now catches OPEN live (`08-gate-open.png` on the next run) | — |
| **Buy Cigarettes** (twice) | the rehearsal brain answered `walk_away` ("approvalRequired=true … cannot be paid or approved"), so no approval was asked and nothing was paid (`rehearsal/10-restricted-approve-no-approval.png`). The decide prompt is being changed to answer `ask_human` when the owner asked for the item; the approve/deny via the stub reruns after that | — |
| **Revoke grant** (passkey) | `(revoked)` + **Revoke transaction** | [0xaaa018d2…27c6](https://explorer.arc.io/tx/0xaaa018d2ee34ccd3647c22cb1ec532dd595f468451839e2b8b9b5696a7fe27c6) |
| **Buy Chai after the revoke** → brain `pay` → the chip signs → settlement refused by Arc | `chai: failed`, "Reason: CannotUseADisabledDelegation" (`21-after-revoke.png`); nothing moved | — |

Screens from this run (since replaced by run 7's, except `rehearsal/`): `01-signed-up`, `02-wallet`, `03-pairing-code`, `04-grant-consent` (1.00 / 0.30), `05-grant-active`,
`06-console-live`, `07-console-ended` (paid, the rehearsal-brain label and provider), `rehearsal/08-gate`,
`rehearsal/10-restricted-approve-no-approval` / `rehearsal/15-restricted-deny-no-approval` (walked away), `20-revoked`, `21-after-revoke`.

## Runs 5 and 6 — the restricted item approved and denied through the issuer page, release 0532509 (≈ 12:22–12:26 IST), **rehearsal: brain = LiteLLM → DeepSeek, not 0G; issuer = the World stub, not World**

`heavy --wait bun --env-file=.env.main.local packages/server/scripts/wallet-browser.ts --only-restricted --fund 0.55`
against release `0532509f941e7e0fc2e45f98adc1da3ab6c46d7e` (the decide prompt spells out the approval rule). Each run is a
fresh passkey owner: signup → fund → Add robot (mock chip pairs) → grant 1.00/day, 0.30/payment, Duck Café, 24 h signed
with the passkey → Buy Cigarettes (0.50 USDC, restricted, over the per-payment cap) for an approve, again for a deny →
Revoke. **Approve with World** opens the in-Worker stub issuer (`/api/dev/world`), whose page says "STUB IdP — not World
— rehearsal only" (`12-restricted-approve-issuer.png`, `17-restricted-deny-issuer.png`); it asks nobody to prove
anything, so none of this is a World approval. Run 6 used the script's retry (934f465): when the brain does not ask the
owner, it buys the cigarettes again, at most three times.

| Run | Step | Result | Arc |
| --- | --- | --- | --- |
| 5 | Owner `0xbdf783Fd3d2a88BCafE46Fba486DE086fB3F2Fc0`, funded 0.55; chip `0x790A31ACa16345F8B13C4bb23C1b60C0093549aE`; grant active | — | [0xa58d6d63…5dec](https://explorer.arc.io/tx/0xa58d6d63633dd24c7a693824ad9171a81dba6ec2d263fac82702d6b1f30a5dec) (fund) |
| 5 | Buy Cigarettes (approve) | the rehearsal brain answered `walk_away` (`chatcmpl-0985f4b5-…`: "price exceeds policy limit, so it cannot be paid even with approval", which is wrong: the enforcer accepts an over-cap payment with an approval); nothing asked, nothing paid (`rehearsal/10-restricted-approve-no-approval.png`). This run's script did not retry | — |
| 5 | **Buy Cigarettes (deny)** → brain `ask_human` (`chatcmpl-8aa0ad65-…`, 2978 ms) → **Approve in World App** → approval page → **Approve with World** → stub issuer page → **Deny** | back on the approval page, then the console: **cigarettes: denied**, "Reason: World answered access_denied", no payment link, nothing signed (`15-restricted-deny-asks` … `19-restricted-deny-console`) | — |
| 5 | Revoke grant | `(revoked)` | [0x100641a0…8a7c](https://explorer.arc.io/tx/0x100641a04be2f96140c37862a9945314a634ba2137ca43864090dc74745f8a7c) |
| 6 | Owner `0xF4815A01e15FeC530E2224CB255e735472ba58C0`, funded 0.55; chip `0x709C9463Ea1B132C558f5E8Cca22A6EFDd783016`; grant active | — | [0xb827c1f8…b919](https://explorer.arc.io/tx/0xb827c1f852bd2124ca95832a32daba9c8101b6a26e824a585c372c830547b919) (fund) |
| 6 | **Buy Cigarettes (approve)**: attempt 1 `walk_away` (`rehearsal/10-restricted-approve-no-approval-1.png`); attempt 2 → brain `ask_human` (`chatcmpl-dcc1fb3b-…`, 2391 ms: "restricted with approvalRequired=true (and 500000 exceeds the 300000 per-payment cap), so owner must approve in World App") → **Approve in World App** → approval page → **Approve with World** → stub issuer page → **Approve** | **Approved**, the chip signs, console **cigarettes: paid** + **Payment on Arc**: 0.50 USDC from the owner to the Duck Café payee `0x0166cd2a4e81f381ca005a791e151ee7d3f88f52` (receipt status 1; `10-restricted-approve-asks` … `14-restricted-approve-console`) | [0xc0e507b6…5fa7](https://explorer.arc.io/tx/0xc0e507b6a5b9da03061f98afe4f64a9aeb6879e6d8927cfd43be1504937f5fa7) |
| 6 | Buy Cigarettes (deny), three attempts | each ended **safe stop**, "decide arguments are not {action, reason}" (`chatcmpl-ebb5c79a-…` 7563 ms, `chatcmpl-8083da4d-…` 3617 ms, `chatcmpl-f3c5f700-…` 2264 ms): the brain's `decide` arguments did not decode as `{action, reason ≤ 200 characters}`, so the errand stopped and no decision was made up for it (`rehearsal/15-restricted-deny-no-approval-{1,2,3}.png`). The deny path is run 5's | — |
| 6 | Revoke grant | `(revoked)` (`20-revoked.png`) | [0x442c0b7b…54f8](https://explorer.arc.io/tx/0x442c0b7b3f87a0dd1512c2ec93fc1c48ef0f66f2bb24b5b8a8cd6eaec52254f8) |

Receipts read back from the Arc RPC: the approve payment, run 6's fund and run 6's revoke all have status 1; the payment
carries the 0.50 USDC transfer to the payee.

**What the rehearsal brain did with a restricted item the owner asked for (7 calls, temperature 0):** 2 × `ask_human`,
2 × `walk_away`, 3 × a tool call that does not decode (safe stop). The app handled each one
as the spec says (approval page, nothing paid, safe stop), but the rehearsal brain is not a reliable stage brain for
the cigarettes beat. **Stranded:** run 5's owner keeps 0.55 USDC and run 6's 0.05 USDC (counterfactual accounts whose
virtual passkeys ended with the browser). `screens/` now holds run 7's shots; the misses above are under `screens/rehearsal/`
(Git history keeps every earlier shot).

## Run 7 — the whole journey on release 563edcb (≈ 12:36 IST), **0G Compute (router, qwen3-vl-plus); World = stub, rehearsal only**

`heavy --wait bun --env-file=.env.main.local packages/server/scripts/wallet-browser.ts --fund 0.65` against release
`563edcb7998153a91ed848c7b2357d6bd9fbfa21` (`/api/health` features all true). Every decision in this run came from **0G
Compute** through the router: the console reads "0G decided …" and names the brain
`router-api.0g.ai/qwen3-vl-plus@0x000000003f486c7198d6203568a98d02b91f8044` (the router's 0G provider) with the router's
request id. The issuer behind **Approve with World** is the in-Worker **stub** ("STUB IdP — not World — rehearsal
only"), so the approval and the denial below are rehearsals of the World step, not World approvals. One run, no retries
needed: every restricted call asked the owner.

| Step | Result | Arc |
| --- | --- | --- |
| Signup (virtual passkey) | owner `0x15Fe8671c549619a6743DB125eC57DDE8b1e581c` (`01-signed-up`) | — |
| Fund 0.65 USDC from the relayer | balance on `/wallet` (`02-wallet`) | [0xb6b3edf4…d1cb](https://explorer.arc.io/tx/0xb6b3edf42b4ba55e398c16db91f117d5f8afc0edf06a6a25cd649ce46b66d1cb) |
| Add robot → the mock chip pairs | chip `0xD81F4e378435Cf5af45A8c7BF1f83871082dC3e6` (`03-pairing-code`) | — |
| Grant 1.00/day, 0.30/payment, Duck Café, 24 h, signed with the passkey | consent sentence, then `(active)`; the relayer deployed the account (`04-grant-consent`, `05-grant-active`) | — |
| Gate tab before the errand | **CLOSED** with the open chai invoice `7asbeh44b7gpqnsblmz4ysnetq` (`08-gate-closed`) | — |
| **Buy Chai** → **0G `pay`** "Chai as asked, within budget." (request id `5ca4a212-1beb-4243-adc7-158156e7c9f4`, 2647 ms) → the chip signs → **paid**; a reload mid-errand restored it and the console polled twice more | `chai: paid`, **Payment on Arc**: 0.10 USDC to the counter `0x2845d56f584c5f38d1f0f4b3c1a0a28cf55397f5` (`06-console-live`, `07-console-ended`) | [0xa18da6c6…814a](https://explorer.arc.io/tx/0xa18da6c6aa0b5963839d53133c72dc0e75616450779e534efedc6d687090814a) |
| The gate, live in its own tab | **OPEN**: "Paid: the merchant's signed status verified (Ed25519)" for invoice `7asbeh44…` (`08-gate-open`) | — |
| **Buy Cigarettes** (0.50, restricted, over the 0.30 cap) → **0G `ask_human`** "Restricted item the owner asked for; the owner approves it in World App." (`d230ef16-35ed-4e03-96cf-4ac173b9d21d`, 1974 ms) → **Approve in World App** → approval page → **Approve with World** → stub page → **Approve** | "Approved: the chip signs the payment now"; console **cigarettes: paid**: 0.50 USDC to the Duck Café payee `0x0166cd2a4e81f381ca005a791e151ee7d3f88f52`, accepted by the enforcer with the co-signed approval (`10-restricted-approve-asks`, `12-restricted-approve-issuer`, `13-restricted-approve-answered`, `14-restricted-approve-console`) | [0xedeaf0e0…0548](https://explorer.arc.io/tx/0xedeaf0e06604c93a226f731a7499a9be7096813f209d6bac9ff96a8cb0790548) |
| **Buy Cigarettes** again → **0G `ask_human`** (`7dcb97bb-f577-433f-a7b6-60e5aa8cdd64`, 2419 ms) → approval page → **Approve with World** → stub page → **Deny** | "Denied: nothing is paid", "World answered access_denied"; console **cigarettes: denied**, no payment link, nothing signed (`15-restricted-deny-asks`, `17-restricted-deny-issuer`, `18-restricted-deny-answered`, `19-restricted-deny-console`) | — |
| **Revoke grant** (passkey) | `(revoked)` + **Revoke transaction** (`20-revoked`) | [0x4f1ba8e1…8e02](https://explorer.arc.io/tx/0x4f1ba8e1625008ec90242657948a8291c495f86aa12011e7a2c7b4bc4afc8e02) |
| **Buy Chai after the revoke** → **0G `pay`** (`1b6b2840-b760-4421-9d1e-163e58160f37`, 2038 ms) → the chip signs → settlement refused by Arc | `chai: failed`, "Reason: CannotUseADisabledDelegation" (`21-after-revoke`); nothing moved | — |

Receipts read back from the Arc RPC: fund, chai, cigarettes and revoke all have status 1; the chai and cigarettes
receipts carry 0.10 and 0.50 USDC transfers from the owner to the payees above. Two shots came too early and were dropped or
are thin: the approval page's own shots (`11-…`, `16-…`, removed) caught it still loading, so `13-…` and `18-…` are the
ones with the item, amount, payee and invoice (answered); `15-restricted-deny-asks` shows the approval link with the
console still loading, so `19-restricted-deny-console` carries that `ask_human` line. The script now waits for both
(29a46a0, 1b6bffc). Each console line shows "Episode log: pending" at screenshot time (the 0G Storage
upload runs afterwards). **Left in the owner:** 0.05 USDC (0.65 − 0.10 − 0.50), stranded with the virtual passkey.

## Not yet proven on the deployed app

- A live **World** approval and denial: runs 5–7 went through the stub issuer, a rehearsal; the submission uses
  auth.world.org once the World client exists.
- Run 7's episodes (0G decisions) on 0G Storage and `EpisodeLog` (the first upload, `2026-11-06-evidence-upload.md`,
  carries a rehearsal-brain decision).
