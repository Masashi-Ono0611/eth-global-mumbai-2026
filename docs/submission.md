# ETHGlobal Mumbai submission (form text)

Checklist: `docs/spec.md` §12. Fields marked _fill in_ wait for a run that has not happened yet; never submit them as
claims.

## Project name

**Vitaquack**

## Tagline

Don't give a robot your wallet. Give it a budget.

## Short description

A passkey wallet on Arc grants a robot's chip a capped USDC budget. The robot asks 0G what to buy, its chip signs every
payment, and Arc enforces every limit; restricted items need the owner's fresh approval in World App.

## Description

Robots that run errands need to pay, but handing a robot a funded key is handing it your wallet. Vitaquack gives it a
budget instead. The owner signs up with a passkey, which is also the signer of a MetaMask `HybridDeleGator` smart account
on Arc mainnet. One passkey signature grants a robot's chip a delegation with caveats: a daily cap, a per-payment cap,
an allowlist of payees and an expiry, plus our own `RobotPaymentPolicyEnforcer`, which demands an approval for anything
over the cap or to an unlisted payee. The robot's agent asks 0G whether to buy ("pay", "ask the owner first" or "walk
away") over structured facts, never camera frames, and logs every decision's request id. The chip holds the only
spending key: it rebuilds the one-time payment voucher from the invoice itself, checks it against its own policy and
signs it. Our x402 facilitator settles the voucher through the DelegationManager, where Arc checks every limit, replay
and revocation. A restricted item (a mock cigarette pack) waits for the owner to approve it in World App; deny or
silence means nothing is paid. Revoking is one more passkey signature, after which the next payment fails on-chain.
Every episode is uploaded to 0G Storage and anchored in an `EpisodeLog` contract. The duck is the first robot; the
first iteration is fully virtual (a mock chip and a web gate); the Radxa on the duck is the hardware seam for the same chip protocol.

The one rule: **Arc is the authority.** Our servers coordinate and relay; they can never authorise, steal or redirect a
payment, only delay it.

## How it's made

- **Arc + MetaMask Delegation Framework (v1.3.0 on Arc).** The owner account is a `HybridDeleGator` deployed through
  `SimpleFactory` by our relayer on the first grant; its signer is the owner's passkey (P-256, verified on Arc with the
  precompile at `0x100`). Grants are root delegations owner → chip with `ValueLte(0)`, `ERC20PeriodTransfer` (USDC, daily
  cap), `Timestamp` and our enforcer. Each payment is a leaf delegation chip → any beneficiary with `ExactExecution`
  (the exact USDC transfer), `Id` (the invoice hash, so a voucher pays once), `Timestamp` and `Redeemer` (our relayer).
  Revoke is a one-time owner → relayer delegation whose only execution is `disableDelegation(grant)`.
- **Passkey signing without a wallet extension.** The browser only calls `navigator.credentials`; the Worker verifies the
  WebAuthn assertion (`@simplewebauthn/server`), encodes it as the HybridDeleGator's WebAuthn signature over the EIP-712
  digest the DelegationManager checks, and confirms it with an ERC-1271 `isValidSignature` call on Arc before a grant
  counts as active. No viem or wallet kit in the browser (the whole web bundle is under 150 KB gzip).
- **`RobotPaymentPolicyEnforcer`** (Solidity, Foundry; shown in Arc Studio: https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75): per-payment cap, payee allowlist and an
  approver whose EIP-712 approval (invoice hash, payee, amount, expiry, nonce) unlocks one over-limit or restricted
  payment.
- **x402 with ERC-7710.** Our merchant answers `402` with `assetTransferMethod: erc7710` requirements; the payment
  payload is the permission context (leaf + grant). Our facilitator verifies the chain off-chain, simulates from the
  relayer, keys every send in D1 (`settle:<invoiceHash>`) so a settlement happens once, and returns Arc's revert reasons
  verbatim. The gate shows OPEN only on an Ed25519-signed "paid" status.
- **0G.** The Robot Agent calls 0G Compute's chat completions with a single `decide` tool (`pay` / `ask_human` /
  `walk_away`), temperature 0, a 10 s budget; any failure ends the errand in `safe_stop` and nothing is paid. Request
  ids and response keys are logged per decision; episodes go to 0G Storage and `EpisodeLog.record` on 0G Chain.
