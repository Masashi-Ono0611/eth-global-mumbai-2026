# Deployed app through the real UI in Chromium — 2026-11-06 ≈ 06:30–06:40 IST

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
| Gate (`/gate/duck-cafe`) | had already turned the page by the screenshot: OPEN lasts a few seconds, then it shows a fresh invoice (`08-gate.png`, CLOSED with the next invoice). The script now catches OPEN live (`08-gate-open.png` on the next run) | — |
| **Buy Cigarettes** (twice) | the rehearsal brain answered `walk_away` ("approvalRequired=true … cannot be paid or approved"), so no approval was asked and nothing was paid (`10-restricted-approve-no-approval.png`). The decide prompt is being changed to answer `ask_human` when the owner asked for the item; the approve/deny via the stub reruns after that | — |
| **Revoke grant** (passkey) | `(revoked)` + **Revoke transaction** | [0xaaa018d2…27c6](https://explorer.arc.io/tx/0xaaa018d2ee34ccd3647c22cb1ec532dd595f468451839e2b8b9b5696a7fe27c6) |
| **Buy Chai after the revoke** → brain `pay` → the chip signs → settlement refused by Arc | `chai: failed`, "Reason: CannotUseADisabledDelegation" (`21-after-revoke.png`); nothing moved | — |

Screens from this run: `01-signed-up`, `02-wallet`, `03-pairing-code`, `04-grant-consent` (1.00 / 0.30), `05-grant-active`,
`06-console-live`, `07-console-ended` (paid, the rehearsal-brain label and provider), `08-gate`,
`10-restricted-approve-no-approval` / `15-restricted-deny-no-approval` (walked away), `20-revoked`, `21-after-revoke`.

## Not yet proven on the deployed app

- A **0G** decision (this run's decisions came from the rehearsal brain).
- The restricted item approved and denied through the issuer page (the rerun after the decide-prompt change), and a
  live **World** approval (the stub is a rehearsal; the submission uses auth.world.org).
- The gate's OPEN state in a screenshot (caught live from the next run on).
