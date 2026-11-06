# ETHGlobal Mumbai submission (form text)

Checklist: `docs/spec.md` §12. A field marked _fill in_ waits for a run that has not happened yet. Never submit one as a
claim. Three are left: the live World deny, the video link, and the real-duck run with `docs/evidence/demo-run.md`.

## Project name

Vitaquack

## Tagline

Don't give a robot your wallet. Give it a budget.

## Short description

A passkey wallet on Arc grants a robot's chip a capped USDC budget. The robot asks 0G what to buy, its chip signs every
payment, and Arc enforces every limit. A purchase over the limit needs the owner's fresh World approval, and the daily
cap can't be lifted.

## Description

Robots that run errands need to pay, but handing a robot a funded key is handing it your wallet. Vitaquack gives it a
budget instead.

The owner signs up with a passkey, which is also the signer of a MetaMask `HybridDeleGator` smart account on Arc
mainnet. One passkey signature grants a robot's chip a delegation with caveats: a daily cap, a per-payment cap, an
allowlist of payees and an expiry. Our own `RobotPaymentPolicyEnforcer` sits on top and demands an approval for
anything over the cap or to an unlisted payee.

The robot's agent asks 0G whether to buy ("pay", "ask the owner first" or "walk away") over structured facts, and logs
every decision's request id. The owner picks the 0G model per message: `glm-5.3` runs in a TEE and its proof is stored
with the decision, while `qwen3-vl-plus` has no TEE proof and is labelled that way. The robot's camera frames are
evidence, never decision input. The chip signs them and they go to 0G Storage as proof of work.

The chip holds the only spending key. It rebuilds the one-time payment voucher from the invoice itself, checks it
against its own policy and signs it. Our x402 facilitator settles the voucher through the DelegationManager, where Arc
checks every limit, replay and revocation. A purchase over the per-payment limit (a 2.00 thali against a 1.00 limit)
waits for the owner's fresh World approval. Deny or silence means nothing is paid, and the daily cap can't be lifted,
approved or not.

The robot speaks to its owner on Telegram: approval needed, paid, denied, revoked. Telegram may deny, never approve.
Revoking is one more passkey signature, after which the next payment fails on-chain. Every episode is uploaded to 0G
Storage and anchored in an `EpisodeLog` contract, and anyone can check one on a public proof page without signing in.

The duck is the first robot. The Radxa on it runs the chip, and its camera reads the invoice QR the café's ESP32 screen
shows. The same protocol drives a browser simulator duck that walks to the stall on 0G's navigation turns.

The one rule: **Arc is the authority.** Our servers coordinate and relay. They can delay a payment but never authorise,
steal or redirect one.

## How it's made

- Arc and the MetaMask Delegation Framework (v1.3.0 on Arc). The owner account is a `HybridDeleGator` deployed through
  `SimpleFactory` by our relayer on the first grant. Its signer is the owner's passkey (P-256, verified on Arc with the
  precompile at `0x100`). Grants are root delegations owner → chip with `ValueLte(0)`, `ERC20PeriodTransfer` (USDC, daily
  cap), `Timestamp` and our enforcer. Each payment is a leaf delegation chip → any beneficiary with `ExactExecution`
  (the exact USDC transfer), `Id` (the invoice hash, so a voucher pays once), `Timestamp` and `Redeemer` (our relayer).
  Revoke is a one-time owner → relayer delegation whose only execution is `disableDelegation(grant)`.
- Passkey signing without a wallet extension. The browser only calls `navigator.credentials`. The Worker verifies the
  WebAuthn assertion (`@simplewebauthn/server`), encodes it as the HybridDeleGator's WebAuthn signature over the EIP-712
  digest the DelegationManager checks, and confirms it with an ERC-1271 `isValidSignature` call on Arc before a grant
  counts as active. There is no viem or wallet kit in the browser, and the whole web bundle is under 150 KB gzip.
- `RobotPaymentPolicyEnforcer` (Solidity, Foundry; shown in Arc Studio:
  https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75) holds the per-payment cap, the payee allowlist and an
  approver. The approver's EIP-712 approval (invoice hash, payee, amount, expiry, nonce) unlocks one over-limit payment,
  or one to a payee off the allowlist. The demo uses only the per-payment limit.
