# Deployed end to end, owner side, 6 Nov 2026

Driver: `packages/server/scripts/e2e-deployed.ts` (commit `55f6ba3`, with `--invoice`/`--gate` added later the same
morning), run on netcup against the deployed app
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
`Request exceeds defined limit.` (502 `arc refused`, stage `getCode`). The same call from netcup succeeds. Our reading is that
the public Arc RPC rate-limits Cloudflare's shared egress addresses. `APP_ARC_RPC_URL` is now
`https://arc-rpc.publicnode.com` (set 00:55:17Z, GitHub secret + `.env.main.local`). Before the switch we checked it with
`cast` from netcup: chain id `0x13b2`, the DelegationManager's code, the pending nonce, our enforcer's
`domainSeparator()` and `eth_estimateGas` all answer. `https://arc.drpc.org` answers the same and is the fallback.
This stays until Kris supplies a keyed URL. Release `5181d74` is the first deploy with it.

## Runs 1 to 8, folded

Runs 4 to 8 used the rehearsal brain, a LiteLLM router serving `deepseek-v4.1-flash`, not 0G. Every decision row names
it (`provider = litellm-production-f53d.up.railway.app/deepseek-v4.1-flash`). In runs 7 and 8 the approval was answered
on the in-Worker World stub issuer (`/api/dev/world`, rehearsal only, not World). The chain side was real in every run:
Arc mainnet, the deployed enforcer, real USDC. The full driver logs (owner and chip addresses, gate invoice hashes)
are in Git history.

