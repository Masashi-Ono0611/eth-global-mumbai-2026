# Vision

## One-liner

A duck robot with a budget: your passkey wallet grants it a capped USDC allowance on Arc, it walks to the till, reads the QR, and pays.

## The feeling we want

Owners feel in control. The duck feels autonomous inside clear bounds. Judges see a real animal-shaped agent that moves money, not a slide about agents.

## Demo script (target)

1. Owner opens the site, creates a passkey wallet, funds a little USDC on Arc mainnet.
2. Robot shows its wallet address (already generated on the ESP32).
3. Owner grants "this duck may spend up to $20 until Sunday."
4. Owner says: "Duck, buy me [item]."
5. Duck walks toward the merchant stand.
6. Camera finds the payment QR.
7. If the buy is normal and under the limit: duck pays, merchant confirms, duck returns.
8. If the buy is over the limit or age-gated: phone gets a World Agent Pass prompt. Approve → pay. Deny / cancel / expire → duck does not pay. Show both paths.
9. Owner taps revoke; duck cannot spend any more.

## Offline moment (bonus, same story)

Duck signs the payment without Wi-Fi. Later the merchant or our relay submits it. If the cap is already used up, the late payment fails on-chain. First come, first served.

## What success looks like at judging

- Live or recorded walk + QR + on-chain payment receipt
- Clear remaining budget on the dashboard
- World deny path in the same demo
- 0G decision evidence if we claim Physical AI
- Arc Studio project link for the Arc prize

## What we are not building (this weekend)

- A general robot OS
- Multi-token wallets
- Production recovery / custody product
- Frame-transaction / alt-mempool work
- Full wardrobe / shopping product from styld

