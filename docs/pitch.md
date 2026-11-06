# Pitch: how each sponsor sees Vitaquack

Working plan for the stage slot, the booth visits, the presentation page and the video. Written Fri 6 Nov 15:30 IST;
submissions close **Sat 7 Nov 09:00 IST**. Facts come from `docs/submission.md` and `docs/evidence/`; this file only
adds the framing. Prize picks: decision D16 (`docs/prizes.md`).

**One line:** "Don't give a robot your wallet. Give it a budget."
**Three sponsors, three jobs:** **Arc holds the rules for the money, 0G is the brain, World is the human.**

## 1. World cannot prove the owner is 18+ (rechecked 6 Nov 15:20 IST)

- **Agent Pass (World IdP) has no age claim.** Its ID token carries `iss sub aud exp iat jti auth_time acr amr nonce`,
  plus an `email` alias for inbox accounts. The only scopes are `openid`, `offline_access` and `email`. The docs say
  "Name, raw World identifiers, and World proofs are not included." `acr`/`amr` say how the person proved they are human
  (Orb, Selfie, face, passkey), nothing about age, documents or nationality.
  Source: <https://auth.world.org/docs/guides/id-token>.
- **World's only age feature is IDKit's Identity Check** (`minimum_age`, `nationality`, `document_type`): "Identity Check
  is currently in preview. To use it or learn more, contact us." The `passport` preset only proves that the person
  "holds a verified NFC passport credential", with no age or date-of-birth check.
  Source: <https://docs.world.org/world-id/idkit/credentials>.
- **So there is no clean way to do it.** Agent Pass can't do it, and IDKit's way is a gated preview that belongs to a
  prize we did not enter. Our framing stands: **a restricted item is the owner's own "ask me first" rule, and the owner
  approves it. It is never an age check.**
- Say it before a judge asks: *"World tells us the verified owner approved this exact payment, just now. It doesn't
  tell us anyone's age, and we don't claim it does. Identity Check's `minimum_age` would plug in at onboarding once
  it's out of preview."*

## 2. Arc: Advanced Stablecoin Logic ("programmable money")

The track asks for USDC contracts with programmable logic, built in Arc Studio and connected to an app. Its examples
include **software-to-software payments** and **conditional transfers**, and it gives a **bonus for contracts other
builders can reuse**. We already match it in the track's own words:

| What the track names | Ours |
| --- | --- |
| Software-to-software payments | A robot pays a merchant's till per invoice over x402. Our ERC-7710 facilitator settles through `redeemDelegations` |
| Conditional transfer | Outside the policy, a payment passes only with the approver's EIP-712 signature over exactly that payment, once (`PaymentApproved`) |
| Reusable contract (bonus) | `RobotPaymentPolicyEnforcer` is an ordinary caveat for the MetaMask Delegation Framework v1.3.0. It takes three terms (per-payment cap, payee allowlist, approver) and works for **any** delegated agent wallet on Arc, not only robots |
| Programmable logic | Our caveat plus stock ones: a daily cap (`ERC20PeriodTransferEnforcer`), expiry, invoice-once (`Id`), revoke. All of them are checked when the payment lands, and an approval lifts neither the daily cap nor the expiry |

**Why Arc and not another chain** (say it on stage):
- USDC is the gas, so the robot never holds a second token.
- Finality is sub-second and deterministic, so the gate opens on a final payment and the merchant carries no reorg risk.
- The P-256 precompile makes the passkey account cheap to verify.

**Use-case slide, "same contract, other bodies"** (≤ 4 bullets):
- a delivery robot paying for its own charging
- an AI agent paying per API call over x402, with a daily cap
- a warehouse fleet with one budget per machine, where you revoke one and keep the rest
- a household errand robot with an "ask me first" list

**Gaps to close for Arc, cheapest first:**
1. **Show Studio on screen (required).** Show the Studio project with the enforcer, 42 tests and the testnet deploys,
   both in the video (its own shot) and at the booth.