| Run | Release, flags (IST) | What it proved | Arc and 0G txs |
| --- | --- | --- | --- |
| 1 | b342dc2, public Arc RPC (≈ 06:30) | Stopped at the grant: the Worker's `getCode` on `https://rpc.mainnet.arc.io` answered `Request exceeds defined limit.` (502 `arc refused`), which led to the PublicNode decision above. | fund [0xae9c3de0…8d3b](https://explorer.arc.io/tx/0xae9c3de0b829563aefd674775ca8a40588569b8589928bc08f2f93d5ff358d3b) |
| 2 | 5181d74, PublicNode RPC (06:31) | Exit 0. The first passkey-signed grant on Arc mainnet: the Worker deployed the owner's account (`0xfB72B5DdE5E739ED93B47A13A2eEDC4980434c4c`) and checked ERC-1271 `isValidSignature` of the passkey's P-256 signature on Arc before marking the grant `active`. The errand answered `503 not configured: ZG_API_KEY` and no episode was created. With this run's chip token, `GET /api/chips/xdpxdi75galea6kt3rls4tz5z4/poll` through the edge answered `200` in 24.8 s and in 24.6 s, `requests: []`, lease `until − serverTime = 35000` ms: the edge keeps the 25 s hold. Afterwards the account had code and held 150000 (0.15 USDC); the relayer's nonce was 8. | fund 0.15 [0xd5053031…0db6](https://explorer.arc.io/tx/0xd50530314a2874c3e498c64b8c57cba169e87eec85d593ad6499191d26050db6) (status 1, block 29756459); account deploy [0xddd15708…4a0b](https://explorer.arc.io/tx/0xddd15708400a776ba01c383aede146e83d737c6e6bf815269d3e77e59cbf4a0b) (status 1, block 29756468, gas 260142) |
| 3 | b8ab06f, `--gate --fund 0.01` | Exit 0. The driver minted the gate's invoice (`zm5qqltydxgsz5whyl4letiyam`), read its signed status the way `/gate/duck-cafe` does (fresh nonce, Ed25519 checked against the gate key: `pending`) and named that invoice in the errand. The errand answered 503 (0G not configured). | fund [0x9697843a…696b](https://explorer.arc.io/tx/0x9697843a645b07b6a85fc5d79e5fd27b397abad6c5c437b4a2b68c243ad9696b); account deploy [0xf2a53554…d8f7](https://explorer.arc.io/tx/0xf2a53554f3e9d9034d35d5f66875b43aa7964ed81426a4343f6d11177a3fd8f7) |
| 4 | 636993b, `--gate` | The first robot payment on mainnet: chai 0.10 through the chip's leaf under the passkey-signed grant with `RobotPaymentPolicyEnforcer` (under cap, allowlisted, no approval needed), 12:06:20 IST. The owner's balance went 0.15 → 0.05, and the gate read `paid`, then `used` (checked by hand). The driver reported a failure that was its own bug (its retry re-decoded one fetched response), fixed after run 5. The episode `hg2ouddwe2h5j6ekbrsn7grfja` is the first one on 0G Storage (`2026-11-06-evidence-upload.md`). | fund [0x03d6036f…04b7](https://explorer.arc.io/tx/0x03d6036f20bab68a42e032f195d8d475ddc7e4ae624d0d97dffaeaab762104b7); account deploy [0x2d7b2d37…1aa1](https://explorer.arc.io/tx/0x2d7b2d371466695ec9bf41bc436b2ebf6000d9fcc347e1a680010c33b2611aa1); settle [0xbbc3b071…56b7](https://explorer.arc.io/tx/0xbbc3b0712715d245b5478f1f539d1503ec64041424b0ad4767c3a8474cdb56b7) (status 1, block 29796235, gas 503345); `EpisodeLog.record` [0xd2fe9e75…aa21](https://chainscan-galileo.0g.ai/tx/0xd2fe9e754583c1edd924e322eac76f3976d18d5d9832114c2aa4a1f8cef3aa21) |
| 5 | 8c52b2f, `--gate --restricted` | Chai paid again; gate invoice `vr34ckkawqnsdrfl33x2hvleim` read `paid`, then `used` (by hand). The driver stopped on the same polling bug before the restricted errands. | settle [0xee88ca6d…44e5](https://explorer.arc.io/tx/0xee88ca6d87b61bf05a237590f720af3b6d522dd04e1478be9de8eaed6e6244e5) (status 1, block 29796881) |
| 6 | 8c52b2f, `--gate --restricted` | The owner → robot → merchant → gate loop in one command: passkey grant (1.00/day with the enforcer), decision `pay` (`chatcmpl-88dce79f-07f9-4f1b-9254-f52902ba72e6`), the chip signs, the facilitator settles, and the gate's signed status goes `pending` → `paid` → `used`. The cigarettes errand ended `walk_away` ("Restricted item (cigarettes) requiring approval, payee not allowlisted, and 500000 exceeds the 250000 per-payment cap — unpayable under policy.", `chatcmpl-ef21f959-a395-4c24-b97d-765fe2072183`), recorded and not overridden, so the stub approval was not reached. | fund [0xafa6200c…2915](https://explorer.arc.io/tx/0xafa6200cf2a38e020468800a91b098598c3c117ab7c8624e5a728a25c9b12915); account deploy [0x4aefed92…b958](https://explorer.arc.io/tx/0x4aefed920c1455e05cc2eb862ca3cc2703319f2f0950f629b4c81357acfab958); settle [0x29a477f9…f29f](https://explorer.arc.io/tx/0x29a477f97c10aeaf7b020cb03adc758b21050f250126a53fa80e1d8fb551f29f) (status 1, block 29797335, gas 503650) |
| 7 | 0532509 (M+R's `ask_human` prompt change), `--restricted-only` | The first approved payment through the enforcer's approval path. Decision `ask_human` (`chatcmpl-3987c820-7878-461c-b647-df485209a721`), approval `wwuxwor7oh5mhfcfpspzfk7dkm` approved on the stub, the chip signed, and 0.50 cigarettes settled over the 0.25 per-payment cap to the restricted payee `0x0166…8f52`, which no grant allowlists. The enforcer `0x7c2167B0…e4D3` emitted `PaymentApproved` (topic `0xa8a09da3…`) in that tx, so Arc verified the approver's EIP-712 signature in the caveat args. The restricted payee then held 500000. | fund [0x625a2ec9…e311](https://explorer.arc.io/tx/0x625a2ec9c433f271870095dc8644937947a3d4051563f1c65a7d1fc13be8e311); account deploy [0xd58a5d43…a61b](https://explorer.arc.io/tx/0xd58a5d43fe461f59203e17acc3d6efe00ed55ddc98fd7311ff8a14a5d2f6a61b); settle [0x11c3715e…6a84](https://explorer.arc.io/tx/0x11c3715e9c24842b585f2a29bc8be319da1dfe97df221dd6b61bda26b6f96a84) (status 1, block 29798105, gas 568948) |
| 8 | 0532509, the second errand of run 7, then `--deny-only` ×3 | The deny path was not reached. The rehearsal brain ended each cigarettes errand before an approval existed: `walk_away` ("Invoice 500000 exceeds perPaymentCap of 250000, so the price is not payable as presented."), `safe_stop` twice (undecodable answers, `chatcmpl-aedc9c97…` and the next), then `walk_away`. Each ending is the brain's own, and nothing was paid. Runs 9 and 10 reached the deny. | none |

## Runs 9 and 10 (release 563edcb, `--gate --restricted`, ≈ 12:30 IST): real 0G, the whole loop in one command (World = stub, rehearsal only)

Brain: 0G Compute via router-api.0g.ai, `qwen3-vl-plus`. The decision rows name the provider
`router-api.0g.ai/qwen3-vl-plus@0x000000003f486c7198d6203568a98d02b91f8044`, and the request ids are the router's. The
World approval is answered on the in-Worker stub issuer (rehearsal only, not World). Chain: Arc mainnet with the
deployed enforcer. One run of the driver covered chai with the gate, cigarettes approved (run 9) and cigarettes
denied (run 10), so the separate `--deny-only` run was not needed. Exit 0.

```text
e2e  base https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev
e2e  owner 0x684Bb73aD69e22C92273a7A0a928028Fb8D31bC7 (account jdoptleru4fzqo2yyhbwtizrli)
e2e  funded https://explorer.arc.io/tx/0xd81d84859c35bbb66803f7dab779585b6174f1ee0c05e1aacd96f0f5465b761a
e2e  robot ef3ljk7rmhmhzikmwvkwr76c3e pairing code XXXXXXXX
chip chip 0xf46A7eCAEC0421c7C488706eBA19024fD00f7051 (new key)
chip paired ef3ljk7rmhmhzikmwvkwr76c3e
e2e  chip paired
e2e  grant hkt4qhll7wstms6j46wwchlbau active; account deploy https://explorer.arc.io/tx/0xc41e207c2062cf2df7c17931c5c30e836269d1d331efb41136a943248637db9e
e2e  gate invoice yswamh47sfxznzjvgznh247nke 0xb967fd66dde5d585e9cb3e555c0aa956246af511d467f310c1f12b8fe8cb779c
e2e  gate pending (Ed25519 signature ok, nonce e2e908891)
e2e  errand 64xccb53sv3stqqbecpeiy5g2q (chai) started in signing
chip lease ok
chip signed yswamh47sfxznzjvgznh247nke
e2e  errand ended paid; decision pay by qwen3-vl-plus via router-api.0g.ai/qwen3-vl-plus@0x000000003f486c7198d6203568a98d02b91f8044, request_id 642ed186-c4ba-422d-8f20-128ce8381da0
e2e  settled https://explorer.arc.io/tx/0xd8d27c74839180841d8a31b5c775524fa46a03d3694ffe400f42d021e7ba0f0b
chip payment settled 0xd8d27c74839180841d8a31b5c775524fa46a03d3694ffe400f42d021e7ba0f0b
e2e  gate paid (Ed25519 signature ok, nonce e2e663756)
e2e  gate used (Ed25519 signature ok, nonce e2e553520)
e2e  gate OPEN once, then used
e2e  errand cjdyozc77efciakfbk3mb4mnim (cigarettes) started in awaiting_approval
e2e  approval 6povd4yqj4nk75wsmjdz5wrg2m: approve on the stub IdP (rehearsal only, not World)
e2e  approval 6povd4yqj4nk75wsmjdz5wrg2m is approved
chip signed 664vhunmqswtxxidq3rs47wpwu
chip payment settled 0x33f30e0f6abeec0fa42faeacf8c5d81812f787788a1646a79a2b377d23aa42b3
e2e  errand ended paid; decision ask_human by qwen3-vl-plus via router-api.0g.ai/qwen3-vl-plus@0x000000003f486c7198d6203568a98d02b91f8044, request_id 3cf1326d-45da-45b7-9c67-b3f4e5eaa9c8
e2e  settled https://explorer.arc.io/tx/0x33f30e0f6abeec0fa42faeacf8c5d81812f787788a1646a79a2b377d23aa42b3
e2e  approve path as expected
e2e  errand ipgyznpi5pjkx4dbbcdn72djcu (cigarettes) started in awaiting_approval
e2e  approval sqn4u5nawgmvfxk6wam3ouzacq: deny on the stub IdP (rehearsal only, not World)
e2e  approval sqn4u5nawgmvfxk6wam3ouzacq is denied (World answered access_denied)
e2e  errand ended denied; decision ask_human by qwen3-vl-plus via router-api.0g.ai/qwen3-vl-plus@0x000000003f486c7198d6203568a98d02b91f8044, request_id 0a5aa416-55c3-4767-a231-ea6b60975f2c
e2e  deny path as expected
```

| errand | decision (0G, request id) | result | arc tx |
| --- | --- | --- | --- |
| chai on the gate's invoice `yswamh47sfxznzjvgznh247nke` | `pay`, `642ed186-c4ba-422d-8f20-128ce8381da0` | paid; gate `pending` → `paid` → `used` (Ed25519 verified) | [0xd8d27c74…0f0b](https://explorer.arc.io/tx/0xd8d27c74839180841d8a31b5c775524fa46a03d3694ffe400f42d021e7ba0f0b), status 1, gas 503509 |
| cigarettes, approval `6povd4yqj4nk75wsmjdz5wrg2m` approved on the stub | `ask_human`, `3cf1326d-45da-45b7-9c67-b3f4e5eaa9c8` | paid 0.50 to the restricted payee through the enforcer's approval path (`PaymentApproved` in the tx) | [0x33f30e0f…42b3](https://explorer.arc.io/tx/0x33f30e0f6abeec0fa42faeacf8c5d81812f787788a1646a79a2b377d23aa42b3), status 1, gas 446319 |
| cigarettes, approval `sqn4u5nawgmvfxk6wam3ouzacq` denied on the stub | `ask_human`, `0a5aa416-55c3-4767-a231-ea6b60975f2c` | errand `denied` ("World answered access_denied"), nothing signed, nothing paid | none |

Also on chain:
- owner funding [0xd81d8485…761a](https://explorer.arc.io/tx/0xd81d84859c35bbb66803f7dab779585b6174f1ee0c05e1aacd96f0f5465b761a)
- account deploy [0xc41e207c…b9e](https://explorer.arc.io/tx/0xc41e207c2062cf2df7c17931c5c30e836269d1d331efb41136a943248637db9e)

The three episodes' evidence rows were `pending` for M+R's uploader at 12:37 IST (0G Storage + `EpisodeLog.record`).
They were uploaded at 12:43 to 12:45 IST (`2026-11-06-evidence-upload.md`, second section). Relayer after the run:
4.17 USDC.

## Run 11 (release 34df520, `--gate --restricted`, 17:16 IST): 0G Compute via router, glm-5.3 (TeeML, provider 0xD179…E503)

Brain: 0G Compute via router-api.0g.ai, `glm-5.3` (a TeeML model). Both decision rows name the provider
`router-api.0g.ai/glm-5.3@0xD179F4526064846dE9a9E9D93683AF75CB72E503`, and the request and chat ids are the
router's. The chat ids were sent to the TEE-verification session at once, because the provider serves a chat's
signature for about 20 minutes only. This run does not include that check. World is now the real World IdP
(`auth.world.org`), so the driver cannot answer the approval. It stops there by design (exit 1), and the cigarettes
approval is left to real World, unanswered. The approve and deny legs on glm-5.3 are Kris's own clicks. Chain:
Arc mainnet, deployed enforcer.

```text
e2e  base https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev
e2e  owner 0xDB792805a9D7085915F6A86efB8688B512Ce6619 (account 4tum6v3m75mm5z3322dz5fofjm)
e2e  funded https://explorer.arc.io/tx/0x739269b07780dd30f80344706d1390b3188e729320609869af64766e1a37de61
e2e  robot ehw3qkbpyvwvlypry2yqpnc32e pairing code XXXXXXXX
chip chip 0x6270ed36C5b8298dFEb1d7b04C2C29f766BB3CA1 (new key)
chip paired ehw3qkbpyvwvlypry2yqpnc32e
e2e  chip paired
e2e  grant b2crh6q2mgqxmiss6cdl4echkq active; account deploy https://explorer.arc.io/tx/0xa28f0e3c28c382ccc4a660dbdfb5c9748f1aac85671ca6648adbdc236554ba9f
e2e  gate invoice c3c2rpdvlbgjj2uvxvqg3o3iuq 0xea08f37f7d912f6783a816cfc72254916825e96df37430748f34b682d6e9d87a
e2e  gate pending (Ed25519 signature ok, nonce e2e431366)
e2e  errand nvrriucl5b5wh5ncvtxve7wffm (chai) started in signing
chip lease ok
chip signed c3c2rpdvlbgjj2uvxvqg3o3iuq
chip payment settled 0xf2460044adf6921de3242318a1fca95429198600f7bbac3e076fc3c006552854
e2e  errand ended paid; decision pay by glm-5.3 via router-api.0g.ai/glm-5.3@0xD179F4526064846dE9a9E9D93683AF75CB72E503, request_id 3c745d60-4b0a-4a11-bcfd-d7dbb6d4935e
e2e  settled https://explorer.arc.io/tx/0xf2460044adf6921de3242318a1fca95429198600f7bbac3e076fc3c006552854
e2e  gate paid (Ed25519 signature ok, nonce e2e445389)
e2e  gate used (Ed25519 signature ok, nonce e2e230471)
e2e  gate OPEN once, then used
e2e  errand 4jgwtprffwze4dhpfsulme3heq (cigarettes) started in awaiting_approval
e2e FAILED: no approve link on auth.world.org
```

| errand | decision (0G glm-5.3) | result | arc tx |
| --- | --- | --- | --- |
| chai on the gate's invoice `c3c2rpdvlbgjj2uvxvqg3o3iuq`, episode `nvrriucl5b5wh5ncvtxve7wffm` | `pay`, decision `tserb4ygo4kb2e36oduxz4q6ze`, request `3c745d60-4b0a-4a11-bcfd-d7dbb6d4935e`, chat `ed7d55f5-70b9-4041-9726-f4c41ef728df`, 5916 ms | paid; gate `pending` → `paid` → `used` (Ed25519 verified) | [0xf2460044…2854](https://explorer.arc.io/tx/0xf2460044adf6921de3242318a1fca95429198600f7bbac3e076fc3c006552854), status 1, gas 503613 |
| cigarettes, episode `4jgwtprffwze4dhpfsulme3heq` | `ask_human`, decision `5l43fxrrpa2le6mgi2o5oqjngi`, request `9998c5ea-6c62-4ae5-a52c-152ab1ae3a62`, chat `1fac660f-edf4-46d6-a7b7-7b05e0f31797`, 6626 ms | `awaiting_approval`, approval `xueasj2mnvcw6a4xb2ri5glt7a` left to real World, unanswered; nothing signed, nothing paid | none |

Also on chain:
- owner funding [0x739269b0…de61](https://explorer.arc.io/tx/0x739269b07780dd30f80344706d1390b3188e729320609869af64766e1a37de61), status 1
- account deploy [0xa28f0e3c…a9f](https://explorer.arc.io/tx/0xa28f0e3c28c382ccc4a660dbdfb5c9748f1aac85671ca6648adbdc236554ba9f), status 1, gas 260106

The chai episode's evidence row was `pending` for the uploader right after the run. It was uploaded at 17:17 IST
(`2026-11-06-evidence-upload.md`, last section). Cigarettes had no evidence row yet because it was not terminal. The decision rows were read from production D1. Relayer after the run: 3.47 USDC.

## Not proven by runs 1 to 3 (each was proven later)

- A payment under a passkey grant: proven from run 4 on (settle `0xbbc3b071…56b7`).
- The chip's `lease ok` and `signed` lines: logged from run 4 on (the logs of runs 9 to 11 above keep them).
- Revoke from the passkey on the deployed app: browser run 7 (`2026-11-06-deployed-browser.md`).
- The approval with the real World IdP: `2026-11-06-live-world.md`.
