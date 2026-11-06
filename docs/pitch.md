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

The stage deck is <https://vitaquack.com/pitch/> (§7). `/story/` (the four cute-duck screens,
<https://vitaquack.com/plan/story/>) is the short, sponsor-light version for a booth; it is not the stage look, which is
the landing's white robot and the real duck.

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

## 7. The pitch page

<https://vitaquack.com/pitch/> is the deck: seven screens in the landing's look, one per keypress (space, arrows,
PageUp/Down, Home, End; a clicker sends PageDown), dots at the bottom left to jump. The landing stays as it is (Kris,
7 Nov 03:30: no slides mode on the landing). The screens: the budget line with the hero film; the key belongs on the
robot; How it works, the landing's rail running its three scenarios, with **Open the wallet** (new tab) as the way into
the demo; the three cards with their credits (enforced on Arc, decided by 0G, a real person with World ID); **Now,
live** with the three beats ("Get me a chai · it pays", "Get me a thali · it asks you", "Stop · Arc refuses the next
one"); the eight build photos; the close ("Arc holds the rules. 0G is the brain and the memory. World is the human.",
vitaquack.com, links to the app, the public proofs, the architecture and GitHub).

Source: `~/code/vitaquack-film/landing/pitch.html`, rendered by `python3 build.py pitch` to
`docs/site/pitch/pitch/index.html`. The render lifts the styles, the sprite, the app-screen wall, the cards, the photos
and the rail's scenarios from the rendered landing (`docs/site/pitch/index.html`, which is ahead of the template since
b6e938e), so the deck follows the landing's copy: re-render it after every landing change. The Edge answers `/pitch/`
with it like `/shop/` (`tools/copy-landing.ts`, `packages/server/src/EdgeLanding.ts`); on the scratch site it is
<https://vitaquack.com/plan/pitch/pitch/>.

## 8. Stage run

The finalist judging session is 7 minutes, 4 of demo and 3 of judges' questions (ETHGlobal's event page); the top 10
demo again at the closing ceremony. Judged on technicality, originality, practicality, usability and wow factor. The 4
minutes stay non-technical; the questions (§6) are where the depth goes.

Open with the duck in hand and one question: "Would any of you give a robot your credit card?" Pause. "This one is
about to buy me a chai with my money. I never gave it my wallet. I gave it a budget." Set it down; screen 1 says the
same sentence. Then one line of vision: "Robots are about to run errands for us, and errands cost money." A cold open
(the duck paying before a word) gets the biggest reaction and has the highest variance, since the scan is the least
proven beat.

| Clock | On screen | Said |
| --- | --- | --- |
| 0:00 | Pitch screen 1 | The opening |
| 0:25 | Screens 3 and 4 | "You set a budget. It shops. For big things it asks you." One clause per card |
| 1:00 | Screen 5, then the wallet (Duck already paired): the allowance, passkey | Read the sentence aloud. "One signature, and Arc checks every payment against it" |
| 1:20 | "Get me a chai", Duck scans, the till shows Paid | "It decided, its chip signed, Arc settled. Real money, under a second" |
| 1:55 | "Get me a thali", the yellow bubble, the mirrored phone buzzes, World ID approve, paid | "Over its limit, so it asks me. A real human saying yes, verified with World ID" |
| 2:45 | Thali again, No, nothing paid | "Say no and nothing is signed" |
| 3:00 | Stop the allowance, the next chai refused | "One tap and it's cut off. Not even our servers can undo that" |
| 3:25 | Proofs on 0G, one errand | "Every errand, its decision and its receipt, public on 0G" |
| 3:40 | Screens 6 and 7 | "We printed this duck at the table on Thursday. The first 20 ship in January. Give your robot a budget, not your wallet" |

If it runs long, cut the revoke beat to one sentence, then the proofs page; never the chai or the thali. The third
thali that walks away is verbal only. Sign-up and pairing are staged before the slot; grant once earlier in the day and
revoke it, so the stage grant skips the account deploy. Sponsors stay as credit lines (the landing's labels), the rail
as the one picture with all three, and the closing line; Studio, TEE signatures, the OIDC nonce and the enforcer are
for the booths and the questions.

Before the slot: decide the scan fallback (the pay-now path is gone from the app, so a camera miss has no in-app
fallback: the simulator duck tab, or a hidden pay-now for the stage); mirror the phone (QuickTime over USB) so the
Telegram buzz and the World ID approve are seen; put the till (cafe.vitaquack.com) on the big screen, since the
counter's own screen is tiny; check 0G five minutes before (one safe stop is a story, then switch the brain in the
dock; two is not); and don't say "restricted", the demo is spending limits only.