2. **A "Reuse it" section in the README.** Give the terms encoding, the mainnet address and the ABI. That makes the
   bonus concrete. About 30 minutes.
3. **Name the Arc and Circle tools (required):** Arc Studio, Arc mainnet, USDC (native gas and the ERC-20 view), Arc's
   P-256 precompile, the MetaMask Delegation Framework deployments on Arc, x402.
4. **Booth question:** is a mainnet deploy outside Studio acceptable? It is already listed in `prizes.md`.
- **Roadmap slide only, no build:** Arc Memo tagging the invoice id, Circle Gateway top-ups from any chain, EURC.

## 3. 0G: Physical AI, Agents with a Body

The track's rule is "0G is the brain, not the spinal cord". It does not want "a chatbot with a robot avatar,
pre-recorded motion, 0G used only for logs."

| What the track requires | Ours | Status |
| --- | --- | --- |
| A 0G call inside the decision loop | `decide`, which returns pay / ask_human / walk_away from the invoice, the budget and the policy flags | Live, with router request ids |
| An episode log on 0G Storage, with a request id per decision | Episodes are uploaded to Storage, and their root and request-id hash are anchored in `EpisodeLog` (Galileo) | 7 episodes with real 0G decisions |
| A replayable simulation, or live hardware at the booth | The mock chip plus the web gate on the deployed app, run live at the booth | Live |
| A safe stop when 0G is unreachable, never faked | Any 0G failure ends the errand in `safe_stop` and the motors stay stopped | In tests, and seen on the deploy with the rehearsal brain. **Not in the video yet** |

**Pitch:** the duck's body (the chip) holds the key, the camera and the motors. 0G holds the judgement and the memory.
Camera frames never leave the chip.

**Gaps:**
1. **The video has no safe-stop beat.** Add a narration line now. Add a shot only if we can record a real one (see
   §7).
2. **Episode replay, a stretch of about 2 hours.** A page that fetches an episode from 0G Storage by its root and
   replays the timeline would make "replayable" something judges can click, and would show Storage is more than logs.
3. **Hardware third place ($1k)** needs the Radxa running the chip client at the booth. Today signing works on the
   Radxa (in Python), but the QR scan is not done (`docs/spikes/hardware-results.md`).
4. **Expected question:** "why a vision model with no frames?" Answer: by rule, frames stay on the chip, so the
   decision is made over structured facts.

## 4. World: Agent Pass

