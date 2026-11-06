# Deployed end to end, owner side, 6 Nov 2026

Driver: `packages/server/scripts/e2e-deployed.ts` (commit `55f6ba3`), run on netcup against the deployed app
`https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev`. It goes through the same HTTP routes the
pages use, with Wallet's software WebAuthn authenticator (`packages/server/test/PasskeyFixture.ts`, the native
tests' ceremony):

1. passkey signup
2. the relayer funds the new smart account
3. "Add robot"
4. M+R's mock chip (`apps/chip`) starts as a child process with a fresh key and pairs through the edge
5. the passkey signs a grant (0.50/day, 0.25 per payment, allowlist = the merchant payTo, with
   `RobotPaymentPolicyEnforcer` 0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3)
6. one errand for `chai`, polled to its end

```sh
bun --env-file=.env.main.local packages/server/scripts/e2e-deployed.ts   # keys come from the env file, never printed
```

## Decision: the Worker's Arc RPC is PublicNode until a keyed URL exists

Run 1 failed at the grant's first Arc call: the Worker's `getCode` on `https://rpc.mainnet.arc.io` was answered
`Request exceeds defined limit.` (502 `arc refused`, stage `getCode`). The same call from netcup succeeds. Our reading:
the public Arc RPC rate-limits Cloudflare's shared egress addresses. `APP_ARC_RPC_URL` is now
`https://arc-rpc.publicnode.com` (set 00:55:17Z, GitHub secret + `.env.main.local`). Before the switch we checked it with
`cast` from netcup: chain id `0x13b2`, the DelegationManager's code, the pending nonce, our enforcer's
`domainSeparator()` and `eth_estimateGas` all answer. `https://arc.drpc.org` answers the same and is the fallback.
This stays until Kris supplies a keyed URL. Release `5181d74` is the first deploy with it.

## Run 1 (release b342dc2, public Arc RPC): stopped at the grant

```text
e2e  owner 0x6457aBfAEfa974963E47b2C7263c803C32ecC5f7 (account sikr4g5oam6bk3scfyitwvwkjm)
e2e  funded https://explorer.arc.io/tx/0xae9c3de0b829563aefd674775ca8a40588569b8589928bc08f2f93d5ff358d3b
e2e  robot wtwthtgaitlmht5r4llc7mw334 pairing code 4WH7Z7J2
chip chip 0x196caBe8f27A8D6A7076F65D91A1C79bc1AE42D9 (new key)
chip paired wtwthtgaitlmht5r4llc7mw334
e2e  chip paired
e2e FAILED: grant sign: 502 {"error":"arc refused","stage":"getCode","reason":"Request exceeds defined limit."}
```

## Run 2 (release 5181d74, PublicNode RPC): exit 0, the expected end while 0G is not configured

```text
e2e  base https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev
e2e  owner 0xfB72B5DdE5E739ED93B47A13A2eEDC4980434c4c (account w3a4zsrz27qdkptzlpenhssgmi)
e2e  funded https://explorer.arc.io/tx/0xd50530314a2874c3e498c64b8c57cba169e87eec85d593ad6499191d26050db6
e2e  robot xdpxdi75galea6kt3rls4tz5z4 pairing code HDVRKJXU
chip chip 0xb055923cF99411b7ca36277469FC656dC7cA8138 (new key)
chip paired xdpxdi75galea6kt3rls4tz5z4
e2e  chip paired
e2e  grant vzsvl5menmt3vfxtbijhaembv4 active; account deploy https://explorer.arc.io/tx/0xddd15708400a776ba01c383aede146e83d737c6e6bf815269d3e77e59cbf4a0b
e2e  errand refused 503 "not configured: ZG_API_KEY"
```

| step | time (IST, ≈) | actor | arc tx | result |
| --- | --- | --- | --- | --- |
| passkey signup | 06:31 | owner (software passkey) | — | counterfactual `0xfB72B5DdE5E739ED93B47A13A2eEDC4980434c4c` |
| fund 0.15 USDC | 06:31 | relayer (script) | [0xd5053031…0db6](https://explorer.arc.io/tx/0xd50530314a2874c3e498c64b8c57cba169e87eec85d593ad6499191d26050db6) | status 1, block 29756459 |
| pair the mock chip through the edge | 06:31 | chip `0xb055…8138` | — | robot `paired` |
| grant signed by the passkey; the deployed Worker deploys the account (`deploy:<smartAccount>`) and checks ERC-1271 `isValidSignature` of the passkey signature on Arc before marking the grant `active` | 06:31 | Worker relayer | [0xddd15708…4a0b](https://explorer.arc.io/tx/0xddd15708400a776ba01c383aede146e83d737c6e6bf815269d3e77e59cbf4a0b) | status 1, block 29756468, gas 260142; grant `active` |
| errand `chai` | 06:31 | owner | — | `503 not configured: ZG_API_KEY`: no episode is created while 0G is unset, which is correct (never a faked decision) |

Checked afterwards with `cast` (PublicNode): the owner account has code (the HybridDeleGator proxy) and holds 150000
(0.15 USDC). The relayer's nonce is 8: smoke 4, enforcer 1, two funding transfers, one account deploy.

This is the first passkey-signed grant on Arc mainnet. The passkey's P-256 signature is accepted on chain by the
deployed account (ERC-1271 check in the grant `sign` route). No payment ran under it yet (0G is not configured).

### Long-poll through the deployed edge

With run 2's chip token (read from the chip's state dir, never printed):
`GET /api/chips/xdpxdi75galea6kt3rls4tz5z4/poll` → `200` in 24.8 s and `200` in 24.6 s, `requests: []`, lease
`until − serverTime = 35000` ms. The edge does not reset the 25 s hold, so the chip does not need to poll the API
origin directly.

## Not proven by this run

- a payment under a passkey grant (needs `APP_ZG_*`; then `paid` with the settle tx link)
- the chip's `lease ok` / `signed` lines: the driver stops right after the errand answer, before the first held poll
  returns. The two polls above cover the lease.
- revoke from the passkey (`/api/wallet/grants/:id/revoke/*`) and the World approval (needs `APP_WORLD_*`).
