# Deployed app through the real UI in Chromium, 2026-11-06 (runs 1 to 3 ≈ 06:30 to 06:40 IST, runs 4 to 7 ≈ 12:15 to 12:36 IST)

Run 7 is the definitive run (below: release 563edcb, real 0G decisions, World = the stub, rehearsal only), and
`screens/` holds its shots. Runs 1 to 6 led up to it and are folded into one table.

`packages/server/scripts/wallet-browser.ts` (Wallet lane) drives Playwright Chromium with Chrome's CDP virtual
authenticator (`WebAuthn.addVirtualAuthenticator`, ctap2, resident key, user verification) and clicks the deployed pages
only. The mock chip (`apps/chip`) runs as a child process with a fresh key. Spec §2 M7 acceptance: signup →
counterfactual address shown → grant signed → revoke, in a real browser.

| | |
| --- | --- |
| App | <https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev> |
| Release (runs 1 to 3) | `b8ab06fb0c59b120a878d1c05fb187f2ae90b9e8` (`GET /api/health`) |
| Command | `heavy --wait bun --env-file=.env.main.local packages/server/scripts/wallet-browser.ts [--fund 0.15]` |

## Runs 1 to 6, folded

Runs 4 to 6 used the rehearsal brain (LiteLLM on Railway → `deepseek-v4.1-flash`), and the console labelled every
decision "The rehearsal brain (not 0G) decided …" with its provider. None of them is a 0G decision. In runs 5 and 6,
Approve with World opened the in-Worker stub issuer (`/api/dev/world`), whose page asks nobody to prove anything, so
none of their approvals is a World approval. Git history keeps these runs' full tables (owner and chip addresses)
and the shots they took.