- **World Agent Pass.** Restricted or over-limit payments need a fresh World IdP authentication bound to that payment
  through the OIDC `nonce`; the backend verifies the RS256 ID token (Orb `acr` with a fresh `auth_time`, `jti` once, the
  bound `sub`; `amr` recorded) and co-signs that one approval (`docs/world-debrief.md`).
- **Foundation.** Bun workspaces, Effect 4, Foldkit (Elm-style TypeScript UI with server rendering), Alchemy on
  Cloudflare Workers, D1. Robot coordination is Effect services over D1 with HTTPS long-polling (35 s chip lease: no
  lease → the chip stops its motors and refuses to sign). Five languages (English, Slovenian, Japanese, Hindi, Marathi).
- **The chip.** `apps/chip` (Bun) holds a secp256k1 key, pairs with an 8-character code and an EIP-191 proof,
  long-polls for sign requests and enforces its own policy before touching the key. The Radxa Zero 3W on the duck is the
  hardware seam for the same protocol (bench C1 signed the payment voucher on it, `docs/spikes/hardware-results.md`); the
  ESP32 gate is designed to draw the invoice QR and verify the signed status with the published gate key.

## Prize tracks

### Arc — Advanced Stablecoin Logic

USDC on Arc mainnet is the money and Arc is the only spending authority: daily and per-payment caps, the payee
allowlist, replay protection, expiry, revocation and the human-approval requirement are all checked by the
DelegationManager and our enforcer when a payment lands. Proven on mainnet: a chip-signed payment settled under a
grant, its replay refused (`IdEnforcer:id-already-used`), the grant revoked and the next payment refused
(`CannotUseADisabledDelegation`) — settle
[0xb10354e0…155a](https://explorer.arc.io/tx/0xb10354e0d414463d24b444991e105e8c42d57c48a90ff84dc52d71617c03155a),
revoke [0x04f6994c…fb87](https://explorer.arc.io/tx/0x04f6994cf6c2bb7b46650d38ea27aac779849f9307ab9ecc406708bd1cf7fb87)
(`docs/evidence/2026-11-06-smoke.md`); our `RobotPaymentPolicyEnforcer` at
`0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3` (`docs/evidence/contracts.md`); a passkey-signed grant on the deployed app
whose account deploy and ERC-1271 check ran on Arc
[0xddd15708…4a0b](https://explorer.arc.io/tx/0xddd15708400a776ba01c383aede146e83d737c6e6bf815269d3e77e59cbf4a0b)
(`docs/evidence/2026-11-06-deployed-e2e.md`, `docs/evidence/2026-11-06-deployed-browser.md`). Arc Studio project:
https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75 (both contracts, 42 Foundry tests, Arc testnet deployments `0xf334…d711` / `0xe701…3579`, a page reading the live enforcer). The whole journey through the deployed pages, with every decision from 0G Compute (`docs/evidence/2026-11-06-deployed-browser.md`, run 7): a passkey-granted robot paid a chai ([0xa18da6c6…814a](https://explorer.arc.io/tx/0xa18da6c6aa0b5963839d53133c72dc0e75616450779e534efedc6d687090814a)), the gate opened on the merchant's signed status, a restricted, over-cap 0.50 USDC payment went through with a co-signed approval (World stub, rehearsal) ([0xedeaf0e0…0548](https://explorer.arc.io/tx/0xedeaf0e06604c93a226f731a7499a9be7096813f209d6bac9ff96a8cb0790548)), a second one was denied with nothing signed, the grant was revoked with the passkey ([0x4f1ba8e1…8e02](https://explorer.arc.io/tx/0x4f1ba8e1625008ec90242657948a8291c495f86aa12011e7a2c7b4bc4afc8e02)) and the next chai was refused by Arc (`CannotUseADisabledDelegation`).

### 0G — Physical AI (Agents with a Body)

0G is the robot's purchasing brain: every errand is one `decide` call to 0G Compute over structured input (the item,
the invoice, the budget, the policy flags), each decision stored with its 0G request id and response key, a safe stop on
any 0G failure (never a faked decision), and every episode uploaded to 0G Storage and anchored in `EpisodeLog` on 0G
Chain (Galileo). Proven: the decision loop, the safe stop and the evidence queue against a stub 0G on the native Worker
(`packages/server/test/RobotAcceptance.ts`). `EpisodeLog` is deployed on 0G Galileo (16602) at `0x4C947E6D794C78d0F684e46EFC97f712E51a206A` (deploy tx
[0xe4eb07f3…bf69](https://chainscan-galileo.0g.ai/tx/0xe4eb07f387cc5a767c019f150cc7abca7424fa68ae092ab50fe1bc49b2bebf69), code = build). On the deployed app the decisions come from **0G Compute** through the router
(`router-api.0g.ai`, `qwen3-vl-plus`, 0G provider `0x000000003f486c7198d6203568a98d02b91f8044`), each logged with the
router's request id: in the browser journey (run 7) chai `pay` `5ca4a212-1beb-4243-adc7-158156e7c9f4`, cigarettes
`ask_human` `d230ef16-35ed-4e03-96cf-4ac173b9d21d` (approved, paid) and `7dcb97bb-f577-433f-a7b6-60e5aa8cdd64` (denied),
chai after the revoke `pay` `1b6b2840-b760-4421-9d1e-163e58160f37` (refused by Arc); the same in the API driver's runs
9–10 (`docs/evidence/2026-11-06-deployed-e2e.md`). The first uploaded episode (`hg2ouddwe2h5j6ekbrsn7grfja`, root
`0x8db4ffc1…d5dd`, `EpisodeLog.record` `0xd2fe9e75…aa21`, `docs/evidence/2026-11-06-evidence-upload.md`) carries a
rehearsal-brain decision. Done (6 Nov 12:55 IST, `docs/evidence/2026-11-06-evidence-upload.md`): 7 episodes with real 0G decisions are on 0G Storage and anchored in `EpisodeLog`, e.g. the run-7 chai (0G `pay`, request id `5ca4a212-…`): root `0xac43d8a46ecd28fe0596599298630594626b40719f051e99742b59f81a4d82dd`, record tx [0xd5b631b8…261b](https://chainscan-galileo.0g.ai/tx/0xd5b631b87c388563d4fb750194149b8a24cab2af323c1e34224611e9fb38261b); the approved cigarettes (0G `ask_human`): root `0x941e7adf…6b75`, record tx [0xb3356c6d…cf09](https://chainscan-galileo.0g.ai/tx/0xb3356c6d0a3d79df4e2f51923b7bbad09c678b37c5f5d8ae66830e305302cf09); the denied one: root `0x0ab938dc…fe90`, record tx [0xc9e84b22…a4b0](https://chainscan-galileo.0g.ai/tx/0xc9e84b222e6e99a5a62b9482c759bb47ee9a51a9f3c2ff45c639b66302d2a4b0). Each record's root and request-id hash were recomputed and match; the downloaded bytes equal the app's payload.

### World — Agent Pass

The owner approves restricted or over-limit robot payments with a fresh World ID authentication in World App,
bound to the exact payment by using the EIP-712 digest of {invoice, payee, amount, expiry} as the OIDC nonce; the
backend verifies the token (Orb `acr` with a fresh `auth_time`, `jti` once, `sub` bound to the wallet; `amr` recorded) and
co-signs that single payment, which our Arc enforcer requires. Denial or a 300 s timeout means nothing is ever signed.
Proven: the verifier and the approval flow in tests (`packages/server/test/World.test.ts`, scene tests). Rehearsed on
the deployed app through the real pages with the in-Worker **stub issuer** (rehearsal only, not World): 0G asked the
owner, a 0.50 USDC restricted, over-cap payment was approved, co-signed and paid on Arc ([0xedeaf0e0…0548](https://explorer.arc.io/tx/0xedeaf0e06604c93a226f731a7499a9be7096813f209d6bac9ff96a8cb0790548)), and a second one
was denied with nothing signed (`docs/evidence/2026-11-06-deployed-browser.md`, run 7; runs 5–6 with the rehearsal
brain). **Live with a real Orb ID (6 Nov 14:55 IST):** Kris, with his own passkey wallet on a MacBook and World App on
his phone, approved a 0.50 USDC restricted payment that 0G had sent to him (`ask_human`); World's token (`acr`
`https://world.org/oidc/acr/orb`, `amr` `["pop","user","mfa"]`) was accepted, the approver co-signed and Arc settled it
with the enforcer's `PaymentApproved` ([0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9); `docs/evidence/2026-11-06-live-world.md`). His attempt before the `amr` fix was
refused and nothing was paid (the top item of the debrief). _Fill in: the live deny._ Debrief: `docs/world-debrief.md`.

## Links

- Repository: <https://github.com/grmkris/eth-global-mumbai-2026>
- Deployed app: <https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev>
- Architecture: <https://eth-mumbai-site.kristjan-grm11775.workers.dev/architecture/>
- Plan: <https://eth-mumbai-site.kristjan-grm11775.workers.dev/plan/>
- Demo walkthrough: `docs/demo.md`; evidence index: `docs/evidence/README.md`
- Video (2:30–2:59, ≥ 720p, real narration): _fill in_ (storyboard: `docs/video-script.md`)

## Code that predates the event

The application shell was imported on 5 Nov 2026 as a single commit from the public
[`grmkris/styld.app`](https://github.com/grmkris/styld.app) repository at commit `370a0e23` (Bun workspaces, Effect 4,
Alchemy on Cloudflare, Foldkit, D1/R2, quality gates). It contains no product logic; Styld's product was never part of
this repo. Everything about wallets, grants, robots, merchants, chips, World and 0G was written during the event, in
small commits. Research notes under `docs/research/` and the spike code under `docs/research/spikes/` were produced
during the event too.

## What is not finished (keep honest at submission time)

- A real 0G decision on the deployed app: done 6 Nov ≈ 12:36 IST (router `qwen3-vl-plus`, request ids in the 0G section; browser evidence run 7, e2e runs 9–10). Episodes with 0G decisions on 0G Storage: done 12:55 IST (`docs/evidence/2026-11-06-evidence-upload.md`).
- The evidence uploader against 0G Storage and `EpisodeLog` on Galileo: done 6 Nov 12:06 IST for the first paid episode `hg2ouddwe2h5j6ekbrsn7grfja` (root `0x8db4ffc1…d5dd`, storage tx `0x87d1be1f…12dc`, `EpisodeLog.record` tx `0xd2fe9e75…aa21`; `docs/evidence/2026-11-06-evidence-upload.md`). The decision in that episode came from the rehearsal brain, not 0G.
- A live World approve: done 6 Nov 14:55 IST ([0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9), `docs/evidence/2026-11-06-live-world.md`). The live deny: _fill in_.
- On-chain verification of the World token (the S5b prototype) is a stretch; the backend co-signer is what runs.
- The physical duck walking to the till; the virtual loop (mock chip + web gate) is the demo.

## §12 checklist

| Item | Status |
| --- | --- |
| Name and description | above |
| Public GitHub with real history, the predating-code section | repo + README "Code that predates the event" |
| Demo video 2–4 min, ≥ 720p, real narration, ≤ 4 bullets per slide | _record from `docs/video-script.md`_ |
| Up to 3 partner prizes with integration + feedback | Arc, 0G, World above; World debrief in `docs/world-debrief.md` |
| Arc: shareable Studio URL, Studio in the demo, working frontend + backend, architecture diagram, Arc/Circle tools named | Studio URL https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75; the rest above |
| 0G: 0G call in the loop, Storage episode log with request ids, safe stop, contract addresses, README setup, video < 3 min | `EpisodeLog` `0x4C947E6D794C78d0F684e46EFC97f712E51a206A` (Galileo); router request ids `5ca4a212…`, `d230ef16…`, `7dcb97bb…`, `1b6b2840…` (browser evidence run 7); a 0G-decided episode on Storage _fill in_ |
| World: official Agent Pass, full journey incl. deny/expired, backend validation, debrief | live approve with a real Orb ID → paid ([0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9); `docs/evidence/2026-11-06-live-world.md`), live deny _fill in_; stub rehearsal of both (browser evidence run 7); debrief `docs/world-debrief.md` |
