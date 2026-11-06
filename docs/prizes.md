# Prize tracks

Event: ETHGlobal Mumbai, 5–7 Nov 2026, Jio World Centre, BKC. **Submissions close Sat 7 Nov 09:00 IST, no late
entries.** ETHGlobal rules (checked Fri 6 Nov 04:15 IST): a project may enter at most **three** partner prizes and
**one** Arc track; the video is 2–4 min, ≥ 720p, real narration (0G asks for under 3 min); contract addresses are
listed in the submission; code that predates the event is disclosed (README → "Code that predates the event").

**Picks (decision D16, 6 Nov): Arc Advanced Stablecoin Logic + 0G Physical AI + World Agent Pass.** Maximum
$3k + $2.5k + $2.5k. Finalised at submission; the checklist is `docs/spec.md` §12.

## Arc — Advanced Stablecoin Logic ($3k track inside Arc's $15k pool)

**Why us:** a robot's USDC budget enforced by Arc contracts: daily cap, per-payment cap, payee allowlist, invoice
replay guard, expiry, revoke, human approval, all checked on-chain when the payment lands.

**Must:**

- Start in Arc Studio and include a shareable Studio URL; show Studio in the demo
- Working frontend + backend + an architecture diagram
- One Arc track only

**Ours:** Studio project https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75 (both contracts, 42 Foundry tests, Arc testnet deployments, a page on the live enforcer); `RobotPaymentPolicyEnforcer` deployed to Arc mainnet by us (Studio deploys to
testnet only; ask at the booth whether that is acceptable), our ERC-7710 x402 facilitator settling through
`redeemDelegations`, real transaction hashes in `docs/evidence/`.

## 0G — Physical AI: Agents with a Body ($5k: $2.5k / $1.5k / $1k)

**Why us:** the duck is a body that decides, pays and acts in the world; the decision comes from 0G.

**Must (prize text + our research notes):**

- A 0G Compute call inside the real decision loop (the `decide` tool call, standard providers), not decorative
- A log per decision with the 0G request id
- The episode log on **0G Storage** plus the `EpisodeLog` contract; contract addresses in the submission
- A real safe-stop: a failed 0G call ends the errand in `safe_stop`; never a faked decision
- Live demo at the 0G booth; video under 3 minutes

Booth question: may Storage and `EpisodeLog` run on Galileo testnet. Credits: we have them.

## World — World ID Agent Pass ($5k: $2.5k / $1.5k / $1k)

**Why us:** the robot needs its human for the moments that matter: a payment over the per-payment cap, or a
restricted item. Restricted means **a human approval, never an "age check"**.

**Must:**

- Official Agent Pass integration: World IdP OIDC, browser flow, `nonce` = the payment's hash
- The full journey: request → the owner approves in World App → the backend validates the token (`iss`, `aud`, `exp`,
  `nonce`, `auth_time`, `amr` has `pop`, `jti` once, `sub` = owner) → the protected action (the backend co-signs that
  one payment and it settles)
- A denied / expired / cancelled path where the payment does **not** happen
- Validate on the server, never trust the client alone
- A short integration debrief: time to first success, friction, one top improvement

Proofs may be mocked at the event; they are not production identity. IDKit is not entered (dropped with the 18+
registry). On-chain verification of the token on Arc is a stretch (S5b prototype), not the submission.

## Not entered

- Other Arc tracks (DeFi app, Marketplace Discovery, Bridge Kit, Continuity)
- **ENS: cut.** Names could sit on top of Arc later (`docs/research/worldchain-ens-alternative.md`)
- World IDKit
- Frame Transaction Alternative Mempool (needs EF alt-mempool devnets; fights the Arc mainnet story), CROPS, Hedera,
  Whitechain, Uniswap, 1inch, Definitive, Arkiv
