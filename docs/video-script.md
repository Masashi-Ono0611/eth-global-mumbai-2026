# Video storyboard (2:50)

Follows plan §0 "Demo script". Rules (spec §12): 2:30–2:59 so it satisfies both ETHGlobal (2–4 min) and 0G (< 3 min),
≥ 720p (record 1920×1080 screen, phone shots mirrored or filmed in the screen recording, never a phone filming a
screen), **Kris's own voice** (no AI voice), real speed (no speed-up; cut instead), at most 4 bullets on any slide.
Never say "age check": it is an **approval for a restricted item**.

**Shot status:** ✅ = we already have this screen (`docs/evidence/screens/`); 🟡 = needs the funded run with 0G
configured (`packages/server/scripts/wallet-browser.ts --fund 0.15`, or the live demo); 🌍 = also needs the World IdP
client. Record every 🟡/🌍 shot in one continuous take on the deployed app so the tx hashes on screen are real.

| Time | Screen | On-screen caption | Narration |
| --- | --- | --- | --- |
| 0:00–0:12 | Title card: the duck photo, "Vitaquack" | Don't give a robot your wallet. Give it a budget. | "Robots are starting to run errands. To pay, they need money — but handing a robot a funded key is handing it your wallet." |
| 0:12–0:24 | `$APP/` home, typing a name, the passkey prompt | Passkey wallet on Arc | "So the owner signs up with a passkey. That passkey is also the signer of a smart account on Arc mainnet." |
| 0:24–0:34 | ✅ `01-signed-up.png` → ✅ `02-wallet.png` (balance, Copy address) | USDC on Arc, no seed phrase | "Here's the account. It exists before any transaction; the owner just sends it USDC." |
| 0:34–0:46 | ✅ `03-pairing-code.png`, the laptop terminal running the mock chip with `--pair`, the card flips to "paired · online" | The robot's chip holds its own key | "We add the duck. Its chip has its own key and pairs with a one-time code. The robot never touches the owner's money directly." |
| 0:46–1:02 | ✅ `04-grant-consent.png` (the sentence), passkey prompt, ✅ `05-grant-active.png` (today's shots say 0.50/0.25; the funded run re-takes them with 1.00/0.30) | One signature = a budget, enforced on Arc | "The owner grants it a budget: a dollar a day, thirty cents per payment, only at Duck Café, for a day. One passkey signature. Arc will enforce every one of those limits." |
| 1:02–1:16 | 🟡 Console: "Buy Chai (0.10 USDC)" → "0G decided to pay: …" with the request id (only with the real 0G key; never record the rehearsal brain's line for this beat) | 0G decides, with a request id | "Buy me a chai. The robot's agent asks 0G whether to buy, over plain facts — the price, the budget, the policy. Every decision is logged with 0G's request id." |
| 1:16–1:28 | 🟡 Console: "The chip signed the payment" → "chai: paid" → click "Payment on Arc" (explorer) | The chip signs; Arc settles | "The chip rebuilds the payment from the invoice, checks its own policy and signs. Our x402 facilitator settles it, and Arc checks the caps." |
| 1:28–1:36 | 🟡 Second screen: the gate goes from CLOSED (✅ `08-gate.png`) to **OPEN** | Gate opens on a signed "paid" | "The till sees a signed 'paid' — and the gate opens." |
| 1:36–1:50 | 🟡 Console: "Buy Cigarettes (0.50 USDC)" → "0G decided to ask you first" → "Approve in World App" → the approval page (item, amount, payee) | Restricted item → the owner decides | "Now a pack of cigarettes. It's restricted and over the cap, so 0G asks the owner, and Arc would refuse it without an approval anyway." |
| 1:50–2:02 | 🌍 "Approve with World" → World sign-in on the phone → **deny** → "Denied: nothing is paid" | Deny → nothing is paid | "The owner gets a fresh World ID check on the phone — and says no. Nothing is paid; there's no transaction at all." |
| 2:02–2:14 | 🌍🟡 Again → **approve** → "Approved: the chip signs the payment now" → console "cigarettes: paid" | Approve once → paid once | "Ask again and approve. That approval covers exactly this invoice, payee and amount, once." |
| 2:14–2:26 | 🟡 Robots page: "Revoke grant" → passkey → "(revoked)" + revoke tx; console "Buy Chai" → "failed … CannotUseADisabledDelegation" | Revoke → Arc refuses | "Revoking is one more passkey signature. The next purchase fails on Arc itself — our servers couldn't override that even if they wanted to." |
| 2:26–2:40 | Architecture page (`eth-mumbai-site…/architecture/`), the enforcer in Arc Studio, the episode's 0G Storage root hash + EpisodeLog tx (🟡) | Arc = authority · 0G = brain + memory · World = human | "Under the hood: MetaMask delegations and our enforcer on Arc, 0G for decisions and the episode log, World for the human in the loop." |
| 2:40–2:50 | Closing card: repo URL, "Built at ETHGlobal Mumbai" | github.com/grmkris/eth-global-mumbai-2026 | "Vitaquack. Give your robot a budget, not your wallet." |

## Slide/card text (≤ 4 bullets each)

- Title: "Vitaquack — Don't give a robot your wallet. Give it a budget."
- How it works: "Passkey wallet on Arc" · "Budget = one delegation, enforced on-chain" · "0G decides, the chip signs" · "World approves restricted items"
- Close: repo URL · deployed URL · "Arc · 0G · World"

## Recording notes

- Grant **1.00 a day / 0.30 per payment**: chai 0.10 then cigarettes 0.50 is 0.60 in the day, under the daily cap that
  Arc enforces even for an approved payment (`ERC20PeriodTransferEnforcer`); a 0.50 daily cap would make the approved
  cigarettes revert.

- Use the 4-minute demo order in `docs/demo.md`; the video is the same story, cut to 2:50.
- Keep the explorer tabs on screen for a beat so judges can read a real tx hash.
- If 0G or World is not live at recording time, do not fake those beats: show the safe stop ("Reason: …") for 0G and
  the owner's own Deny for the deny beat, and say so in the narration.
