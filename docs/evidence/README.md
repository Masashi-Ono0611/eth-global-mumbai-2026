# Evidence index

Real runs, in order. Each file records the command, the output and the on-chain links; nothing here is simulated
unless the file says so. Keys, tokens and signatures are never pasted.

| When (IST, 6 Nov) | File | What it proves |
| --- | --- | --- |
| 06:10 | `2026-11-06-smoke.md` | **First real payment on Arc mainnet:** relayer funds an EOA-owned Hybrid account, deploys it, settles a $0.01 chip-signed voucher under a grant (stock enforcers), replay refused (`IdEnforcer:id-already-used`), revoke broadcast, next payment refused (`CannotUseADisabledDelegation`). Run 1 (dry run, simulated) and run 2 (broadcast). |
| 06:11 | `contracts.md` | `RobotPaymentPolicyEnforcer` deployed on Arc mainnet at `0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3`; on-chain code equals the build; the 8-case live approval test passes against that code. Explorer source verification blocked by a Cloudflare challenge. 12:00: `EpisodeLog` deployed on 0G Galileo at `0x4C947E6D794C78d0F684e46EFC97f712E51a206A` (code = build). |
| 06:22 | `2026-11-06-deployed-merchant.md` | The deployed merchant (release b342dc2): invoice 201, x402 402 with `PAYMENT-REQUIRED`, 415 for the header path, garbage payment 400 with named checks and nothing broadcast, Ed25519 gate status verifies and a tampered status does not, the gate page polls with fresh nonces and stays CLOSED. |
| 06:32 | `2026-11-06-deployed-e2e.md` | The deployed app end to end up to 0G: passkey owner (virtual authenticator) funded → robot → mock chip paired through the edge → **first passkey-signed grant on mainnet** (relayer deploys the account, Arc's ERC-1271 check accepts the passkey signature) → errand answers 503 "not configured: ZG_API_KEY" (never a faked decision). Held polls through the deployed edge return in 24.8 s / 24.6 s with a 35 s lease. Run 1 (b342dc2) stopped at the official Arc RPC's rate limit for Cloudflare egress, which drove the publicnode decision. |
| 06:40 | `2026-11-06-deployed-browser.md` | The deployed pages in Chromium with a virtual passkey: signup shows the counterfactual address, Add robot → the mock chip pairs, the **grant is signed through the real UI** and goes active, the console answers 503 until 0G is configured, the gate stays CLOSED; a revoke-answer decoding bug found and fixed (c1e8b59); screenshots in `screens/`; 0.15 USDC written off in a throwaway owner. |
| 07:30 | `2026-11-06-world-stub.md` | **Rehearsal only:** the in-Worker stub issuer stands in for World IdP until the real client exists; on the native stack a restricted errand is approved through it (co-signed approval, errand `signing`), a second is denied (`denied`, nothing signed), a replayed callback is 409, the stub's token endpoint refuses a wrong secret and a spent code. |
| 12:20 | `2026-11-06-deployed-browser.md` (run 4) | **Rehearsal (brain = LiteLLM → DeepSeek, not 0G):** through the real pages in Chromium: grant signed with a passkey, **Buy Chai paid on Arc** ([0x782f8dfc…8875](https://explorer.arc.io/tx/0x782f8dfc25083a5b9328deb949aa037487eb1d2c688492db7fd4e9225a598875)) with a mid-errand reload, revoke ([0xaaa018d2…27c6](https://explorer.arc.io/tx/0xaaa018d2ee34ccd3647c22cb1ec532dd595f468451839e2b8b9b5696a7fe27c6)), the next chai refused by Arc (`CannotUseADisabledDelegation`); cigarettes walked away (prompt fix pending). |

Still to record: a real 0G decision and a paid errand on the deployed app (needs `APP_ZG_*`), the evidence uploader against
0G Storage and `EpisodeLog` on Galileo (contract deployed; needs a paid episode), a
World approve and deny on the deployed app (needs the IdP client), the demo run (`demo-run.md`), screenshots under
`screens/`.
