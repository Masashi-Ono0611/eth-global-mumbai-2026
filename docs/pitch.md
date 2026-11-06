# Pitch: one story, four presentations

Working plan for the stage slot, the booth visits, the presentation page and the video. Written Fri 6 Nov 15:30 IST
and restructured 15:50 IST after Kris's direction. Submissions close **Sat 7 Nov 09:00 IST**. Facts come from
`docs/submission.md` and `docs/evidence/`; this file adds the framing only. Prize picks: decision D16 (`docs/prizes.md`).

**One line:** "Don't give a robot your wallet. Give it a budget."

## 1. Four presentations

There is one story, told in the same order every time, so a judge who sees two versions recognises it. Each audience
gets a different focus:

| Version | Audience | Focus | Shape |
| --- | --- | --- | --- |
| **Main** | ETHGlobal judges, the stage, the video | The story: how robots will pay. Sponsors stay in the background as credits | §2, about 4 min |
| **Arc** | Arc booth | What Arc brings us: programmable money, one balance and no custody handed out, the tooling | 60 s of story, then §4 |
| **World** | World booth | What World brings us: proof that a real human is behind the robot's big decisions | 60 s of story, then §5 |
| **0G** | 0G booth | What 0G brings us: 0G runs the AI and keeps the episodes | 60 s of story, then §6 |

There is only **one video**, and every judge watches it. It follows the main story; the sponsors appear as small credits
in captions, plus a short "under the hood" ending with what the tracks require (Arc Studio on screen, the 0G Storage
episode). That is already the shape of `docs/video-script.md`.

## 2. Main presentation: the story

Robots are starting to run errands. To pay, they would need your card or a funded wallet of their own. **Vitaquack is
an experiment in how robots will pay:** with your money, by your rules, and with you in the loop when it matters.

| # | Beat | What the audience sees | The line | Sponsor credit (small) |
| --- | --- | --- | --- | --- |
| 0 | **Why** | The duck | "Robots will run errands. Today they'd need your card. We tried something else." | — |
| 1 | **You have a wallet** | Sign up with a passkey and an address appears | "A wallet with no seed phrase: a passkey on your phone." | on Arc |
| 2 | **You add a robot to it** | Pairing code, then "paired · online" | "The duck gets its own wallet: a key on its chip that never leaves it." | — |
| 3 | **You give it a budget** | The grant sentence, one passkey signature | "The money stays in your wallet. The duck gets permission, not money: a dollar a day, thirty cents a payment, only at this café." | enforced on Arc |
| 4 | **It buys for you** | "Buy chai": it decides, the chip signs, it pays, the gate opens | "It decides, signs and pays by itself, inside the budget." | decided by 0G |
| 5 | **Bigger things ask you first** | 0.50, over the cap: your phone asks, you deny, then approve | "Over its limit, it has to ask. Say no and nothing is paid." | World ID |
| 6 | **You can see why** | The activity list: what it bought, why it decided that, who approved, the receipt | "Every decision has a reason you can read, and a receipt." | episodes on 0G |
| 7 | **You can stop it** | Revoke, then the next buy is refused | "One tap and it's cut off, and not even our servers can undo that." | Arc refuses |
| 8 | **What's next** | Many robots, one wallet | "Every robot gets a budget, not your wallet." | Arc · 0G · World |

Beats 0, 6, 7 and 8 are additions to Kris's list (wallet → robot → budget → buy → bigger needs approval → visibility).
They are suggestions: 0 and 8 give the story a frame, and 7 is its strongest proof. Beat 6 needs the work in §3.

## 3. Suggestions to make it better

These are ordered by value against the time left. Cost estimates are ours; nothing here is built yet.

