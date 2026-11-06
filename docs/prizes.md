# Prize tracks

Event: ETHGlobal Mumbai, 5 to 7 Nov 2026, Jio World Centre, BKC. **Submissions close Sat 7 Nov 09:00 IST, no late
entries.** ETHGlobal rules (checked Fri 6 Nov 04:15 IST): a project may enter at most three partner prizes and one Arc
track. The video is 2 to 4 min, ≥ 720p, with real narration (0G asks for under 3 min). Contract addresses are listed in
the submission, and code that predates the event is disclosed (README → "Code that predates the event").

Picks (decision D16, 6 Nov): Arc Advanced Stablecoin Logic, 0G Physical AI and World Agent Pass, at most $3k + $2.5k +
$2.5k. The checklist is `docs/spec.md` §12.

## Arc: Advanced Stablecoin Logic ($3k track inside Arc's $15k pool)

Why us: Arc contracts enforce a robot's USDC budget. The daily cap, per-payment cap, payee allowlist, invoice replay
guard, expiry, revoke and human approval are all checked on-chain when the payment lands.

Must:

- Start in Arc Studio and include a shareable Studio URL; show Studio in the demo
- Working frontend + backend + an architecture diagram
- One Arc track only

Ours: the Studio project https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75 (both contracts, 42 Foundry
tests, Arc testnet deployments, a page on the live enforcer). We deployed `RobotPaymentPolicyEnforcer` to Arc mainnet
from a pinned Studio pull, because Studio deploys to testnet only. Our ERC-7710 x402 facilitator settles through
`redeemDelegations`, and the real transaction hashes are in `docs/evidence/`.

## 0G: Physical AI, Agents with a Body ($5k: $2.5k / $1.5k / $1k)

Why us: the duck is a body that decides, pays and acts in the world, and the decision comes from 0G.

Must (prize text and our research notes):

- A 0G Compute call inside the real decision loop (the `decide` tool call, standard providers)
- A log per decision with the 0G request id
- The episode log on **0G Storage** plus the `EpisodeLog` contract; contract addresses in the submission
- A real safe stop: a failed 0G call ends the errand in `safe_stop`, never a faked decision
- Live demo at the 0G booth, and a video under 3 minutes

The 0G judges confirmed Galileo testnet is fine for Storage and `EpisodeLog` (Kris, 7 Nov). We have credits.

## World: World ID Agent Pass ($5k: $2.5k / $1.5k / $1k)

Why us: the robot needs its human when a payment is over the per-payment cap. The approval is a human decision, never
an "age check".

Must:

- Official Agent Pass integration: World IdP OIDC, browser flow, `nonce` = the payment's hash
- The full journey: request → the owner approves in World App → the backend validates the token (`iss`, `aud`, `exp`,
  `nonce`, the Orb `acr` with a fresh `auth_time`, `jti` once, `sub` = owner; `amr` is only recorded) → the protected
  action (the backend co-signs that one payment and it settles)
- A denied / expired / cancelled path where the payment does **not** happen
- Validate on the server and never trust the client alone
- A short integration debrief: time to first success, friction, one top improvement

Proofs may be mocked at the event and are not production identity. IDKit is not entered (dropped with the 18+
registry). On-chain verification of the token on Arc is a stretch (the S5b prototype) and is not in the submission.

## Not entered

- Other Arc tracks (DeFi app, Marketplace Discovery, Bridge Kit, Continuity)
- ENS (cut; names could sit on top of Arc later)
- Frame Transaction Alternative Mempool (needs EF alt-mempool devnets and conflicts with the Arc mainnet story), CROPS, Hedera,
  Whitechain, Uniswap, 1inch, Definitive, Arkiv
