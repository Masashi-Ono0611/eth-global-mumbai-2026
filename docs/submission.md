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

The owner signs up with a passkey, which signs for a MetaMask `HybridDeleGator` smart account on Arc mainnet. One
passkey signature grants a robot's chip a delegation with a daily cap, a per-payment cap, a payee allowlist and an
expiry. When the duck scans a café's invoice QR, its agent asks 0G whether to pay, ask the owner or walk away. The chip
holds the only spending key: it rebuilds the payment voucher from the invoice, checks its own policy and signs. Our x402
facilitator settles it on Arc, which checks every limit, replay and revocation.

A purchase over the per-payment limit (a 2.00 thali against a 1.00 limit) waits for the owner's fresh World approval.
Deny or silence means nothing is paid, and the daily cap can't be lifted. The robot tells its owner on Telegram, which
may deny but never approve. Revoking is one more passkey signature, and the next payment fails on-chain. Every episode,
with the chip-signed camera frames, goes to 0G Storage and is anchored in an `EpisodeLog` contract, and anyone can check
one on a public proof page. The duck is the first robot; a browser simulator duck runs the same protocol.

The one rule: **Arc is the authority.** Our servers coordinate and relay. They can delay a payment but never authorise,
steal or redirect one.

## How it's made

- Arc and the MetaMask Delegation Framework (v1.3.0 on Arc). Our relayer deploys the `HybridDeleGator` through
  `SimpleFactory` on the first grant; its signer is the passkey (P-256, verified with the precompile at `0x100`).
  Grants are root delegations owner → chip with `ValueLte(0)`, `ERC20PeriodTransfer` (USDC, daily cap), `Timestamp`
  and our enforcer. Each payment is a leaf delegation chip → any beneficiary with `ExactExecution`, `Id` (the invoice
  hash, so a voucher pays once), `Timestamp` and `Redeemer` (our relayer). Revoke is a one-time owner → relayer
  delegation whose only execution is `disableDelegation(grant)`.
- Passkeys without a wallet extension. The browser only calls `navigator.credentials`. The Worker verifies the assertion
  (`@simplewebauthn/server`), encodes it as the HybridDeleGator's WebAuthn signature over the EIP-712 digest, and checks
  it with ERC-1271 `isValidSignature` on Arc before a grant counts. No viem or wallet kit in the browser; the web bundle
  is under 150 KB gzip.
- `RobotPaymentPolicyEnforcer` (Solidity, Foundry, built in Arc Studio) holds the per-payment cap, the payee allowlist
  and an approver whose EIP-712 approval (invoice hash, payee, amount, expiry, nonce) unlocks one over-limit payment.
- x402 with ERC-7710. The merchant answers `402` with `assetTransferMethod: erc7710`; the payload is the permission
  context (leaf + grant). The facilitator verifies off-chain, simulates, keys every send in D1 (`settle:<invoiceHash>`)
  so it settles once, and returns Arc's revert reasons verbatim. The gate opens only on an Ed25519-signed "paid".
- 0G Compute. One `decide` tool (`pay` / `ask_human` / `walk_away`) over structured input, temperature 0, a 10 s
  budget, one retry after a 429 and no fallback; any failure ends the errand in `safe_stop`. The owner picks the model
  per message: `glm-5.3` (TEE proof fetched, signer recovered and stored with the decision) or `qwen3-vl-plus` (no TEE
  proof, labelled so). The decision never sees an image.
- Telegram. `@vitaquack_bot` sends approval requests (with a fail-safe Deny), receipts and revocations from a D1 outbox,
  so a failed message never delays a payment.
- World Agent Pass. The OIDC `nonce` binds a fresh World IdP authentication to one payment; the backend verifies the
  RS256 ID token (Orb `acr` with a fresh `auth_time`, `jti` once, the bound `sub`; `amr` recorded) and co-signs.
- Foundation. Bun, Effect 4, Foldkit (server-rendered TypeScript UI), Alchemy on Cloudflare Workers, D1. Robot
  coordination is Effect services over D1 with HTTPS long-polling; without its 35 s lease the chip stops its motors and
  refuses to sign.
- Hardware. `apps/chip` (Bun) holds a secp256k1 key, pairs with an 8-character code and an EIP-191 proof. The Radxa
  Zero 3W on the duck runs it (bench C1 signed a voucher on it, `docs/spikes/hardware-results.md`). The café's ESP32
  screen pulls the counter invoice (`GET /api/merchants/duck-cafe/counter`), draws its QR and verifies the signed status
  on-device; the till at cafe.vitaquack.com puts an item on it. "Get me a chai" becomes an intent the next scan claims:
  chai shown, pay; samosa shown, walk away; thali shown, ask the owner.