- x402 with ERC-7710. Our merchant answers `402` with `assetTransferMethod: erc7710` requirements, and the payment
  payload is the permission context (leaf + grant). Our facilitator verifies the chain off-chain, simulates from the
  relayer, keys every send in D1 (`settle:<invoiceHash>`) so a settlement happens once, and returns Arc's revert reasons
  verbatim. The gate shows OPEN only on an Ed25519-signed "paid" status.
- 0G. The Robot Agent calls 0G Compute's chat completions with a single `decide` tool (`pay` / `ask_human` /
  `walk_away`), temperature 0, and a 10 s budget. Any failure ends the errand in `safe_stop` and nothing is paid. There
  is no automatic fallback between models, only one retry after a 429 inside the 10 s budget. The owner picks the model
  per message. With `glm-5.3`, a TeeML provider in 0G's registry, the Worker fetches each decision's TEE signature,
  recovers the signer against the registered TEE address and stores the proof with the decision. `qwen3-vl-plus` has no
  TEE proof and the decision says so. Request ids and response keys are logged per decision. Episodes and the
  chip-signed camera frames go to 0G Storage and `EpisodeLog.record` on 0G Chain. The simulator duck's walking is 0G
  too, one chat completion per navigation turn.
- Public proofs. <https://vitaquack.com/app/proofs> lists every errand on 0G, and `/app/proofs/<episodeId>` shows one
  without a sign-in. The page downloads the episode JSON from 0G Storage by its root and renders the 0G decision (model,
  request id, action, reason, TEE signer), the Arc payment and the chip-signed camera frame. "Verify against 0G" runs in
  the reader's browser: one `eth_call` of `EpisodeLog.records` on 0G Chain's public RPC, then it checks that a record
  exists, that its root is the one the file was downloaded by, that its request-ids hash equals keccak256 of the file's
  `requestIds`, and that the file is this episode's. Each frame is downloaded by root and its SHA-256 checked against
  the digest the chip signed. The API behind it is `GET /api/proofs` and `GET /api/proofs/:id`.
- Telegram. `@vitaquack_bot` tells the owner when the robot needs an approval (with a button to the approval page and a
  fail-safe Deny), when it paid, was refused or lost its allowance. Messages go through a D1 outbox delivered after the
  request, so a failed message never delays a payment.
- World Agent Pass. Over-limit payments need a fresh World IdP authentication bound to that payment through the OIDC
  `nonce`. The backend verifies the RS256 ID token (Orb `acr` with a fresh `auth_time`, `jti` once, the bound `sub`;
  `amr` recorded) and co-signs that one approval (`docs/world-debrief.md`).
- Foundation. Bun workspaces, Effect 4, Foldkit (Elm-style TypeScript UI with server rendering), Alchemy on Cloudflare
  Workers, D1. Robot coordination is Effect services over D1 with HTTPS long-polling. The chip holds a 35 s lease, and
  without one it stops its motors and refuses to sign.
- The chip. `apps/chip` (Bun) holds a secp256k1 key, pairs with an 8-character code and an EIP-191 proof, long-polls
  for sign requests and enforces its own policy before touching the key. The Radxa Zero 3W on the duck is the hardware
  seam for the same protocol (bench C1 signed the payment voucher on it, `docs/spikes/hardware-results.md`). The café's
  ESP32 screen pulls the counter's displayed invoice (`GET /api/merchants/duck-cafe/counter`), draws its QR and verifies
  the Ed25519-signed status on-device. The café owner puts an item on the screen from the till at cafe.vitaquack.com.
  The owner's "Get me a chai" becomes an intent the next scan claims, so 0G decides against what the owner asked for:
  chai shown, pay; samosa shown, walk away; thali shown, ask the owner.

## Prize tracks

### Arc: Advanced Stablecoin Logic

USDC on Arc mainnet is the money and Arc is the only spending authority. The DelegationManager and our enforcer check
the daily and per-payment caps, the payee allowlist, replay protection, expiry, revocation and the human-approval
requirement when a payment lands.

