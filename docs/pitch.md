# Pitch: one story, four presentations

The framing for the stage slot, the booth visits and the video. Submissions close **Sat 7 Nov 09:00 IST**. Facts and
evidence live in `docs/submission.md` and `docs/evidence/`, the click-by-click run in `docs/demo.md`, the shots in
`docs/video-script.md`, and the prize picks in `docs/prizes.md`.

The one line: "Don't give a robot your wallet. Give it a budget."

## 1. Four presentations

We tell one story in the same order every time, so a judge who sees two versions recognises it. The main version (the
stage and the video, about 4 min) keeps the sponsors in the background as credits. At each booth we give 60 s of the
story, then what that sponsor brings us: Arc (§3), World (§4), 0G (§5).

## 2. Main presentation: the story

Kris's idea, said plainly:

> Soon, everyone will have a robot of their own that runs errands for them. A robot that acts in the physical world
> has to pay in it. Its wallet belongs on the robot, not in someone's cloud where it can be frozen, lost or shut down,
> so the owner keeps full control. This weekend we built the first version, and here it is working.

We open with the robot in every home, turn on "the key belongs on the robot", and close on the budget line, because
that is the one people remember. The order:

- Vision: everyone will have a robot, and a robot that does things has to pay for them.
- The problem: today it has two bad ways to pay, your card or a wallet in someone's cloud.
- The principle: the key belongs on the robot. Your passkey is on your phone, the robot's key on its chip, the money
  and the rules on Arc, the decisions on 0G, the big yeses with World ID. Our servers only pass messages along.
- The proof: the deployed app, each screen with its Arc or 0G transaction. Then "Now, live." (`docs/demo.md`).
- What's next: the agent moves onto the robot, several robots share one wallet, robots pay robots.

The story in the demo: you have a wallet, you add a robot, you give it a budget, it buys for you, bigger things ask you
first, you can see why, and you can stop it. Revoke is the strongest proof: "One tap and it's cut off, and not even our
servers can undo that." For the budget, use the card analogy: "It's like giving someone a card on your account with a
limit." The new part is that the chain enforces the limit instead of a bank. Keep the duck on the table as a prop, even
when the chip runs on the laptop, and say so.

`/story/` (the four cute-duck screens, <https://vitaquack.com/plan/story/>) is the short, sponsor-light version.

Which claims are safe:

- We can say "no company holds your keys", "our servers can't spend a cent" and "the robot's key never leaves its
  chip".
- We don't say "it can't be blocked". USDC on Arc has an issuer blocklist, and per Arc's docs payments from
  blocklisted addresses revert. Our servers also relay every payment today, so if they are down the robot can't pay,
  even though nobody can take the money.
- We don't say the duck pays by itself today. In the demo the chip software runs on a laptop beside the duck. Signing
  on its Radxa board has only passed a bench test (`docs/spikes/hardware-results.md`, H3).
- The films are illustrations. Only the real screens and their transaction links prove anything.

## 3. Arc: programmable money

- Money with rules. The budget is a contract on Arc instead of a setting on our server: the caps, the payee list, the
  approval path, the expiry and revocation. Arc checks every one of them when a payment lands.
- One balance, no custody handed out. The owner keeps a single USDC balance and the robots get permission, so you never
  fund a robot and never sweep it back. On Arc, USDC is also the gas, so the robot never needs a second token.
- Payments are final in under a second, so the till can open the gate on a payment it knows is final.
- Passkeys are verified cheaply through the P-256 precompile.

Show Arc Studio on screen (the project, the enforcer, 42 tests, the testnet deploys) and our `RobotPaymentPolicyEnforcer`
as a reusable caveat: the same contract fits a delivery robot paying for its own charging, an AI agent paying per API
call, a fleet with one budget per machine, or a household robot with a daily limit. The tx hashes are in
`docs/submission.md`.

"Unified balance" here means our own model, one USDC balance that every robot spends from. Circle Gateway's Unified
Balance lists Arc mainnet (`docs/research/arc-and-circle.md`), so it could be a roadmap slide.

## 4. World: a human behind it

World gives us proof that a real, unique, verified human, the owner, stands behind the robot's big decisions. A robot
can't prove that about itself. The World approval is bound to that exact payment, and Arc won't settle it without our
co-signature, so the approval is enforced on-chain, beyond a UI gate. It ran live with a real Orb ID
([0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9)).

This is World's own use case. Their step-up guide says: "Pause the agent workflow, complete the step-up procedure,
and resume only after your backend accepts the authentication." Payments are its first example
(<https://auth.world.org/docs/guides/step-up>).

Show the approval page → World App → paid, then a deny. Mention the debrief: the `amr`/`mfa` surprise and mandatory
PKCE; our one improvement is `authorization_details` in the ID token (`docs/world-debrief.md`).

## 5. 0G: 0G runs the AI and keeps the episodes

- The brain. Every decision runs on 0G Compute: buy, ask the owner, or walk away. The owner picks `glm-5.3` in a TEE
  (the proof stored next to the decision) or `qwen3-vl-plus` (no TEE proof, labelled so).
- The memory. Every episode is uploaded to 0G Storage and anchored in `EpisodeLog` on 0G Chain. 48 errands were on 0G
  when we last checked.
- Proof of work. The chip signs the camera frames, which go plain to 0G Storage as evidence. The 0G decision never
  receives an image.
- Safe stop. If 0G fails, the errand ends in `safe_stop` and the motors stay stopped. We never fake a decision.

Show one errand's public proof (from <https://vitaquack.com/app/proofs>, no sign-in), press **Verify against 0G**, and
show a safe stop. The video still needs a safe-stop moment. Hardware third place would need the Radxa to run the chip
client at the booth.

## 6. Questions to expect

- "How do you know they're 18?" We don't, and we don't claim to. Agent Pass's ID token has no age claim
  (<https://auth.world.org/docs/guides/id-token>), and IDKit's `minimum_age` is preview-only
  (<https://docs.world.org/world-id/idkit/credentials>). The demo's approvals are spending limits only. "World tells us
  the verified owner approved this exact payment, just now. It doesn't tell us anyone's age."
- "What stops your backend from co-signing anything?" It co-signs only after verifying a World token whose nonce is
  that payment's digest, and it logs `(sub, auth_time, jti, digest)`. Verifying the token on-chain is our stretch
  prototype (S5b). We left it out because it would publish the owner's World pseudonym.
- "Does an approval lift the daily cap?" No. `ERC20PeriodTransferEnforcer` still applies, and so does the expiry.
- "Galileo testnet for 0G?" The 0G judges confirmed Galileo is fine for Storage and `EpisodeLog`.
- "Studio only deploys to testnet?" Studio holds the code, the tests and the testnet deploys. We pulled it and deployed
  to mainnet with Foundry.
- "Why a vision model if the decision gets no frames?" The decision runs on structured facts by rule. The camera frames
  are chip-signed evidence on 0G Storage, and the owner can pick `glm-5.3` in a TEE instead.
- "How do I check an errand myself?" Open its public proof at <https://vitaquack.com/app/proofs> and press **Verify
  against 0G**. Your browser reads the record from 0G Chain's public RPC and the files from 0G Storage, not from us.
