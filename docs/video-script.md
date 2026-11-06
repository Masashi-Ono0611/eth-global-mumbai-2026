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
| 0:22–0:30 | 🟡 re-take on the redesigned wallet (6 Nov): the wallet home (balance, Send/Receive/+ Robot) → **Receive** sheet (QR, Copy address) | USDC on Arc, no seed phrase | "Here's the account. Gas on Arc is USDC, so the owner just sends it USDC." |
| 0:30–0:42 | 🟡 **+ Robot** → "What's your robot called?" → the code and `./vitaquack-chip --pair CODE`, the laptop terminal running the chip, the page says **Duck connected** | The robot's chip holds its own key | "We add the duck. Its chip has its own key and pairs with a one-time code. The robot never touches the owner's money directly." |
| 0:42–0:58 | 🟡 the allowance presets (5.00 / 1.00 / Duck Café / 1 day) and the sentence, **Confirm with passkey**, then Duck's conversation with **5.00 a day** in the header | One signature = programmable money on Arc | "The owner grants it a budget: five dollars a day, at most a dollar per payment, only at Duck Café, for a day. Anything over a dollar waits for the owner. One passkey signature — and Arc checks every one of those limits on every payment." |
| 0:58–1:14 | 🟡 Duck's conversation: tap **Chai 0.10** → "Asking 0G..." → **0G decided: buy it** with 0G's reason quoted (never record the rehearsal brain's line for this beat); the request id is on **Show proof** | 0G is the brain | "Buy me a chai. The robot's agent asks 0G whether to buy, over plain facts — the price, the budget, the policy — and logs 0G's request id. If 0G doesn't answer, the duck stops. It never guesses." |
| 1:14–1:26 | 🟡 "My chip is signing the payment..." → "Paying on Arc..." → the receipt **Paid with my chip 0.10 USDC** → click **On Arc** (explorer) | The chip signs; Arc settles | "The chip rebuilds the payment from the invoice, checks its own policy and signs. Our x402 facilitator settles it, and Arc checks the caps." |
| 1:26–1:34 | ✅ Second screen: the gate goes from CLOSED (`08-gate-closed.png`) to **OPEN** (`08-gate-open.png`) | Final in under a second | "Arc is final in under a second. The till sees a signed 'paid' — and the gate opens." |
| 1:34–1:48 | 🟡 Conversation: **Thali 2.00** → **0G decided: ask you first** → Duck's yellow "I need your OK" bubble with **Approve with World ID** / **No** (the wallet home shows it under **Needs you**) | Over the limit → a human checkpoint | "Now a thali, two dollars. That's over the duck's one-dollar limit, so 0G asks the owner — and Arc would refuse it without an approval anyway." |
| 1:48–2:00 | 🌍 **Approve with World ID** → World sign-in on the phone → **approve** → the approval page "Duck wants to buy thali", "over the robot's per-payment limit (2.00 > 1.00 USDC)" → "Approved: the chip signs the payment now" → "Paid · view on Arc"; **Back to Duck** shows the receipt | Approve once → paid once | "The owner gets a fresh World ID check on the phone, bound to this exact payment, and approves. Our backend verifies World's token and co-signs exactly this invoice, payee and amount, once." |
| 2:00–2:12 | 🌍 Conversation: **Cigarettes** → "I need your OK" → **Approve with World ID** → World App → **deny** (or **No** right in the bubble) → "You said no. Nothing was paid." | Restricted → the owner says no | "Cigarettes are on the owner's ask-me-first list whatever the price. The owner says no in World App: nothing is paid, there's no transaction at all." |
| 2:12–2:24 | 🟡 the **5.00 a day** pill → the allowance sheet → **Stop Duck's allowance** → passkey → "No allowance"; **Chai 0.10** → "The payment failed: …CannotUseADisabledDelegation" | Revoke → Arc refuses | "Revoking is one more passkey signature. The next purchase fails on Arc itself — our servers couldn't override that even if they wanted to." |
| 2:24–2:34 | 🟡 Arc Studio project (https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75): `RobotPaymentPolicyEnforcer` source and its tests passing → the enforcer on the Arc explorer (`0x7c2167B0…68e4D3`) | Built in Arc Studio · reusable by any agent wallet | "The policy is one open contract, built and tested in Arc Studio: a caveat any agent wallet using MetaMask delegations can reuse." |
| 2:34–2:44 | 🟡 Architecture page (`eth-mumbai-site…/architecture/`) → the run-7 chai episode on 0G Storage (root `0xac43d8a4…82dd`) → its `EpisodeLog` record tx ([0xd5b631b8…261b](https://chainscan-galileo.0g.ai/tx/0xd5b631b87c388563d4fb750194149b8a24cab2af323c1e34224611e9fb38261b)) | Arc = the rules · 0G = brain + memory · World = the human | "Every episode, with its 0G request ids, is stored on 0G Storage and anchored on 0G Chain. Arc holds the rules, 0G is the brain, World is the human." |
| 2:44–2:52 | Closing card: repo URL, "Built at ETHGlobal Mumbai" | github.com/grmkris/eth-global-mumbai-2026 | "Vitaquack. Give your robot a budget, not your wallet." |

## Slide/card text (≤ 4 bullets each)

- Title: "Vitaquack — Don't give a robot your wallet. Give it a budget."
- How it works: "Passkey wallet on Arc" · "Budget = one delegation, enforced on-chain" · "0G decides, the chip signs" · "World approves what the budget doesn't cover"
- Close: repo URL · deployed URL · "Arc · 0G · World"

## Recording notes

- Grant **5.00 a day / 1.00 per payment** (the form's defaults since 6 Nov): anything over 1.00 needs World approval.
  Chai 0.10 + an approved thali 2.00 (+ an approved cigarettes 0.50) is at most 2.60 in the day, under the daily cap
  that Arc enforces even for an approved payment (`ERC20PeriodTransferEnforcer`).

- Use the 4-minute demo order in `docs/demo.md`; the video is the same story, cut to 2:52.
- Keep the explorer tabs on screen for a beat so judges can read a real tx hash.
- If 0G or World is not live at recording time, do not fake those beats: show the safe stop ("Reason: …") for 0G and
  the owner's own Deny for the deny beat, and say so in the narration.