| Run | Release, flags (IST) | What it proved | Arc |
| --- | --- | --- | --- |
| 1 | b8ab06f, `--fund 0.15` (≈ 06:30) | Signup, funding (the wallet showed 0.15 USDC) and pairing. The script then waited for the robots page's Refresh button, which this release did not have yet (80eb19d). The 0.15 USDC is written off: owner `0x95df114c8e0C9616F5985C12E6Ce79bDD9050BB4` is counterfactual and its virtual passkey ended with the browser. | fund [0x305da5f3…2345](https://explorer.arc.io/tx/0x305da5f34f4d116a8cc7da91e051f2747e226ee94debe834b6b8748519992345) |
| 2 | b8ab06f | Signup → paired → grant signed in the browser and active (the relayer deployed the account) → errand 503 `not configured: ZG_API_KEY` → gate CLOSED. The revoke failed on a script bug (a reload while the request was in flight), since fixed. | none |
| 3 | b8ab06f | As run 2, then Revoke grant: the Worker revoked (relayer nonces 10 → 12), but the page said "Something went wrong: unexpected response" because the client still expected `revokeTx` after 893bebe changed the answer to `{grantId, status}`. Fixed in c1e8b59 (the client accepts `{grantId, status, revokeTx?}` and the server sends `revokeTx`), with command tests. | none |
| 4 | 1395f65, `--fund 0.65` (≈ 12:20) | Grant 1.00/day, 0.30/payment signed with the passkey. Buy Chai → rehearsal brain `pay` (`chatcmpl-f2778f51-…`, 1407 ms) → the chip signs → paid; a reload mid-errand restored the errand from activity. The gate had already turned to the next invoice by the screenshot, so the script now catches OPEN live. Buy Cigarettes (twice): `walk_away`, nothing asked or paid (`rehearsal/10-restricted-approve-no-approval.png`). Revoke, then Buy Chai: Arc refused the settlement (`CannotUseADisabledDelegation`) and nothing moved. | fund [0x78059dda…a051](https://explorer.arc.io/tx/0x78059dda4eadc89d087cd1e44edde223c283d14dabf9c27d35770d50b308a051); chai [0x782f8dfc…8875](https://explorer.arc.io/tx/0x782f8dfc25083a5b9328deb949aa037487eb1d2c688492db7fd4e9225a598875); revoke [0xaaa018d2…27c6](https://explorer.arc.io/tx/0xaaa018d2ee34ccd3647c22cb1ec532dd595f468451839e2b8b9b5696a7fe27c6) |
| 5 | 0532509, `--only-restricted --fund 0.55` (≈ 12:22) | Buy Cigarettes (approve): `walk_away` (`chatcmpl-0985f4b5-…`, "price exceeds policy limit, so it cannot be paid even with approval", which is wrong because the enforcer accepts an over-cap payment with an approval). Buy Cigarettes (deny): `ask_human` (`chatcmpl-8aa0ad65-…`, 2978 ms) → approval page → stub page → Deny → "cigarettes: denied", "Reason: World answered access_denied", nothing signed. Revoked. Owner `0xbdf783Fd3d2a88BCafE46Fba486DE086fB3F2Fc0` keeps 0.55 USDC, stranded. | fund [0xa58d6d63…5dec](https://explorer.arc.io/tx/0xa58d6d63633dd24c7a693824ad9171a81dba6ec2d263fac82702d6b1f30a5dec); revoke [0x100641a0…8a7c](https://explorer.arc.io/tx/0x100641a04be2f96140c37862a9945314a634ba2137ca43864090dc74745f8a7c) |
| 6 | 0532509, as run 5 with the script's retry (934f465) (≈ 12:26) | Buy Cigarettes (approve): attempt 1 `walk_away`; attempt 2 `ask_human` (`chatcmpl-dcc1fb3b-…`, 2391 ms) → stub page → Approve → the chip signs → paid, 0.50 USDC to the Duck Café payee `0x0166cd2a4e81f381ca005a791e151ee7d3f88f52` (receipt status 1). Buy Cigarettes (deny), three attempts: each a safe stop, "decide arguments are not {action, reason}" (`chatcmpl-ebb5c79a-…`, `chatcmpl-8083da4d-…`, `chatcmpl-f3c5f700-…`), with no decision made up (`rehearsal/15-restricted-deny-no-approval-1.png`). Revoked. Owner `0xF4815A01e15FeC530E2224CB255e735472ba58C0` keeps 0.05 USDC, stranded. | fund [0xb827c1f8…b919](https://explorer.arc.io/tx/0xb827c1f852bd2124ca95832a32daba9c8101b6a26e824a585c372c830547b919); cigarettes [0xc0e507b6…5fa7](https://explorer.arc.io/tx/0xc0e507b6a5b9da03061f98afe4f64a9aeb6879e6d8927cfd43be1504937f5fa7); revoke [0x442c0b7b…54f8](https://explorer.arc.io/tx/0x442c0b7b3f87a0dd1512c2ec93fc1c48ef0f66f2bb24b5b8a8cd6eaec52254f8) |

Over 7 calls at temperature 0 for a restricted item the owner asked for, the rehearsal brain answered `ask_human`
twice, `walk_away` twice, and three times a tool call that did not decode (safe stop). The app handled each one as
the spec says, but the rehearsal brain was not reliable enough for the cigarettes beat.


## Run 7: the whole journey on release 563edcb (≈ 12:36 IST), 0G Compute (router, qwen3-vl-plus); World = stub, rehearsal only

`heavy --wait bun --env-file=.env.main.local packages/server/scripts/wallet-browser.ts --fund 0.65` against release
`563edcb7998153a91ed848c7b2357d6bd9fbfa21` (`/api/health` features all true). Every decision in this run came from 0G
Compute through the router: the console reads "0G decided …" and names the brain
`router-api.0g.ai/qwen3-vl-plus@0x000000003f486c7198d6203568a98d02b91f8044` (the router's 0G provider) with the router's
request id. The issuer behind Approve with World is the in-Worker stub ("STUB IdP — not World — rehearsal
only"), so the approval and the denial below are rehearsals of the World step, not World approvals. One run, no retries
needed: every restricted call asked the owner.

| Step | Result | Arc |
| --- | --- | --- |
| Signup (virtual passkey) | owner `0x15Fe8671c549619a6743DB125eC57DDE8b1e581c` (`01-signed-up`) | none |
| Fund 0.65 USDC from the relayer | balance on `/wallet` (`02-wallet`) | [0xb6b3edf4…d1cb](https://explorer.arc.io/tx/0xb6b3edf42b4ba55e398c16db91f117d5f8afc0edf06a6a25cd649ce46b66d1cb) |
| Add robot → the mock chip pairs | chip `0xD81F4e378435Cf5af45A8c7BF1f83871082dC3e6` (`03-pairing-code`) | none |
| Grant 1.00/day, 0.30/payment, Duck Café, 24 h, signed with the passkey | consent sentence, then `(active)`; the relayer deployed the account (`04-grant-consent`, `05-grant-active`) | none |
| Gate tab before the errand | CLOSED with the open chai invoice `7asbeh44b7gpqnsblmz4ysnetq` (`08-gate-closed`) | none |
| Buy Chai → 0G `pay` "Chai as asked, within budget." (request id `5ca4a212-1beb-4243-adc7-158156e7c9f4`, 2647 ms) → the chip signs → paid; a reload mid-errand restored it and the console polled twice more | `chai: paid`, Payment on Arc: 0.10 USDC to the counter `0x2845d56f584c5f38d1f0f4b3c1a0a28cf55397f5` (`06-console-live`, `07-console-ended`) | [0xa18da6c6…814a](https://explorer.arc.io/tx/0xa18da6c6aa0b5963839d53133c72dc0e75616450779e534efedc6d687090814a) |
| The gate, live in its own tab | OPEN: "Paid: the merchant's signed status verified (Ed25519)" for invoice `7asbeh44…` (`08-gate-open`) | none |
| Buy Cigarettes (0.50, restricted, over the 0.30 cap) → 0G `ask_human` "Restricted item the owner asked for; the owner approves it in World App." (`d230ef16-35ed-4e03-96cf-4ac173b9d21d`, 1974 ms) → Approve in World App → approval page → Approve with World → stub page → Approve | "Approved: the chip signs the payment now"; console cigarettes: paid: 0.50 USDC to the Duck Café payee `0x0166cd2a4e81f381ca005a791e151ee7d3f88f52`, accepted by the enforcer with the co-signed approval (`10-restricted-approve-asks`, `12-restricted-approve-issuer`, `13-restricted-approve-answered`, `14-restricted-approve-console`) | [0xedeaf0e0…0548](https://explorer.arc.io/tx/0xedeaf0e06604c93a226f731a7499a9be7096813f209d6bac9ff96a8cb0790548) |
| Buy Cigarettes again → 0G `ask_human` (`7dcb97bb-f577-433f-a7b6-60e5aa8cdd64`, 2419 ms) → approval page → Approve with World → stub page → Deny | "Denied: nothing is paid", "World answered access_denied"; console cigarettes: denied, no payment link, nothing signed (`15-restricted-deny-asks`, `17-restricted-deny-issuer`, `18-restricted-deny-answered`, `19-restricted-deny-console`) | none |
| Revoke grant (passkey) | `(revoked)` + Revoke transaction (`20-revoked`) | [0x4f1ba8e1…8e02](https://explorer.arc.io/tx/0x4f1ba8e1625008ec90242657948a8291c495f86aa12011e7a2c7b4bc4afc8e02) |
| Buy Chai after the revoke → 0G `pay` (`1b6b2840-b760-4421-9d1e-163e58160f37`, 2038 ms) → the chip signs → settlement refused by Arc | `chai: failed`, "Reason: CannotUseADisabledDelegation" (`21-after-revoke`); nothing moved | none |

Receipts read back from the Arc RPC: fund, chai, cigarettes and revoke all have status 1. The chai and cigarettes
receipts carry 0.10 and 0.50 USDC transfers from the owner to the payees above. Two shots came too early. The approval
page's own shots (`11-…`, `16-…`, removed) caught it still loading, so `13-…` and `18-…` are the ones with the item,
amount, payee and invoice (answered). `15-restricted-deny-asks` shows the approval link with the console still
loading, so `19-restricted-deny-console` carries that `ask_human` line. The script now waits for both (29a46a0,
1b6bffc). Each console line shows "Episode log: pending" at screenshot time, because the 0G Storage upload runs
afterwards. Left in the owner: 0.05 USDC (0.65 − 0.10 − 0.50), stranded with the virtual passkey.

## Not yet proven on the deployed app (both proven later)

- A live World approval and denial: runs 5 to 7 went through the stub issuer. The live World approval is
  `2026-11-06-live-world.md` (its deny is still to record).
- Run 7's episodes (0G decisions) on 0G Storage and `EpisodeLog`: uploaded at 12:43 IST
  (`2026-11-06-evidence-upload.md`, second section).
