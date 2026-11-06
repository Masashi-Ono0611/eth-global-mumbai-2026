# Evidence index

Real runs, in order. Each file records the command, the output and the on-chain links; nothing here is simulated
unless the file says so. Keys, tokens and signatures are never pasted.

| When (IST, 6 Nov) | File | What it proves |
| --- | --- | --- |
| 06:10 | `2026-11-06-smoke.md` | **First real payment on Arc mainnet:** relayer funds an EOA-owned Hybrid account, deploys it, settles a $0.01 chip-signed voucher under a grant (stock enforcers), replay refused (`IdEnforcer:id-already-used`), revoke broadcast, next payment refused (`CannotUseADisabledDelegation`). Run 1 (dry run, simulated) and run 2 (broadcast). |
| 06:11 | `contracts.md` | `RobotPaymentPolicyEnforcer` deployed on Arc mainnet at `0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3`; on-chain code equals the build; the 8-case live approval test passes against that code. Explorer source verification blocked by a Cloudflare challenge. |
| 06:22 | `2026-11-06-deployed-merchant.md` | The deployed merchant (release b342dc2): invoice 201, x402 402 with `PAYMENT-REQUIRED`, 415 for the header path, garbage payment 400 with named checks and nothing broadcast, Ed25519 gate status verifies and a tampered status does not, the gate page polls with fresh nonces and stays CLOSED. |
| 06:32 | `2026-11-06-deployed-e2e.md` | The deployed app end to end up to 0G: passkey owner (virtual authenticator) funded → robot → mock chip paired through the edge → **first passkey-signed grant on mainnet** (relayer deploys the account, Arc's ERC-1271 check accepts the passkey signature) → errand answers 503 "not configured: ZG_API_KEY" (never a faked decision). Held polls through the deployed edge return in 24.8 s / 24.6 s with a 35 s lease. Run 1 (b342dc2) stopped at the official Arc RPC's rate limit for Cloudflare egress, which drove the publicnode decision. |
| 06:40 | `2026-11-06-deployed-browser.md` | The deployed pages in Chromium with a virtual passkey: signup shows the counterfactual address, Add robot → the mock chip pairs, the **grant is signed through the real UI** and goes active, the console answers 503 until 0G is configured, the gate stays CLOSED; a revoke-answer decoding bug found and fixed (c1e8b59); screenshots in `screens/`; 0.15 USDC written off in a throwaway owner. |

Still to record: a real 0G decision and a paid errand on the deployed app (needs `APP_ZG_*`), the evidence uploader against
0G Storage and `EpisodeLog` on Galileo (needs gas on `0xc6fF8A666f4C7F674C1D129C73b46D61f2891fcD` and the deploy), a
World approve and deny on the deployed app (needs the IdP client), the demo run (`demo-run.md`), screenshots under
`screens/`.