Proven on mainnet: a chip-signed payment settled under a grant, its replay refused (`IdEnforcer:id-already-used`), the
grant revoked and the next payment refused (`CannotUseADisabledDelegation`). Settle
[0xb10354e0…155a](https://explorer.arc.io/tx/0xb10354e0d414463d24b444991e105e8c42d57c48a90ff84dc52d71617c03155a),
revoke [0x04f6994c…fb87](https://explorer.arc.io/tx/0x04f6994cf6c2bb7b46650d38ea27aac779849f9307ab9ecc406708bd1cf7fb87)
(`docs/evidence/2026-11-06-smoke.md`). Our `RobotPaymentPolicyEnforcer` is at
`0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3` (`docs/evidence/contracts.md`). A passkey-signed grant on the deployed app
ran its account deploy and ERC-1271 check on Arc
[0xddd15708…4a0b](https://explorer.arc.io/tx/0xddd15708400a776ba01c383aede146e83d737c6e6bf815269d3e77e59cbf4a0b)
(`docs/evidence/2026-11-06-deployed-e2e.md`, `docs/evidence/2026-11-06-deployed-browser.md`).

Arc Studio project: https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75 (both contracts, 42 Foundry tests,
Arc testnet deployments `0xf334…d711` / `0xe701…3579`, a page reading the live enforcer).

The whole journey ran through the deployed pages with every decision from 0G Compute
(`docs/evidence/2026-11-06-deployed-browser.md`, run 7). A passkey-granted robot paid a chai
([0xa18da6c6…814a](https://explorer.arc.io/tx/0xa18da6c6aa0b5963839d53133c72dc0e75616450779e534efedc6d687090814a)) and
the gate opened on the merchant's signed status. An over-cap 0.50 USDC payment for a restricted item went through with
a co-signed approval (World stub, rehearsal)
([0xedeaf0e0…0548](https://explorer.arc.io/tx/0xedeaf0e06604c93a226f731a7499a9be7096813f209d6bac9ff96a8cb0790548)), and a
second one was denied with nothing signed. The grant was revoked with the passkey
([0x4f1ba8e1…8e02](https://explorer.arc.io/tx/0x4f1ba8e1625008ec90242657948a8291c495f86aa12011e7a2c7b4bc4afc8e02)) and
Arc refused the next chai (`CannotUseADisabledDelegation`).

### 0G: Physical AI (Agents with a Body)

0G is the robot's purchasing brain. Every errand is one `decide` call to 0G Compute over structured input (the item, the
invoice, the budget, the policy flags). Each decision is stored with its 0G request id and response key, and any 0G
failure is a safe stop, never a faked decision. Every episode is uploaded to 0G Storage and anchored in `EpisodeLog` on
0G Chain (Galileo testnet, which the 0G judges confirmed is fine for Storage and `EpisodeLog`). The decision loop, the
safe stop and the evidence queue are proven against a stub 0G on the native Worker
(`packages/server/test/RobotAcceptance.ts`). `EpisodeLog` is deployed on 0G Galileo (16602) at
`0x4C947E6D794C78d0F684e46EFC97f712E51a206A` (deploy tx
[0xe4eb07f3…bf69](https://chainscan-galileo.0g.ai/tx/0xe4eb07f387cc5a767c019f150cc7abca7424fa68ae092ab50fe1bc49b2bebf69),
code = build).

**Anyone can verify an errand.** <https://vitaquack.com/app/proofs> lists every errand on 0G (48 when we checked), and
`/app/proofs/<episodeId>` shows one with no sign-in. It downloads the episode JSON from 0G Storage by its root and shows
the 0G decision, the Arc payment and the chip-signed camera frame (also loaded from 0G Storage).
"Verify against 0G" runs in the reader's browser, reads `EpisodeLog.records` from 0G Chain's public RPC, and checks the
record, its root, the request-ids hash and each frame's SHA-256. Signed out on the deployed site (episode `nsgqpnlr2titi22icgmgntb5vi`) every check passed, and the browser only called the 0G indexer and the 0G RPC.

On the deployed app the decisions come from 0G Compute through the router (`router-api.0g.ai`). The owner picks the
model per message. `qwen3-vl-plus` is served by the router's own provider `0x000000003f486c7198d6203568a98d02b91f8044`,
which is not in the 0G service registry and so not TEE-verifiable. `glm-5.3` is a TeeML model from registry provider
`0xD179F4526064846dE9a9E9D93683AF75CB72E503`, 6/6 correct on the probe at 4 to 7 s. **Each glm-5.3 decision's TEE
signature was verified independently with 0G's SDK (`processResponse`) within minutes of the decision**
(`docs/evidence/2026-11-06-tee-verification.md`).

Each decision is logged with the router's request id. In the browser journey (run 7): chai `pay`
`5ca4a212-1beb-4243-adc7-158156e7c9f4`, the restricted item `ask_human` `d230ef16-35ed-4e03-96cf-4ac173b9d21d`
(approved, paid) and `7dcb97bb-f577-433f-a7b6-60e5aa8cdd64` (denied), chai after the revoke `pay`
`1b6b2840-b760-4421-9d1e-163e58160f37` (refused by Arc). The API driver's runs 9 and 10 show the same
(`docs/evidence/2026-11-06-deployed-e2e.md`).

Episodes on 0G Storage, anchored in `EpisodeLog` (6 Nov 12:55 IST, `docs/evidence/2026-11-06-evidence-upload.md`):
7 episodes with real 0G decisions. The run-7 chai (0G `pay`, request id `5ca4a212-…`) has root
`0xac43d8a46ecd28fe0596599298630594626b40719f051e99742b59f81a4d82dd`, record tx
[0xd5b631b8…261b](https://chainscan-galileo.0g.ai/tx/0xd5b631b87c388563d4fb750194149b8a24cab2af323c1e34224611e9fb38261b).
The approved restricted item (0G `ask_human`) has root `0x941e7adf…6b75`, record tx
[0xb3356c6d…cf09](https://chainscan-galileo.0g.ai/tx/0xb3356c6d0a3d79df4e2f51923b7bbad09c678b37c5f5d8ae66830e305302cf09).
The denied one has root `0x0ab938dc…fe90`, record tx
[0xc9e84b22…a4b0](https://chainscan-galileo.0g.ai/tx/0xc9e84b222e6e99a5a62b9482c759bb47ee9a51a9f3c2ff45c639b66302d2a4b0).
Each record's root and request-id hash were recomputed and match, and the downloaded bytes equal the app's payload. The
first uploaded episode (`hg2ouddwe2h5j6ekbrsn7grfja`, root `0x8db4ffc1…d5dd`, `EpisodeLog.record` `0xd2fe9e75…aa21`)
carries a rehearsal-brain decision.

Proof of robot work on 0G Storage (21:05 IST, `docs/evidence/2026-11-06-frames-on-0g.md`): 8 episodes and 6 chip-signed
camera frames uploaded. Each frame's root hash is recorded next to its sha256 in the anchored episode JSON, and one frame
was re-downloaded from the indexer outside our app with a matching sha256.

**0G drives a body.** The browser simulator duck walked to the chai stall on glm-5.3 navigation turns, its head camera
read the QR, 0G paid and Arc settled ([0x95338dc3…cfc4](https://explorer.arc.io/tx/0x95338dc3),
`docs/evidence/2026-11-06-sim-e2e.md`). A thali went `ask_human` and was denied, and a chai request with a samosa shown
walked away.

### World: Agent Pass

Over-limit purchases need the owner's fresh World approval, and the daily cap can't be lifted. The owner approves each
one with a fresh World ID authentication in World App, bound to the exact payment: the EIP-712 digest of {invoice,
payee, amount, expiry} is the OIDC nonce. The backend verifies the token (Orb `acr` with a fresh `auth_time`, `jti`
once, `sub` bound to the wallet; `amr` recorded) and co-signs that single payment, which our Arc enforcer requires.
Denial or a 300 s timeout means nothing is ever signed.

The verifier and the approval flow are proven in tests (`packages/server/test/World.test.ts`, scene tests). We
rehearsed on the deployed app through the real pages with the in-Worker stub issuer, which is not World: 0G asked the
owner, a 0.50 USDC over-cap payment for a restricted item was approved, co-signed and paid on Arc
([0xedeaf0e0…0548](https://explorer.arc.io/tx/0xedeaf0e06604c93a226f731a7499a9be7096813f209d6bac9ff96a8cb0790548)), and a
second one was denied with nothing signed (`docs/evidence/2026-11-06-deployed-browser.md`, run 7; runs 5 and 6 with the
rehearsal brain).

**Live with a real Orb ID (6 Nov 14:55 IST).** Kris, with his own passkey wallet on a MacBook and World App on his
phone, approved a 0.50 USDC restricted payment that 0G had sent to him (`ask_human`). World's token (`acr`
`https://world.org/oidc/acr/orb`, `amr` `["pop","user","mfa"]`) was accepted, the approver co-signed and Arc settled it
with the enforcer's `PaymentApproved`
([0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9);
`docs/evidence/2026-11-06-live-world.md`). His attempt before the `amr` fix was refused and nothing was paid (the top
item of the debrief).

The deny path has two doors, and both end with nothing signed: No on the approval page or in the robot's conversation,
and Deny under the Telegram message (only from the chat linked to the wallet, only while the approval waits).
_Fill in: the live World deny on vitaquack.com._ Debrief: `docs/world-debrief.md`.

## Links

- Repository: <https://github.com/grmkris/eth-global-mumbai-2026>
- Live: <https://vitaquack.com/> (landing), <https://vitaquack.com/app/> (the wallet), <https://cafe.vitaquack.com> (the café
  till), <https://vitaquack.com/sim/> (the simulator duck), <https://vitaquack.com/shop/> (the shop, USDC on Arc); the API
  is <https://vitaquack.com/api/>
- Public proofs, no sign-in: <https://vitaquack.com/app/proofs> (every errand on 0G) and `/app/proofs/<episodeId>` with
  "Verify against 0G"
- Architecture and status board: <https://vitaquack.com/plan/architecture/>; plan: <https://vitaquack.com/plan/plan/>;
  pitch: <https://vitaquack.com/plan/pitch/>
- Contracts: `RobotPaymentPolicyEnforcer` `0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3` (Arc mainnet, 5042), `EpisodeLog`
  `0x4C947E6D794C78d0F684e46EFC97f712E51a206A` (0G Galileo, 16602); Arc Studio
  <https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75>
- Demo walkthrough: `docs/demo.md`; evidence index: `docs/evidence/README.md`
- Video (2:30 to 2:59, ≥ 720p, real narration): _fill in: the video link_ (storyboard: `docs/video-script.md`)

## Code that predates the event

The application shell was imported on 5 Nov 2026 as a single commit from the public
[`grmkris/styld.app`](https://github.com/grmkris/styld.app) repository at commit `370a0e23` (Bun workspaces, Effect 4,
Alchemy on Cloudflare, Foldkit, D1/R2, quality gates). It contains no product logic; Styld's product was never part of
this repo. Everything about wallets, grants, robots, merchants, chips, World and 0G was written during the event, in
small commits. Research notes under `docs/research/` and the spike code under `docs/research/spikes/` were produced
during the event too.

## What is not finished

- The live World deny on vitaquack.com: _fill in_. The live approve is done (6 Nov 14:55 IST,
  [0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9)).
- The full run on vitaquack.com with the real duck, the Radxa chip and the ESP32 counter screen (sign-up → chai pays →
  thali approve → thali deny → walk away → revoke): _fill in_, recorded in `docs/evidence/demo-run.md`. Until then the
  hardware beats are proven natively and on the simulator, not on stage. Passkeys are bound to the host, so the owner
  signs up again on vitaquack.com.
- In the demo the simulator duck walks to the till; the real duck scans the counter screen.
- On-chain verification of the World token (the S5b prototype) is a stretch. The backend co-signer is what runs.

## §12 checklist

| Item | Status |
| --- | --- |
| Name and description | above |
| Public GitHub with real history, the predating-code section | repo + README "Code that predates the event" |
| Demo video 2–4 min, ≥ 720p, real narration, ≤ 4 bullets per slide | _record from `docs/video-script.md`_ |
| Up to 3 partner prizes with integration + feedback | Arc, 0G, World above; World debrief in `docs/world-debrief.md` |
| Arc: shareable Studio URL, Studio in the demo, working frontend + backend, architecture diagram, Arc/Circle tools named | Studio URL https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75; the rest above |
| 0G: 0G call in the loop, Storage episode log with request ids, safe stop, contract addresses, README setup, video < 3 min | `EpisodeLog` `0x4C947E6D794C78d0F684e46EFC97f712E51a206A` (Galileo); router request ids `5ca4a212…`, `d230ef16…`, `7dcb97bb…`, `1b6b2840…` (browser evidence run 7); 0G-decided episodes on Storage (`2026-11-06-evidence-upload.md`), glm-5.3 TEE proofs verified (`2026-11-06-tee-verification.md`), camera frames on Storage (`2026-11-06-frames-on-0g.md`), the simulator duck driven by 0G (`2026-11-06-sim-e2e.md`); public proofs with in-browser verification at https://vitaquack.com/app/proofs |
| World: official Agent Pass, full journey incl. deny/expired, backend validation, debrief | live approve with a real Orb ID → paid ([0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9); `docs/evidence/2026-11-06-live-world.md`), live deny _fill in_; stub rehearsal of both (browser evidence run 7); debrief `docs/world-debrief.md` |
