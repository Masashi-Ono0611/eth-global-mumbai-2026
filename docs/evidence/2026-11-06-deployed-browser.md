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

## Not yet proven on the deployed app

- The console with a real 0G decision, a paid chai, the gate OPEN, the restricted-item deny and the revoke screenshots:
  blocked on `APP_ZG_*`. Rerun with `--fund 0.15` once set.
- The console's reload behaviour: proven on the native stack instead (1b8fbb7, `ConsoleBrowserAcceptance.ts`: the 0G
  stub decides, the errand stays `signing`, a reload restores it from `/api/wallet/activity` and the page keeps polling;
  `heavy --wait bun run test:native` → 17 pass, 0 fail).
