# Live World approval on the deployed app — 2026-11-06 ≈ 14:00–14:56 IST

**Real passkey owner on a Mac, real 0G, real World.** Kris signed in with his own passkey on his MacBook, his robot's
mock chip ran on netcup, every decision came from 0G Compute (router), and the approval went through **World IdP
(`https://auth.world.org`) with World App on his phone and his Orb-verified World account**. No script, no stub
issuer. The first approval attempt was refused by our verifier (`mfa`); after the fix the second was accepted and paid
on Arc.

| | |
| --- | --- |
| App | <https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev> |
| Release | refused attempt: a release with S256 PKCE (2b04027) and the old `amr` rule; accepted attempt: 95a92bd (`amr` recorded, not judged) |
| Owner (smart account) | `0x83B1B415D739B1616C30557cC39776238BA25F7B` (Kris's passkey) |
| Robot / chip | `misfy3q6ojmxraohl7qus2zbyu` / mock chip `0x700664bc402cde77f0a8bcee215d06f3548fcc8e` (netcup) |
| Brain | `router-api.0g.ai/qwen3-vl-plus@0x000000003f486c7198d6203568a98d02b91f8044` (0G Compute) |
| World | World IdP, `client_secret_basic`, redirect `${AUTH_ORIGIN}/api/world/callback`, S256 PKCE, `max_age=0`, `prompt=login` |
| Read back | deployed D1 (`EthMumbai-Database-main`) through the Cloudflare API, read-only `SELECT`s; the World `sub` was never read out, only whether one is stored |

## What happened

| IST | Step | Result | Arc |
| --- | --- | --- | --- |
| 14:00:32 | **Buy Chai** → 0G `pay` (request id `e2beb465-3c17-4148-aa7e-7fb414acd26d`, 2435 ms) → the chip signs | `chai: paid`, 0.10 USDC to the counter `0x2845d56f584c5f38d1f0f4b3c1a0a28cf55397f5`, gas 503445 | [0x652cae43…05de](https://explorer.arc.io/tx/0x652cae43690a95ddeedfe7a8b14085ac5d16ebf90d15a3dcdfc7f410a30705de) |
| 14:01:39 | **Buy Cigarettes** (0.50, restricted) → 0G `ask_human` (`8bb404ea-8cf5-446f-8517-f930a3902e87`, 1957 ms) → approval `siq6vlw2yrtopb3xcyipwqlobm` for invoice `jytm22amiijptinn4dnpwk7vou` → **Approve with World** → World App → callback → token exchange | **Refused by our verifier**: approval `denied`, error "World token rejected: mfa" (14:02:07); errand `denied`; no `jti`, no `sub`, no signature stored; nothing paid. The World round trip itself worked; our rule "`amr` has `pop` and not `mfa`" was wrong for the real IdP (`docs/world-debrief.md`, friction 1) | — |
| — | Fix 95a92bd deployed: `acr` Orb + fresh `auth_time` judge the token, `amr` is recorded | — | — |
| 14:54:17 | **Buy Cigarettes** → 0G `ask_human` (`4ae4a3b6-3cdd-46ee-8382-8f80195c4272`, 3151 ms) → approval `cuf5a4h4avnmt22rddepzdoqoa` for invoice `isvhbew4zyr3ajawmmjkavz55m` → **Approve with World** → World App (Orb-verified account, passkey-backed sign-in) | World `auth_time` 14:55:46 (85 s after the approval was requested); **accepted** 14:55:48: `jti` stored once, `sub` stored and the wallet's World account bound, the approver co-signed; the chip signed; **settled** 14:55:51: status 1, gas 446279, the enforcer `0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3` logged `PaymentApproved`, 0.50 USDC to the restricted payee `0x0166cD2A4E81F381CA005A791e151ee7D3F88f52`. Approval now `consumed`, errand `paid` | [0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9) |
| _fill in_ | **Buy Cigarettes → Approve with World → deny in World App** | _fill in: approval id, status `denied`, the reason, nothing paid_ | — |
| _fill in_ | **Revoke grant** (passkey) → **Buy Chai** after the revoke | _fill in: revoke tx, the refusal (`CannotUseADisabledDelegation`)_ | _fill in_ |

## What World's token carried

Stored on the accepted approval (`approvals.amr_json`):

```json
{"acr":"https://world.org/oidc/acr/orb","amr":["pop","user","mfa"]}
```

An Orb-verified account signing in with World App gets `acr` `…/acr/orb` and `amr` `["pop","user","mfa"]`: the same
`amr` that research attributed to a passkey-only sign-in, so `amr` cannot tell the two apart and `acr` is the
personhood signal. The refused attempt stored no claims (the verifier refused before recording); its error names `mfa`.

## Not yet

- The deny and the post-revoke refusal (markers above).
- The three episodes on 0G Storage: `evidence_uploads` reads `pending` (0 attempts) for `te43j36j…`, `hha4g3ln…` and
  `geyvf2s6…` at the time of reading.
