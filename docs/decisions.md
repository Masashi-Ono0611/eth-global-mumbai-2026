# Decisions

Locked unless we deliberately reopen them.

| Decision | Choice | Why |
| --- | --- | --- |
| Event | ETHGlobal Mumbai | Team is there |
| Product | Platform for robots that pay: owners control and delegate payments to a fleet. The duck is the first robot (proof of concept) | Duck proves the loop; the platform is what scales |
| Money | USDC micropayments; owner holds a unified USDC balance | Robots spend small amounts often from one balance |
| Chain | Arc **mainnet** (not testnet) | Real USDC demo; keep caps tiny while testing |
| Owner wallet | Our own smart wallet: owner EOA upgraded with **EIP-7702** (not Circle Modular Wallets) | We control the flow; sponsors do not provide a wallet |
| Robot wallet | A plain secp256k1 key, the grantee of a (sub-)grant on the owner's smart wallet. **Generated on the duck's brain (Radxa Zero 3W) and never leaves it** (2026-11-05). Storage tier 1 (now): encrypted keystore file, mode 600, own user, passphrase in a root-only systemd credential. Tier 2 (later): NXP SE050 secure element on I2C, variant C2 (C1 failed on secp256k1). OP-TEE on RK3566 is a closed blob: not now. See `docs/research/robots-and-embedded.md` §on-device signing | The on-chain grant caps what a stolen key can spend; hardware protection only narrows that further. One owner account, many robots, each with its own scoped key |
| Spending authority | On-chain session-key permissions (caps, expiry, revoke) enforced by the 7702 account | Database cannot authorise spend |
| Sponsors | Arc, 0G, World. No others | Arc = money, 0G = decisions, World = human approval |
| Backend / web foundation | Early **styldappv2** commit `370a0e23` (not stylelab v1): stack shell, **no** wardrobe logic | See `foundation.md`; HEAD skills + `repos/foldkit` for patterns |
| Infra shape (later) | Same family as stylelab / styld: Bun, Effect, Alchemy, Foldkit | One-to-one with how Kris likes to ship |
| Prize focus | Arc + 0G Physical AI + World Agent Pass | Best fit for body + budget + human gate |
| Frame / CROPS | Skip | Dilutes the demo |
| Restricted-item demo | Mock pack and/or World age / approval story | Safer than real cigarettes at venue |

## Non-decisions (still open)

See `open-questions.md`. Also open since 2026-11-05:

- Which 7702 implementation the owner account delegates to (existing audited one vs ours built in Arc Studio), and whether Arc mainnet supports type-4 (7702) transactions.
- What "unified balance" means on the wire: Circle's unified USDC balance product or just one Arc balance.
- ~~Which robot we have~~ **Answered 2026-11-05:** our own modified [Open Duck Mini](https://github.com/apirrone/Open_Duck_Mini): different servos, plus a camera and components for scanning QRs and signing. Still open: exact servo model, duck brain (Radxa Zero 3W on the bench vs Pi Zero 2W vs NVIDIA board), and whether the walking policy has to be retrained for the new servos.


## Project name

- Folder / repo slug: `eth-global-mumbai-2026` (renamed from `ekhakon` on 2026-11-05).
- Display title for now: **ETH Global Mumbai 2026** (submission marketing name still open).