World's own step-up guide describes our use case word for word: *"Pause the agent workflow, complete the step-up
procedure, and resume only after your backend accepts the authentication."* Payments are its first example of a
sensitive action (<https://auth.world.org/docs/guides/step-up>). The prize asks for "a meaningful action that needs a
human identity or approval layer, not simply a login screen."

**How ours works:**
1. A payment over the cap, or on the owner's "ask me first" list, makes 0G ask the owner.
2. The owner does a fresh World ID check in World App. The OIDC nonce is the payment's EIP-712 digest.
3. The backend checks the token: Orb `acr`, a fresh `auth_time`, `jti` used once, `sub` bound to the wallet.
4. The backend co-signs that one payment, and Arc refuses to settle without that co-signature.
5. Deny or expiry means nothing is signed. It has run live with a real Orb ID
   ([0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9)).

**What sets it apart:** the approval is enforced on-chain. Without it Arc reverts, so it is more than a gate in the UI.

**Gaps:**
1. **Record a live deny with real World.** One run; it is still _fill in_ in `submission.md`.
2. **Lead the World beat with "over the cap".** A human checkpoint obviously belongs on spending. The restricted item
   comes second, framed as the owner's rule (§1).
3. **Mention the debrief, because World asked for one.** Top frictions: `amr`/`mfa` and mandatory PKCE. Our one
   improvement: `authorization_details` echoed in the ID token, so nobody has to overload `nonce`
   (`docs/world-debrief.md`).

## 5. The presentation page (Styld's chapter technique)

This is one page on the scratch site (`docs/site`, `eth-mumbai-site…workers.dev`). It is made of full-screen chapters
and serves as the stage deck, the landing page and the booth opener at once:

1. Hook: the duck and its budget
2. The owner's passkey wallet on Arc
3. **Arc**: one signature is a budget (the policy card), at anchor `#arc`
4. **0G**: the brain decides and the chip signs, at anchor `#0g`
5. Paid, and the gate opens
6. **World**: the human checkpoint, at anchor `#world`
7. Revoke, and Arc refuses
8. Proof: Studio, tx hashes, Storage roots, the architecture
9. Close: the repo, the app, "Arc · 0G · World"

**How it works:**
- → or space moves to the next chapter. At a booth, open the page straight at that sponsor's anchor.
- Each chapter has one looping film with no words in the frame, a live title with at most 4 bullets, and an evidence
  inset: the real screenshot from `docs/evidence/screens/` with its tx link.
- **Films** follow Styld's pipeline (`~/code/meta-hackathon/out/styld-landing-film/`):
  - Qwen Image keyframes, Wan 3.0 or Omni segments, `stitch.ts` seams (never a crossfade).
  - Cost is about $20–30, paid through LiteLLM pay-as-you-go, never the Token Plan.
  - Start with a round of three hero concepts on `preview`, and Kris picks one.
- Every frame in it must be honest: a film is illustration, and only the evidence insets claim anything.

## 6. Booth cards (30 seconds each)

**Arc.**
- *Say:* "Robots need money. We give them a budget instead of a key. One passkey signature creates a delegation on Arc
  with our `RobotPaymentPolicyEnforcer`: a per-payment cap, a payee allowlist and a human-approval path, on top of a
  daily cap, an expiry and invoice-once. Arc checks every payment as it lands. Revoke the grant, and Arc refuses the next
  one. We built and tested it in Studio and deployed it on mainnet, and any agent wallet that uses MetaMask delegations
  can reuse the caveat."
- *Show:* Studio → the grant sentence → a paid tx → the refusal after revoke.

**0G.**
- *Say:* "The duck's chip holds its key and its motors. 0G Compute makes the call: buy, ask the owner, or walk away.
  Every decision is logged with 0G's request id, and every episode goes to 0G Storage and is anchored in `EpisodeLog`. If
  0G doesn't answer, the duck stops. We never fake a decision."
- *Show:* the console's decision line with its request id → the episode root → the `EpisodeLog` tx.

**World.**
- *Say:* "When the robot wants to spend over its cap, or buy something on the owner's ask-me-first list, the owner
  gets a fresh World ID check bound to that exact payment: the payment's EIP-712 digest is the OIDC nonce. Our backend
  verifies the token and co-signs that one payment, and Arc won't settle it otherwise. Deny, and nothing is signed. We
  ran it live with a real Orb ID."
- *Show:* the approval page → World App → the paid tx. Then a deny.

**Questions to have answers ready for:**
- *"How do you know they're 18?"* We don't (§1).
- *"What stops your backend from co-signing anything?"*
  - It signs only after verifying a World token whose nonce is that payment's digest, and it logs
    `(sub, auth_time, jti, digest)`.
  - Verifying the token on-chain is our stretch prototype (S5b). We left it out because it would publish the owner's
    World pseudonym.
- *"Galileo testnet for 0G?"* We ask at the booth (`prizes.md`).
- *"Studio only deploys to testnet?"* Studio holds the code, the tests and the testnet deploys. We pulled the code and
  deployed it to mainnet with Foundry.

## 7. Decisions for Kris

1. **Safe stop in the video.** Either a narration line only, or a real recorded safe stop on a preview deploy whose 0G
   endpoint is made unreachable on purpose and labelled as such.
2. **Episode replay page.** Build it (about 2 h) or skip it.
3. **Hardware place.** Chase it with the Radxa at the booth, or present the laptop mock chip only.
4. **Films for the presentation.** Spend about $20–30 on generated films, or use the evidence screenshots only.
