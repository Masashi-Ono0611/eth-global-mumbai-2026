# Video storyboard (2:52)

Follows plan §0 "Demo script". Rules (spec §12): 2:30–2:59 so it satisfies both ETHGlobal (2–4 min) and 0G (< 3 min),
≥ 720p (record 1920×1080 screen, phone shots mirrored or filmed in the screen recording, never a phone filming a
screen), **Kris's own voice** (no AI voice), real speed (no speed-up; cut instead), at most 4 bullets on any slide.
Never say "age check": it is an **approval for a restricted item**, and World proves no age (`docs/pitch.md` §1). The
sponsor framing per beat (Arc = the rules, 0G = the brain, World = the human) is in `docs/pitch.md`.

**Shot status:** ✅ = we already have this screen (`docs/evidence/screens/`); 🟡 = needs the funded run with 0G
configured (`packages/server/scripts/wallet-browser.ts --fund 0.65`, or the live demo); 🌍 = also needs the World IdP
client. Record every 🟡/🌍 shot in one continuous take on the deployed app so the tx hashes on screen are real. The ✅
console shots are run 7's (0G decisions); the stub issuer's screens (`12-…`, `17-…`) say "STUB IdP — not World" and are
never the World beat.

| Time | Screen | On-screen caption | Narration |
| --- | --- | --- | --- |
| 0:00–0:10 | Title card: the duck photo, "Vitaquack" | Don't give a robot your wallet. Give it a budget. | "Robots are starting to run errands. To pay, they need money — but handing a robot a funded key is handing it your wallet." |
| 0:10–0:22 | `$APP/` home, typing a name, the passkey prompt | Passkey wallet on Arc | "So the owner signs up with a passkey. That passkey is also the signer of a smart account on Arc mainnet." |
| 0:22–0:30 | ✅ `01-signed-up.png` → ✅ `02-wallet.png` (balance, Copy address) | USDC on Arc, no seed phrase | "Here's the account. Gas on Arc is USDC, so the owner just sends it USDC." |
| 0:30–0:42 | ✅ `03-pairing-code.png`, the laptop terminal running the mock chip with `--pair`, the card flips to "paired · online" | The robot's chip holds its own key | "We add the duck. Its chip has its own key and pairs with a one-time code. The robot never touches the owner's money directly." |
| 0:42–0:58 | ✅ `04-grant-consent.png` (the sentence), passkey prompt, ✅ `05-grant-active.png` (1.00/0.30) | One signature = programmable money on Arc | "The owner grants it a budget: a dollar a day, thirty cents per payment, only at Duck Café, for a day. One passkey signature — and Arc checks every one of those limits on every payment." |
| 0:58–1:14 | ✅ Console: "Buy Chai (0.10 USDC)" → "0G decided to pay: …" with the request id (`06-console-live.png`, run 7; never record the rehearsal brain's line for this beat) | 0G is the brain | "Buy me a chai. The robot's agent asks 0G whether to buy, over plain facts — the price, the budget, the policy — and logs 0G's request id. If 0G doesn't answer, the duck stops. It never guesses." |
| 1:14–1:26 | ✅ Console: "The chip signed the payment" → "chai: paid" → click "Payment on Arc" (explorer) (`07-console-ended.png`) | The chip signs; Arc settles | "The chip rebuilds the payment from the invoice, checks its own policy and signs. Our x402 facilitator settles it, and Arc checks the caps." |
| 1:26–1:34 | ✅ Second screen: the gate goes from CLOSED (`08-gate-closed.png`) to **OPEN** (`08-gate-open.png`) | Final in under a second | "Arc is final in under a second. The till sees a signed 'paid' — and the gate opens." |
| 1:34–1:48 | ✅ Console: "Buy Cigarettes (0.50 USDC)" → "0G decided to ask you first" → "Approve in World App" (`10-restricted-approve-asks.png`) → the approval page (item, amount, payee) | Over the cap → a human checkpoint | "Now cigarettes, for fifty cents. That's over the cap and on the owner's ask-me-first list, so 0G asks the owner — and Arc would refuse it without an approval anyway." |
| 1:48–2:00 | 🌍 "Approve with World" → World sign-in on the phone → **deny** → "Denied: nothing is paid" | Deny → nothing is paid | "The owner gets a fresh World ID check on the phone, bound to this exact payment — and says no. Nothing is paid; there's no transaction at all." |
| 2:00–2:12 | 🌍 Again → **approve** → "Approved: the chip signs the payment now" → console "cigarettes: paid" | Approve once → paid once | "Ask again and approve. Our backend verifies World's token and co-signs exactly this invoice, payee and amount, once." |
| 2:12–2:24 | ✅ Robots page: "Revoke grant" → passkey → "(revoked)" + revoke tx (`20-revoked.png`); console "Buy Chai" → "failed … CannotUseADisabledDelegation" (`21-after-revoke.png`) | Revoke → Arc refuses | "Revoking is one more passkey signature. The next purchase fails on Arc itself — our servers couldn't override that even if they wanted to." |
| 2:24–2:34 | 🟡 Arc Studio project (https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75): `RobotPaymentPolicyEnforcer` source and its tests passing → the enforcer on the Arc explorer (`0x7c2167B0…68e4D3`) | Built in Arc Studio · reusable by any agent wallet | "The policy is one open contract, built and tested in Arc Studio: a caveat any agent wallet using MetaMask delegations can reuse." |
| 2:34–2:44 | 🟡 Architecture page (`eth-mumbai-site…/architecture/`) → the run-7 chai episode on 0G Storage (root `0xac43d8a4…82dd`) → its `EpisodeLog` record tx ([0xd5b631b8…261b](https://chainscan-galileo.0g.ai/tx/0xd5b631b87c388563d4fb750194149b8a24cab2af323c1e34224611e9fb38261b)) | Arc = the rules · 0G = brain + memory · World = the human | "Every episode, with its 0G request ids, is stored on 0G Storage and anchored on 0G Chain. Arc holds the rules, 0G is the brain, World is the human." |
| 2:44–2:52 | Closing card: repo URL, "Built at ETHGlobal Mumbai" | github.com/grmkris/eth-global-mumbai-2026 | "Vitaquack. Give your robot a budget, not your wallet." |

## Slide/card text (≤ 4 bullets each)

- Title: "Vitaquack — Don't give a robot your wallet. Give it a budget."
- How it works: "Passkey wallet on Arc" · "Budget = one delegation, enforced on-chain" · "0G decides, the chip signs" · "World approves what the budget doesn't cover"
- Close: repo URL · deployed URL · "Arc · 0G · World"

## Recording notes

- Grant **1.00 a day / 0.30 per payment**: chai 0.10 then cigarettes 0.50 is 0.60 in the day, under the daily cap that
  Arc enforces even for an approved payment (`ERC20PeriodTransferEnforcer`); a 0.50 daily cap would make the approved
  cigarettes revert.

- Use the 4-minute demo order in `docs/demo.md`; the video is the same story, cut to 2:52.
- Keep the explorer tabs on screen for a beat so judges can read a real tx hash.
- If 0G or World is not live at recording time, do not fake those beats: show the safe stop ("Reason: …") for 0G and
  the owner's own Deny for the deny beat, and say so in the narration.
