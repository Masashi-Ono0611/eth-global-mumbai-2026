# 0G TEE verification of the first glm-5.3 decisions (6 Nov 2026)

Decision model switched to `glm-5.3` (TeeML; 0G router `router-api.0g.ai`, registry provider
`0xD179F4526064846dE9a9E9D93683AF75CB72E503`, service `https://compute-network-19.integratenetwork.work`) at 17:15 IST
(secrets `APP_ZG_MODEL=glm-5.3`, `APP_ZG_EXTRA_JSON=pending`, redeploy of release 34df520). Probe before the switch:
cigarettes `ask_human` 3/3, chai `pay` 3/3, 4.2–6.5 s.

The Lead's deployed e2e run 11 (`docs/evidence/2026-11-06-deployed-e2e.md`) produced the first two glm-5.3 decisions. A
peer session (eth-global-mumbai-2026-9e, Masa's 0G lane) verified each decision's TEE signature independently within
minutes, with 0G's own SDK (`@0gfoundation/0g-compute-ts-sdk` 0.9.0 `processResponse`) and with the PR #3 script over the
public `/api/evidence/:id` payload:

| Episode | Errand | Decision (request id · chat id) | Decided (IST) | TEE check |
| --- | --- | --- | --- | --- |
| `nvrriucl5b5wh5ncvtxve7wffm` | chai → paid [0xf2460044…2854](https://explorer.arc.io/tx/0xf2460044adf6921de3242318a1fca95429198600f7bbac3e076fc3c006552854) | `tserb4ygo4kb2e36oduxz4q6ze` · `3c745d60-4b0a-4a11-bcfd-d7dbb6d4935e` · `ed7d55f5-70b9-4041-9726-f4c41ef728df`, `pay`, 5.9 s | 17:16:03 IST | `processResponse` **true**; PR #3 script `tee: true` 1/1 |
| `4jgwtprffwze4dhpfsulme3heq` | cigarettes → awaiting the owner's World approval (left unanswered by the driver) | `5l43fxrrpa2le6mgi2o5oqjngi` · `9998c5ea-6c62-4ae5-a52c-152ab1ae3a62` · `1fac660f-edf4-46d6-a7b7-7b05e0f31797`, `ask_human`, 6.6 s | 17:16:14 IST | `processResponse` **true** (by chat id; the evidence payload exists only at the terminal state) |

What the proof is: `GET {service.url}/v1/proxy/signature/{chatId}?model=glm-5.3` returns `{text, signature,
signing_address, signing_algo}`; `text` = `zg-sig-v1/e2ee-ct:<64 hex>:<64 hex>` (two hashes over the end-to-end
encrypted request and response between the router and the TEE; not recomputable from our plaintext), and
`recoverAddress(hashMessage(text), signature)` (EIP-191) equals the service's registered `teeSignerAddress`
`0x0766BC72beB6dAe764eE51C781c0A68117E69179` (`TargetSeparated` false). The proof therefore says "0G chat *chatId* was
answered inside this registered TEE"; the link to our decision is the chat id the router returned and we logged.

- chai `text`: `zg-sig-v1/e2ee-ct:adc72e5bf935a0046eb5e081c0a0daaf3830cbf072c814d7ad2ec6321dc9d8f0:76cda1f545993dbc0faf729190a650cdf2b26b6311cb6b4a998be55b1516627a`
- cigarettes `text`: `zg-sig-v1/e2ee-ct:752182aaf85f97668f5937e299f75946c690b555ea4db5f72ccc96fba1edd32f:dfabc8a8702b20481a62c84c95299d78c6a9ac2bb7d25774baa7f02afaf73e0c`

Caveat: the provider serves a chat's signature for only about 20 minutes, so these two checks cannot be repeated later.
The next step (M+R) fetches `{text, signature}` at decision time and stores it in the episode JSON
(`EvidenceDecision.tee`), so the proof is anchored by `EpisodeLog` and rechecked offline by the audit view's Verify.
The earlier `qwen3-vl-plus` decisions came from the router's own provider `0x000000003f486c7198d6203568a98d02b91f8044`,
which is not in the 0G service registry and therefore not TEE-verifiable.