1. **Show "why" on every activity row (beat 6).** Today the console shows 0G's reason, but only for the current
   errand. The wallet's Activity list (`apps/web/src/pages/Wallet.ts:107`) shows only the item, state, amount and tx.
   Add three things to each row: the decision and its reason, who approved it (World or the owner's own Deny), and a
   link to the episode on 0G Storage. That makes the visibility beat true, and it doubles as the 0G and World booth
   demos. About 1–2 h: a protocol field, the view, i18n in 5 languages.
2. **Show "spent today, left today" read from Arc.** `ERC20PeriodTransferEnforcer.getAvailableAmount` returns what the
   duck can still spend in the current period. The robot card would show "0.60 of 1.00 spent today". The number comes
   from the contract that enforces the limit, so the UI cannot drift from what Arc will allow. That is beat 3 made
   visible, and the Arc booth's best single screen. About 1–2 h.
3. **Use the card-with-limits analogy.** "It's like giving someone a card on your account with a limit": everyone
   already understands that. The new part is that the limit is enforced by the chain, not by a bank.
4. **Keep the robot on the table as a prop.** Put the physical duck on the table even when the chip runs on the
   laptop, and say that plainly.
5. **Mark human approvals on the receipt** ("approved by a verified human, World ID"), in the activity row from item 1
   and on the merchant's side. This is World's story in one label.
6. **Close on what's next:** several robots on one wallet, robots paying robots, a merchant seeing "human-approved".

## 4. Arc version: programmable money

**What Arc brings us:**
- **Money with rules.** The budget is a contract on Arc, not a setting on our server: the caps, the payee list, the
  approval path, the expiry and revocation. Arc checks every one of them when a payment lands.
- **One balance, no custody handed out.** The owner keeps a single USDC balance. The robots get permission, not money,
  so you never fund a robot and never sweep it back. On Arc, USDC is also the gas: the native coin and the ERC-20 share
  one balance, so the robot never needs a second token. "A card on your account with a limit" is normal for everybody,
  and here the chain enforces the limit.
- **Final in under a second,** so the till can open the gate on a payment it knows is final.
- **Passkeys verified cheaply** through the P-256 precompile.

**Tooling to show:**
- **Arc Studio:** the project, the enforcer, 42 tests, the testnet deploys. Required on screen.
- **MetaMask Delegation Framework** deployed on Arc.
- **Our `RobotPaymentPolicyEnforcer`:** a reusable caveat, which earns the track's bonus.
- **Our x402 facilitator** that settles ERC-7710 delegations, and the Arc explorer.

**Showcases ("same contract, other bodies"):**
- a delivery robot paying for its own charging
- an AI agent paying per API call
- a fleet with one budget per machine
- a household robot with an "ask me first" list

**Proof, all real tx hashes:**
- paid within the budget
- paid with an approval (`PaymentApproved`)
- refused after revoke (`CannotUseADisabledDelegation`)

**Track requirements:**
- Studio URL and Studio in the demo
- a working frontend and backend
- an architecture diagram
- the Arc and Circle tools named
- one Arc track

All of these are in `docs/prizes.md` and `docs/submission.md`. Still to do: the README's "Reuse it" section (the terms
encoding, the address and the ABI), and the booth question about deploying to mainnet outside Studio.

**Open question for Kris.** "Unified balance" above means our own model: one USDC balance that every robot spends from.
If you meant **Circle Gateway's Unified Balance** (deposit USDC on any chain and spend it on Arc), we don't use it. It
could be a roadmap slide, or a build we haven't scoped; Gateway lists Arc mainnet (`docs/research/arc-and-circle.md`).

## 5. World version: a human behind it

**What World brings us:** proof that a **real, unique, verified human**, the owner, stands behind the robot's big
decisions. A robot can't prove that about itself; World ID can.
- When the duck wants to spend over its cap, or buy something on the owner's ask-me-first list, the owner signs in
  freshly with World ID in World App.
- The sign-in is bound to that exact payment: its EIP-712 digest is the OIDC nonce.
- Our backend verifies the token (Orb `acr`, a fresh `auth_time`, `jti` once, `sub` bound to the wallet) and co-signs
  that one payment. Arc won't settle it without that co-signature, so the approval is enforced on-chain and is more
  than a UI gate.
- If the owner denies, or the request expires, nothing is signed.
- It ran live with a real Orb ID
  ([0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9)).

