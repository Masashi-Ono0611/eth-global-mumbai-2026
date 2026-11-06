# Deployed end to end, owner side, 6 Nov 2026

Driver: `packages/server/scripts/e2e-deployed.ts` (commit `55f6ba3`; `--invoice`/`--gate` added later the same morning), run on netcup against the deployed app
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

## Run 3 (release b8ab06f, `--gate --fund 0.01`): the gate's invoice, then the errand

`bun --env-file=.env.main.local packages/server/scripts/e2e-deployed.ts --gate --fund 0.01` → exit 0. The owner was
funded only 0.01, since no payment can run until 0G is set. The driver mints the gate's invoice
(`POST /api/merchants/duck-cafe/invoices {itemId:"chai"}`) and reads its signed status the way `/gate/duck-cafe` does:
a fresh nonce, with the Ed25519 signature checked against `/api/merchants/duck-cafe/gate-key`. It then names that
invoice in the errand (`{item, invoiceId}`, M+R's counter-invoice claim).

```text
e2e  owner 0x13a05d46335721daA9f9a64526c94FDeaA291968 (account 35svw37zc7azgj4favrqo25rzm)
e2e  funded https://explorer.arc.io/tx/0x9697843a645b07b6a85fc5d79e5fd27b397abad6c5c437b4a2b68c243ad9696b
e2e  robot r66hqig4cdhwry57hwiecmuefe pairing code HW95YZGW
chip chip 0xf580B395dB273029d2D4d178e1AB1F45bEfd3B00 (new key)
chip paired r66hqig4cdhwry57hwiecmuefe
e2e  chip paired
e2e  grant tychcz4uze3743k5t64q45ays4 active; account deploy https://explorer.arc.io/tx/0xf2a53554f3e9d9034d35d5f66875b43aa7964ed81426a4343f6d11177a3fd8f7
e2e  gate invoice zm5qqltydxgsz5whyl4letiyam 0xd1323e4942ac1180253127eef185c9a74d31a6b1bb84caf2f03af00d0ba7446c
e2e  gate pending (Ed25519 signature ok, nonce e2e376984)
e2e  errand refused 503 "not configured: ZG_API_KEY"
```

Once `APP_ZG_*` is set, the same command (with the default `--fund 0.15`) continues past the errand: `paid` with the
settle link, then two gate reads that must be `paid` (first read, the gate opens once) and `used` (next read).
Otherwise the driver exits 1. The 409 for a named invoice that is not open is answered after the 0G check, so it is
not reachable while 0G is unset.

## Runs 4–6: the paid loop with the rehearsal brain (LiteLLM → DeepSeek, not 0G)

From release `636993b` on, `APP_ZG_*` points at a **rehearsal brain**: a LiteLLM router serving `deepseek-v4.1-flash`.
It is **not a 0G decision**. Every decision row names its brain (`provider =
litellm-production-f53d.up.railway.app/deepseek-v4.1-flash`), so these runs are never presented as 0G. The chain side
is real: Arc mainnet, the deployed enforcer, real USDC.

### Run 4 (release 636993b, `--gate`): the first robot payment on mainnet

```text
e2e  owner 0x76Fd8b263A4e47A3902729A06F27d14a3aFE0f3d (account 6vcfi5tacwihtwc5goyjbu4tpe)
e2e  funded https://explorer.arc.io/tx/0x03d6036f20bab68a42e032f195d8d475ddc7e4ae624d0d97dffaeaab762104b7
e2e  robot 263eomvmnk2mwdrqbtnebtouni pairing code BU6P4HVX
chip chip 0x47a11bEf4132F676FE8A5fe0bB2766cDD30007F2 (new key)
chip paired 263eomvmnk2mwdrqbtnebtouni
e2e  grant iqdj6qs7n7ahpifw3zdckiditi active; account deploy https://explorer.arc.io/tx/0x2d7b2d371466695ec9bf41bc436b2ebf6000d9fcc347e1a680010c33b2611aa1
e2e  gate invoice yakjwrttpijgzntumyg3hviwye 0xf7cb4300fff9f4e5b64ea17201a4c7f2867b54ae2f4762177c2aae99bfe7aba4
e2e  gate pending (Ed25519 signature ok, nonce e2e284019)
e2e  errand hg2ouddwe2h5j6ekbrsn7grfja started in signing
chip lease ok
chip signed yakjwrttpijgzntumyg3hviwye
chip payment settled 0xbbc3b0712715d245b5478f1f539d1503ec64041424b0ad4767c3a8474cdb56b7
e2e FAILED: errand hg2ouddwe2h5j6ekbrsn7grfja did not end within 3 minutes
```

The errand was paid. The driver's failure was its own bug: its retry re-decoded one fetched response instead of
fetching again. Fixed after run 5. The settle,
[0xbbc3b071…56b7](https://explorer.arc.io/tx/0xbbc3b0712715d245b5478f1f539d1503ec64041424b0ad4767c3a8474cdb56b7)
(status 1, block 29796235, gas 503345, 12:06:20 IST), is chai 0.10 through the chip's leaf under the
passkey-signed grant, which carries `RobotPaymentPolicyEnforcer` (under cap, allowlisted: no approval needed). The
owner's balance went 0.15 → 0.05. The gate read afterwards (same signed-status check, by hand): `paid`, then `used`.
The episode's evidence was uploaded by the uploader: 0G Storage root
`0x8db4ffc168fc95f364564ab7bee5616090c0b32affd05337ef8f53de222bd5dd`, storage tx
`0x87d1be1ff30212e07ca16aad10d05741422195d5e60f86b137b9449fa99012dc`, `EpisodeLog.record` tx
[0xd2fe9e75…aa21](https://chainscan-galileo.0g.ai/tx/0xd2fe9e754583c1edd924e322eac76f3976d18d5d9832114c2aa4a1f8cef3aa21),
request id `chatcmpl-724ca39b-f7ec-4868-adc5-55a2d82c1876`.

### Run 5 (release 8c52b2f, `--gate --restricted`): chai paid again, same driver bug

Chai paid: settle [0xee88ca6d…44e5](https://explorer.arc.io/tx/0xee88ca6d87b61bf05a237590f720af3b6d522dd04e1478be9de8eaed6e6244e5)
(status 1, block 29796881); gate invoice `vr34ckkawqnsdrfl33x2hvleim` read `paid`, then `used` (by hand). The driver
then stopped on the same polling bug, before the restricted errands.

### Run 6 (release 8c52b2f, `--gate --restricted`): chai paid and the gate opens; the brain walked away from cigarettes

```text
e2e  owner 0xFaA9f744749dfa14204032e59A55967D67E9e0eb (account ck7qhx4smxewddwvxrtj6i44h4)
e2e  funded https://explorer.arc.io/tx/0xafa6200cf2a38e020468800a91b098598c3c117ab7c8624e5a728a25c9b12915
e2e  robot s4vr25llgliiogqqtvp2mgl7be pairing code N5NZEJX8
chip chip 0x2De6867781dc405DA0917079c23b90299e1B3eA8 (new key)
chip paired s4vr25llgliiogqqtvp2mgl7be
e2e  chip paired
e2e  grant ewa5ihzxbvg5lncx63n7klwxnq active; account deploy https://explorer.arc.io/tx/0x4aefed920c1455e05cc2eb862ca3cc2703319f2f0950f629b4c81357acfab958
e2e  gate invoice urvmel6qc5nqhbrn3xmtr6lfiu 0x3a67805ec03d2f1b0eeea8536c42b49fd4c6b552e432bd1ec848432f0289080c
e2e  gate pending (Ed25519 signature ok, nonce e2e925246)
e2e  errand nyy3ocjtl5qbf5j5626owjftpe (chai) started in signing
chip lease ok
chip signed urvmel6qc5nqhbrn3xmtr6lfiu
chip payment settled 0x29a477f97c10aeaf7b020cb03adc758b21050f250126a53fa80e1d8fb551f29f
e2e  errand ended paid; decision pay by deepseek-v4.1-flash via litellm-production-f53d.up.railway.app/deepseek-v4.1-flash, request_id chatcmpl-88dce79f-07f9-4f1b-9254-f52902ba72e6
e2e  settled https://explorer.arc.io/tx/0x29a477f97c10aeaf7b020cb03adc758b21050f250126a53fa80e1d8fb551f29f
e2e  gate paid (Ed25519 signature ok, nonce e2e286007)
e2e  gate used (Ed25519 signature ok, nonce e2e631992)
e2e  gate OPEN once, then used
e2e  errand kofqkf3mqp6pkxazx2otb2ymtm (cigarettes) started in walked_away
e2e FAILED: cigarettes errand is walked_away without an approval
```

This is the full owner → robot → merchant → gate loop, run by one command against the deployed app:
- passkey grant (1.00/day with the enforcer)
- the decision (rehearsal brain: `pay`)
- the chip signs
- the facilitator settles [0x29a477f9…f29f](https://explorer.arc.io/tx/0x29a477f97c10aeaf7b020cb03adc758b21050f250126a53fa80e1d8fb551f29f) (status 1, block 29797335, gas 503650)
- the gate's signed status: `pending` → `paid` → `used`

The cigarettes errand did **not** reach the approval: the rehearsal brain decided `walk_away`, with the reason
"Restricted item (cigarettes) requiring approval, payee not allowlisted, and 500000 exceeds the 250000 per-payment
cap — unpayable under policy." (request id `chatcmpl-ef21f959-a395-4c24-b97d-765fe2072183`). That is a legitimate
decision, recorded and not overridden. It means the approval beat needs a brain that answers `ask_human` for
restricted items: the spec §6 prompt says only "never pay when approvalRequired is true". The World stub
(rehearsal only, not World) approve/deny path was therefore not reached in this run.

## Not proven by this run

- a payment under a passkey grant (needs `APP_ZG_*`; then `paid` with the settle tx link)
- the chip's `lease ok` / `signed` lines: the driver stops right after the errand answer, before the first held poll
  returns. The two polls above cover the lease.
- revoke from the passkey (`/api/wallet/grants/:id/revoke/*`) and the World approval (needs `APP_WORLD_*`).