## Prize tracks

### Arc: Advanced Stablecoin Logic

USDC on Arc mainnet is the money, and every limit, the approval requirement and revocation are enforced on Arc by the
DelegationManager and our `RobotPaymentPolicyEnforcer` (`0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3`,
`docs/evidence/contracts.md`). Arc Studio project: https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75 (both
contracts, 42 Foundry tests, Arc testnet deployments `0xf334…d711` / `0xe701…3579`, a page reading the live enforcer).

- A chip-signed payment settled, its replay was refused (`IdEnforcer:id-already-used`), and after the revoke the next
  payment was refused (`CannotUseADisabledDelegation`): settle
  [0xb10354e0…155a](https://explorer.arc.io/tx/0xb10354e0d414463d24b444991e105e8c42d57c48a90ff84dc52d71617c03155a),
  revoke [0x04f6994c…fb87](https://explorer.arc.io/tx/0x04f6994cf6c2bb7b46650d38ea27aac779849f9307ab9ecc406708bd1cf7fb87)
  (`docs/evidence/2026-11-06-smoke.md`).
- A passkey-signed grant on the deployed app ran its account deploy and ERC-1271 check on Arc
  [0xddd15708…4a0b](https://explorer.arc.io/tx/0xddd15708400a776ba01c383aede146e83d737c6e6bf815269d3e77e59cbf4a0b)
  (`docs/evidence/2026-11-06-deployed-e2e.md`).
- The whole journey through the deployed pages with 0G decisions (`docs/evidence/2026-11-06-deployed-browser.md`, run
  7): chai paid
  ([0xa18da6c6…814a](https://explorer.arc.io/tx/0xa18da6c6aa0b5963839d53133c72dc0e75616450779e534efedc6d687090814a)),
  an over-cap 0.50 USDC payment paid with a co-signed approval (World stub)
  ([0xedeaf0e0…0548](https://explorer.arc.io/tx/0xedeaf0e06604c93a226f731a7499a9be7096813f209d6bac9ff96a8cb0790548)), a
  second one denied with nothing signed, the grant revoked
  ([0x4f1ba8e1…8e02](https://explorer.arc.io/tx/0x4f1ba8e1625008ec90242657948a8291c495f86aa12011e7a2c7b4bc4afc8e02)) and
  the next chai refused by Arc.

### 0G: Physical AI (Agents with a Body)

0G is the robot's brain and its memory: every errand is one 0G Compute decision, a 0G failure is a safe stop, and every
episode is uploaded to 0G Storage and anchored in `EpisodeLog` on 0G Galileo (16602)
`0x4C947E6D794C78d0F684e46EFC97f712E51a206A` (deploy tx
[0xe4eb07f3…bf69](https://chainscan-galileo.0g.ai/tx/0xe4eb07f387cc5a767c019f150cc7abca7424fa68ae092ab50fe1bc49b2bebf69),
code = build). The 0G judges confirmed Galileo is fine for Storage and `EpisodeLog`.

- **Anyone can verify an errand.** <https://vitaquack.com/app/proofs> lists every errand on 0G, and "Verify against 0G"
  on `/app/proofs/<episodeId>` checks the anchor and each frame's SHA-256 from the reader's browser, with no sign-in
  (`docs/evidence/2026-11-07-public-proofs.md`).
- Decisions come from 0G Compute through the router (`router-api.0g.ai`). `glm-5.3` is a TeeML model from registry
  provider `0xD179F4526064846dE9a9E9D93683AF75CB72E503`, and **each glm-5.3 decision's TEE signature was verified
  independently with 0G's SDK (`processResponse`)** (`docs/evidence/2026-11-06-tee-verification.md`). `qwen3-vl-plus`
  is served by the router's own provider `0x000000003f486c7198d6203568a98d02b91f8044`, which is not in the registry and
  so not TEE-verifiable.
- Request ids from the browser journey (run 7): chai `pay` `5ca4a212-1beb-4243-adc7-158156e7c9f4`, the over-cap item
  `ask_human` `d230ef16-35ed-4e03-96cf-4ac173b9d21d` (approved, paid) and `7dcb97bb-f577-433f-a7b6-60e5aa8cdd64`
  (denied), chai after the revoke `pay` `1b6b2840-b760-4421-9d1e-163e58160f37` (refused by Arc); the API driver's runs 9
  and 10 match (`docs/evidence/2026-11-06-deployed-e2e.md`).
- Episodes with real 0G decisions on Storage and anchored, roots and request-id hashes recomputed and matching
  (`docs/evidence/2026-11-06-evidence-upload.md`): the run-7
  chai, root `0xac43d8a46ecd28fe0596599298630594626b40719f051e99742b59f81a4d82dd`, record tx
  [0xd5b631b8…261b](https://chainscan-galileo.0g.ai/tx/0xd5b631b87c388563d4fb750194149b8a24cab2af323c1e34224611e9fb38261b);
  the approved one, root `0x941e7adf…6b75`, record tx
  [0xb3356c6d…cf09](https://chainscan-galileo.0g.ai/tx/0xb3356c6d0a3d79df4e2f51923b7bbad09c678b37c5f5d8ae66830e305302cf09);
  the denied one, root `0x0ab938dc…fe90`, record tx
  [0xc9e84b22…a4b0](https://chainscan-galileo.0g.ai/tx/0xc9e84b222e6e99a5a62b9482c759bb47ee9a51a9f3c2ff45c639b66302d2a4b0).
- Chip-signed camera frames are on 0G Storage as proof of work, each root recorded next to its sha256 in the anchored
  episode JSON (`docs/evidence/2026-11-06-frames-on-0g.md`).
- **0G drives a body.** The simulator duck walked to the chai stall on glm-5.3 navigation turns, read the QR, and 0G
  paid ([0x95338dc3…cfc4](https://explorer.arc.io/tx/0x95338dc3), `docs/evidence/2026-11-06-sim-e2e.md`).

### World: Agent Pass

Over-limit payments need the owner's fresh World ID authentication in World App, bound to the exact payment: the
EIP-712 digest of {invoice, payee, amount, expiry} is the OIDC nonce. Our Arc enforcer requires the co-signed approval,
and denial or a 300 s timeout means nothing is signed. The verifier and the flow are tested
(`packages/server/test/World.test.ts`, scene tests).

- **Live with a real Orb ID (6 Nov 14:55 IST).** Kris approved a 0.50 USDC payment 0G had sent him (`ask_human`);
  World's token (`acr` `https://world.org/oidc/acr/orb`, `amr` `["pop","user","mfa"]`) was accepted and Arc settled it
  with the enforcer's `PaymentApproved`
  ([0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9),
  `docs/evidence/2026-11-06-live-world.md`).
- Rehearsed with the in-Worker stub issuer: approve paid
  ([0xedeaf0e0…0548](https://explorer.arc.io/tx/0xedeaf0e06604c93a226f731a7499a9be7096813f209d6bac9ff96a8cb0790548)),
  deny signed nothing (`docs/evidence/2026-11-06-deployed-browser.md`, run 7).
- Deny works from the approval page, the robot's conversation, or Telegram (only from the linked chat, only while the
  approval waits). _Fill in: the live World deny on vitaquack.com._
- Debrief: `docs/world-debrief.md`.

## Links

- Repository: <https://github.com/grmkris/eth-global-mumbai-2026>
- Live: <https://vitaquack.com/> (landing), <https://vitaquack.com/app/> (the wallet), <https://cafe.vitaquack.com> (the café
  till), <https://vitaquack.com/sim/> (the simulator duck), <https://vitaquack.com/shop/> (the shop, USDC on Arc); the API
  is <https://vitaquack.com/api/>
- Public proofs, no sign-in: <https://vitaquack.com/app/proofs>
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

- The live World deny on vitaquack.com: _fill in_.
- The full run on vitaquack.com with the real duck, the Radxa chip and the ESP32 counter screen (sign-up → chai pays →
  thali approve → thali deny → walk away → revoke): _fill in_, recorded in `docs/evidence/demo-run.md`. Until then the
  hardware beats are proven natively and on the simulator.
- On-chain verification of the World token (the S5b prototype) is a stretch; the backend co-signer is what runs.

## §12 checklist

| Item | Status |
| --- | --- |
| Name and description | above |
| Public GitHub with real history, the predating-code section | repo + README "Code that predates the event" |
| Demo video 2–4 min, ≥ 720p, real narration, ≤ 4 bullets per slide | _record from `docs/video-script.md`_ |
| Up to 3 partner prizes with integration + feedback | Arc, 0G, World above; World debrief in `docs/world-debrief.md` |
| Arc: shareable Studio URL, Studio in the demo, working frontend + backend, architecture diagram, Arc/Circle tools named | Studio URL above; the rest above |
| 0G: 0G call in the loop, Storage episode log with request ids, safe stop, contract addresses, README setup, video < 3 min | 0G track above |
| World: official Agent Pass, full journey incl. deny/expired, backend validation, debrief | live approve paid (`docs/evidence/2026-11-06-live-world.md`), live deny _fill in_; stub rehearsal of both; debrief `docs/world-debrief.md` |