**This is World's own use case.** Their step-up guide says: "Pause the agent workflow, complete the step-up procedure,
and resume only after your backend accepts the authentication." Payments are its first example
(<https://auth.world.org/docs/guides/step-up>).

**To show:**
- the approval page → World App → paid, then a deny, then the "approved by a verified human" mark (§3, item 5)
- the debrief: the `amr`/`mfa` surprise and mandatory PKCE; our one improvement is `authorization_details` in the ID
  token (`docs/world-debrief.md`)

**Still to do:** one live deny with real World.

**World does not prove age.** We checked World's docs on 6 Nov at 15:20 IST:
- **Agent Pass's ID token has no age claim.** It carries `iss sub aud exp iat jti auth_time acr amr nonce`, plus an
  email alias, and "Name, raw World identifiers, and World proofs are not included"
  (<https://auth.world.org/docs/guides/id-token>).
- **World's only age feature is preview-only.** IDKit's Identity Check `minimum_age` "is currently in preview. To use it
  or learn more, contact us." The `passport` preset proves only that the user holds a verified passport
  (<https://docs.world.org/world-id/idkit/credentials>).
- **So a restricted item is the owner's own rule, approved by the owner, never an age check.** Say it before anyone
  asks: "World tells us the verified owner approved this exact payment, just now. It doesn't tell us anyone's age, and
  we don't claim it does."

## 6. 0G version: 0G runs the AI and keeps the episodes

**What 0G brings us:**
- **The brain.** Every decision the duck makes runs on 0G Compute: buy, ask the owner, or walk away, over the invoice,
  the budget and the policy. The console names the model and the 0G provider and logs 0G's request id.
- **The memory.** Every episode (what it saw as facts, what 0G decided, what was signed and paid) is uploaded to 0G
  Storage and anchored in `EpisodeLog` on 0G Chain. Seven episodes so far have real 0G decisions.
- **"0G is the brain, not the spinal cord."** The chip keeps the key, the camera and the motors, and camera frames never
  leave it.
- **Safe stop.** If 0G fails, the errand ends in `safe_stop` and the motors stay stopped. We never fake a decision.

**To show:**
- the console's decision line with its request id → the episode on 0G Storage → the `EpisodeLog` record tx
- a safe stop (§8, decision 1)
- with suggestion 1 from §3, the same thing from the wallet's Activity list

**Track requirements:**
- a 0G call in the decision loop
- an episode log on Storage with request ids
- a replayable simulation or a live demo at the booth
- the safe stop
- contract addresses
- a video under 3 min

All of these are met, except that the video still needs a safe-stop moment.

**Stretch:** an episode replay page that loads an episode from Storage by its root.

**Hardware third place:** the Radxa would have to run the chip client at the booth.

## 7. The presentation page

A single page on the scratch site (`docs/site`, `eth-mumbai-site…workers.dev`) carries all four versions.

**Routes:**
- `/pitch/` is the main story (§2).
- `/pitch/arc/`, `/pitch/world/` and `/pitch/0g/` each show beats 1–5 condensed into two chapters, followed by that
  sponsor's chapters.

**Chapters:**
- Every chapter is full-screen: a looping film or a real screenshot, a live title and at most 4 bullets.
- → or space moves to the next chapter.
- Evidence insets (screenshots with their tx links) are the only things that claim anything. The films are
  illustration.

**Films:** they follow Styld's pipeline (`~/code/meta-hackathon/out/styld-landing-film/`):
- Qwen Image keyframes, Wan 3.0 or Omni segments, `stitch.ts` seams, never a crossfade.
- About $20–30, through LiteLLM pay-as-you-go.
- A first round of three hero concepts goes on `preview`, and Kris picks one.

**Design skills now vendored here:** `frontend-design`, `hallmark` (new pages), `good-css`, `make-interfaces-feel-better`.

## 8. Decisions for Kris

1. **Safe stop in the video:** a narration line only, or a real one recorded on a preview deploy with 0G unreachable on
   purpose, labelled as such?
2. **Build suggestions 1 ("why" on activity rows) and 2 ("spent today" from Arc)?** About 2–4 h together. They make beats
   3 and 6 real and serve all three booths.
3. **"Unified balance":** our one-balance model only, or Circle Gateway as well (§4)?
4. **Films** (about $20–30) or screenshots only for the presentation page?
5. **Hardware place:** chase it with the Radxa, or show the laptop mock chip only?

## 9. Questions to expect

- **"How do you know they're 18?"** We don't (§5).
- **"What stops your backend from co-signing anything?"**
  - It co-signs only after verifying a World token whose nonce is that payment's digest, and it logs
    `(sub, auth_time, jti, digest)`.
  - Verifying the token on-chain is our stretch prototype (S5b). We left it out because it would publish the owner's
    World pseudonym.
- **"Does an approval lift the daily cap?"** No. `ERC20PeriodTransferEnforcer` still applies, and so does the expiry.
- **"Galileo testnet for 0G?"** We ask at the booth.
- **"Studio only deploys to testnet?"** Studio holds the code, the tests and the testnet deploys; we pulled it and
  deployed to mainnet with Foundry.
- **"Why a vision model with no frames?"** Frames stay on the chip by rule, so the decision runs on structured facts.
