# Pitch: one story, four presentations

Working plan for the stage slot, the booth visits, the presentation page and the video. Written Fri 6 Nov 15:30 IST,
restructured at 15:50 IST after Kris's direction and updated on 7 Nov. Submissions close **Sat 7 Nov 09:00 IST**. Facts
come from `docs/submission.md` and `docs/evidence/`; this file adds the framing only. Prize picks: decision D16
(`docs/prizes.md`).

The one line: "Don't give a robot your wallet. Give it a budget."

## 1. Four presentations

We tell one story in the same order every time, so a judge who sees two versions recognises it. Each audience gets a
different focus:

| Version | Audience | Focus | Shape |
| --- | --- | --- | --- |
| **Main** | ETHGlobal judges, the stage, the video | The story: how robots will pay. Sponsors stay in the background as credits | §2, about 4 min |
| **Arc** | Arc booth | What Arc brings us: programmable money, one balance and no custody handed out, the tooling | 60 s of story, then §4 |
| **World** | World booth | What World brings us: proof that a real human is behind the robot's big decisions | 60 s of story, then §5 |
| **0G** | 0G booth | What 0G brings us: 0G runs the AI and keeps the episodes | 60 s of story, then §6 |

Every judge watches the same single video. It follows the main story, with the sponsors as small credits in captions
and a short "under the hood" ending that shows what the tracks require (Arc Studio on screen, the 0G Storage episode).
`docs/video-script.md` already has that shape.

## 2. Main presentation: the story

### The opening: the vision first, then the proof (6 Nov, 17:00 IST)

Kris's idea, said plainly:

> Soon, everyone will have a robot of their own that runs errands for them. A robot that acts in the physical world
> has to pay in it. Its wallet belongs on the robot, not in someone's cloud where it can be frozen, lost or shut down,
> so the owner keeps full control. This weekend we built the first version, and here it is working.

There are three ways to frame the opening. One becomes the spine and the other two become lines inside it.

| Framing | Opening line | Lands with | Risk |
| --- | --- | --- | --- |
| A robot in every home | "Soon, everyone will have a robot of their own." | everyone, the stage | It sounds like science fiction unless the very next screen is concrete (paying for chai) |
| Self-custody for robots | "Your robot's key belongs on your robot." | ETHGlobal and the sponsor judges | Too technical as the very first line |
| Pocket money for machines | "Give your robot a budget, not your wallet." | everyone; it is our one-liner | On its own it's a small idea, without the vision in front of it |

