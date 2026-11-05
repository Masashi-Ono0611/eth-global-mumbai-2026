# Decisions

Locked unless we deliberately reopen them.

| Decision | Choice | Why |
| --- | --- | --- |
| Event | ETHGlobal Mumbai | Team is there |
| Product | Open Duck Mini + USDC payments | Hardware story + on-chain budget |
| Chain | Arc **mainnet** (not testnet) | Real USDC demo; keep caps tiny while testing |
| Owner wallet | Our own passkey smart wallet (not Circle Modular Wallets) | We control the flow; sponsors do not provide a wallet |
| Robot wallet | Plain key on ESP32 | Simplest for the board; no smart-account logic on-device |
| Spending authority | On-chain delegation / allowance | Database cannot authorise spend |
| Preferred delegation stack | MetaMask Delegation Framework on Arc (already deployed) | Gas-free grant; robot signs exact spend; anyone can submit |
| Fallback if SDKs fight us | Small custom DuckWallet in Arc Studio | Same ESP32 signing shape |
| Backend / web foundation | Early **styldappv2** commit `370a0e23` (not stylelab v1): stack shell, **no** wardrobe logic | See `foundation.md`; HEAD skills + `repos/foldkit` for patterns |
| Infra shape (later) | Same family as stylelab / styld: Bun, Effect, Alchemy, Foldkit | One-to-one with how Kris likes to ship |
| Prize focus | Arc + 0G Physical AI + World Agent Pass | Best fit for body + budget + human gate |
| Frame / CROPS | Skip | Dilutes the demo |
| Restricted-item demo | Mock pack and/or World age / approval story | Safer than real cigarettes at venue |

## Non-decisions (still open)

See `open-questions.md`.


## Project name

- Folder / repo slug: `eth-global-mumbai-2026` (renamed from `ekhakon` on 2026-11-05).
- Display title for now: **ETH Global Mumbai 2026** (submission marketing name still open).