We open with the robot in every home, turn on "the key belongs on the robot", and close on the budget line, because
that is the one people remember. That was the shape of the first `/pitch/` page on the team site, about 4 minutes
across 9 screens (the same file now serves the landing at <https://vitaquack.com/>):

- Vision (screens 1 and 2, films): everyone will have a robot, and a robot that does things has to pay for them.
- The problem (screen 3): today it has two bad ways to pay, your card or a wallet in someone's cloud.
- The principle (screens 4 and 5): the key belongs on the robot. A table shows who holds what: your passkey on your phone,
  the robot's key on its chip, the money and the rules on Arc, the decisions on 0G, the big yeses with World ID, and our
  servers, which only pass messages along.
- The proof (screens 6 and 7): what we built this weekend, six real screens of the deployed app, each with its Arc or 0G
  transaction.
- The demo (screen 8): "Now, live."
- What's next (screen 9): the agent moves onto the robot, several robots share one wallet, robots pay robots.

`/story/` (the four cute-duck screens, <https://vitaquack.com/plan/story/>) stays as the short, sponsor-light version.

Which claims are safe:

- We can say "no company holds your keys", "our servers can't spend a cent" and "the robot's key never leaves its
  chip".
- We don't say "it can't be blocked". USDC on Arc has an issuer blocklist, and per Arc's docs payments from
  blocklisted addresses revert. Our servers also relay every payment today, so if they are down the robot can't pay,
  even though nobody can take the money.
- We don't say the duck pays by itself today. In the demo the chip software runs on a laptop beside the duck. Signing
  on its Radxa board has only passed a bench test (`docs/spikes/hardware-results.md`, H3).
- The films are illustrations. Only the real screens and their transaction links prove anything.

### The proof, beat by beat

Robots are starting to run errands. To pay, they would need your card or a funded wallet of their own. Vitaquack is an
experiment in how robots will pay: with your money, by your rules, and with you in the loop when it matters.

| # | Beat | What the audience sees | The line | Sponsor credit (small) |
| --- | --- | --- | --- | --- |
| 0 | **Why** | The duck | "Robots will run errands. Today they'd need your card. We tried something else." | |
| 1 | **You have a wallet** | Sign up with a passkey and an address appears | "A wallet with no seed phrase: a passkey on your phone." | on Arc |
| 2 | **You add a robot to it** | Pairing code, then "paired · online" | "The duck gets its own wallet: a key on its chip that never leaves it." | |
| 3 | **You give it a budget** | The grant sentence, one passkey signature | "The money stays in your wallet. The duck gets permission, not money: three dollars a day, a dollar a payment, only at this café." | enforced on Arc |
| 4 | **It buys for you** | "Get me a chai": the duck scans, 0G decides, the chip signs, it pays, the gate opens | "It decides, signs and pays by itself, inside the budget." | decided by 0G |
| 5 | **Bigger things ask you first** | a 2.00 thali, over the 1.00 per-payment cap: your phone asks, you deny, then approve | "Over its limit, it has to ask. Say no and nothing is paid." | World ID |
| 6 | **You can see why** | The errand's proof: what it bought, why 0G decided that, who approved, the receipt, and the public proof on 0G | "Every decision has a reason you can read, and a receipt anyone can check." | episodes on 0G |
| 7 | **You can stop it** | Revoke, then the next buy is refused | "One tap and it's cut off, and not even our servers can undo that." | Arc refuses |
| 8 | **What's next** | Many robots, one wallet | "Every robot gets a budget, not your wallet." | Arc · 0G · World |

Beats 0, 6, 7 and 8 extend Kris's list (wallet → robot → budget → buy → bigger needs approval → visibility). Beats 0
and 8 frame the story, and 7 is its strongest proof.

## 3. Suggestions to make it better

Ordered by value against the time left. The cost estimates are ours.

1. Show "why" for every errand (beat 6). Built: the receipt's **Show proof** opens the errand's page (0G request id,
   brain, latency, chip, payment, evidence), and its public proof at `/app/proofs/:id` shows the same episode read
   from 0G, for anyone, without signing in.
2. Show "spent today, left today". The robot's header pill shows what is left today when the Worker reports the day.
   `ERC20PeriodTransferEnforcer.getAvailableAmount` returns what the duck can still spend in the current period, so
   reading the number from the contract that enforces the limit would keep the UI from drifting from what Arc allows.
   That is beat 3 made visible, and the Arc booth's best single screen.
3. Use the card-with-limits analogy: "It's like giving someone a card on your account with a limit." Everyone already
   understands that. The new part is that the chain enforces the limit instead of a bank.
4. Keep the robot on the table as a prop, even when the chip runs on the laptop, and say so.
5. Mark human approvals on the receipt ("approved by a verified human, World ID") and on the merchant's side. That
   label is World's story.
6. Close on what's next: several robots on one wallet, robots paying robots, a merchant seeing "human-approved".

## 4. Arc version: programmable money

What Arc brings us:

- Money with rules. The budget is a contract on Arc instead of a setting on our server: the caps, the payee list, the
  approval path, the expiry and revocation. Arc checks every one of them when a payment lands.
- One balance, no custody handed out. The owner keeps a single USDC balance and the robots get permission, so you never
  fund a robot and never sweep it back. On Arc, USDC is also the gas: the native coin and the ERC-20 share one balance,
  so the robot never needs a second token. "A card on your account with a limit" is normal for everybody, and here the
  chain enforces the limit.
- Payments are final in under a second, so the till can open the gate on a payment it knows is final.
- Passkeys are verified cheaply through the P-256 precompile.

Tooling to show:

- Arc Studio: the project, the enforcer, 42 tests, the testnet deploys. It has to be on screen.
- The MetaMask Delegation Framework deployed on Arc.
- Our `RobotPaymentPolicyEnforcer`, a reusable caveat, which earns the track's bonus.
- Our x402 facilitator that settles ERC-7710 delegations, and the Arc explorer.

Showcases ("same contract, other bodies"):

- a delivery robot paying for its own charging
- an AI agent paying per API call
- a fleet with one budget per machine
- a household robot with a daily limit

Proof, all real tx hashes:

- paid within the budget
- paid with an approval (`PaymentApproved`)
- refused after revoke (`CannotUseADisabledDelegation`)

Track requirements:

- Studio URL and Studio in the demo
- a working frontend and backend
- an architecture diagram
- the Arc and Circle tools named
- one Arc track

All of these are in `docs/prizes.md` and `docs/submission.md`. Still to do: the README's "Reuse it" section (the terms
encoding, the address and the ABI), and the booth question about deploying to mainnet outside Studio.

"Unified balance" here means our own model, one USDC balance that every robot spends from. We don't use Circle
Gateway's Unified Balance (deposit USDC on any chain and spend it on Arc). It lists Arc mainnet
(`docs/research/arc-and-circle.md`), so it could be a roadmap slide.

## 5. World version: a human behind it

What World brings us: proof that a real, unique, verified human, the owner, stands behind the robot's big decisions. A
robot can't prove that about itself, and World ID can.

- When the duck wants to spend over its per-payment cap (a 2.00 thali against a 1.00 cap), the owner signs in freshly
  with World ID in World App.
- The sign-in is bound to that exact payment: its EIP-712 digest is the OIDC nonce.
- Our backend verifies the token (Orb `acr`, a fresh `auth_time`, `jti` once, `sub` bound to the wallet) and co-signs
  that one payment. Arc won't settle it without that co-signature, so the approval is enforced on-chain and is more
  than a UI gate.
- If the owner denies, or the request expires, nothing is signed.
- It ran live with a real Orb ID
  ([0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9)).

This is World's own use case. Their step-up guide says: "Pause the agent workflow, complete the step-up procedure,
and resume only after your backend accepts the authentication." Payments are its first example
(<https://auth.world.org/docs/guides/step-up>).

To show:

- the approval page → World App → paid, then a deny, then the "approved by a verified human" mark (§3, item 5)
- the debrief: the `amr`/`mfa` surprise and mandatory PKCE; our one improvement is `authorization_details` in the ID
  token (`docs/world-debrief.md`)

Still to do: one live deny with real World.

World does not prove age. We checked World's docs on 6 Nov at 15:20 IST:

- Agent Pass's ID token has no age claim. It carries `iss sub aud exp iat jti auth_time acr amr nonce`, plus an email
  alias, and "Name, raw World identifiers, and World proofs are not included"
  (<https://auth.world.org/docs/guides/id-token>).
- World's only age feature is preview-only. IDKit's Identity Check `minimum_age` "is currently in preview. To use it
  or learn more, contact us." The `passport` preset proves only that the user holds a verified passport
  (<https://docs.world.org/world-id/idkit/credentials>).

So restricted items are out (Kris, 6 Nov 17:40 IST), and **the demo's approval story is spending limits only.** A 2.00
thali over the 1.00 per-payment cap asks the owner with World ID, a thali over the 3.00 daily cap makes the robot walk
away, and after a revoke Arc refuses. If anyone asks about age: "World tells us the verified owner approved this exact
payment, just now. It doesn't tell us anyone's age, and we don't claim it does."

## 6. 0G version: 0G runs the AI and keeps the episodes

What 0G brings us:

- The brain. Every decision the duck makes runs on 0G Compute: buy, ask the owner, or walk away, over the invoice, the
  budget and the policy. The owner picks the model per message: `glm-5.3` in a TEE, with the proof stored next to the
  decision, or `qwen3-vl-plus`, which has no TEE proof and is labelled so. The conversation names the model and logs
  0G's request id.
- The memory. Every episode (what the duck saw as facts, what 0G decided, what was signed and paid) is uploaded to 0G
  Storage and anchored in `EpisodeLog` on 0G Chain. 48 errands were on 0G when we last checked.
- Proof of work. The chip keeps the key and the motors. It signs the camera frames, which go plain to 0G Storage as
  evidence, their roots recorded in the episode JSON. The 0G decision never receives an image.
- Safe stop. If 0G fails, the errand ends in `safe_stop` and the motors stay stopped. We never fake a decision.

To show:

- the public proof of one errand at `/app/proofs/:id`: the episode downloaded from 0G Storage by its root, the 0G
  decision, the Arc payment and the chip-signed frame, then **Verify against 0G**, which checks the `EpisodeLog` record
  on 0G Chain and each frame's SHA-256 in the reader's own browser
- the list of every errand on 0G at <https://vitaquack.com/app/proofs>, no sign-in
- a safe stop

Track requirements:

- a 0G call in the decision loop
- an episode log on Storage with request ids
- a replayable simulation or a live demo at the booth
- the safe stop
- contract addresses
- a video under 3 min

All of these are met, except that the video still needs a safe-stop moment.

Hardware third place would need the Radxa to run the chip client at the booth.

## 7. Questions to expect

- "How do you know they're 18?" We don't (§5).
- "What stops your backend from co-signing anything?"
  - It co-signs only after verifying a World token whose nonce is that payment's digest, and it logs
    `(sub, auth_time, jti, digest)`.
  - Verifying the token on-chain is our stretch prototype (S5b). We left it out because it would publish the owner's
    World pseudonym.
- "Does an approval lift the daily cap?" No. `ERC20PeriodTransferEnforcer` still applies, and so does the expiry.
- "Galileo testnet for 0G?" The 0G judges confirmed Galileo is fine for Storage and `EpisodeLog`.
- "Studio only deploys to testnet?" Studio holds the code, the tests and the testnet deploys. We pulled it and deployed
  to mainnet with Foundry.
- "Why a vision model if the decision gets no frames?" The decision runs on structured facts by rule. The camera frames
  are chip-signed evidence on 0G Storage, and the owner can pick `glm-5.3` in a TEE instead.
- "How do I check an errand myself?" Open its public proof at <https://vitaquack.com/app/proofs> and press **Verify
  against 0G**. Your browser reads the record from 0G Chain's public RPC and the files from 0G Storage, not from us.
