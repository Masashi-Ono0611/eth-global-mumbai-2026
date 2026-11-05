# Decisions

Locked unless we deliberately reopen them.

| Decision | Choice | Why |
| --- | --- | --- |
| Event | ETHGlobal Mumbai | Team is there |
| Product | Platform for robots that pay: owners control and delegate payments to a fleet. The duck is the first robot (proof of concept) | Duck proves the loop; the platform is what scales |
| Money | USDC micropayments; owner holds a unified USDC balance | Robots spend small amounts often from one balance |
| Chain | Arc **mainnet** (not testnet) | Real USDC demo; keep caps tiny while testing |
| Owner wallet | **Passkey-native smart account**: MetaMask `HybridDeleGator` deployed by `SimpleFactory` on Arc, passkey verified on-chain (P-256 precompile). Decided by Kris 2026-11-05 (plan D1), replacing "EOA + 7702". 7702 (`EIP7702StatelessDeleGator`) stays the fallback; a MetaMask address can be added as an extra signer. No Privy/Circle wallets | Key never in browser JS, rotatable, works with any passkey; same delegation/grant system as 7702. Trade-offs: Arc-only address, ERC-1271 signatures. See `docs/research/wallet-accounts-v2.md`, `docs/plan.md` |
| Robot wallet | A plain secp256k1 key on the robot's chip; **the grant's delegate is the chip address** and **the chip signs every robot payment** (2026-11-05, plan v3 B). Iteration 1 uses a virtual chip (a Bun process with its own key, same WebSocket protocol). **Generated on the duck's brain (Radxa Zero 3W) and never leaves it** (2026-11-05). Storage tier 1 (now): encrypted keystore file, mode 600, own user, passphrase in a root-only systemd credential. Tier 2 (later): NXP SE050 secure element on I2C, variant C2 (C1 failed on secp256k1). OP-TEE on RK3566 is a closed blob: not now. See `docs/research/robots-and-embedded.md` §on-device signing | The on-chain grant caps what a stolen key can spend; hardware protection only narrows that further. One owner account, many robots, each with its own scoped key |
| Spending authority | On-chain grants: MetaMask Delegation Framework delegations with caveats (caps, expiry, revoke, sub-grants) | Database cannot authorise spend |
| Robot brain | **One Robot Agent Durable Object per robot = the AI client**: calls 0G, holds the wallet MCP connection (OAuth, consented once), runs the plan/act loop, logs evidence, talks to the chip over a WebSocket the chip opens; runs with no chip. Goblin-inspired (Agents SDK `Agent`, pi-ai, Goblin's MCP OAuth client), not Goblin itself (plan v3 A) | One place for brain + body + wallet link; headless iteration 1 needs no hardware |
| Payments | **x402 now, MPP later. Grant + float.** Grant path: chip signs a one-time leaf delegation, our x402 facilitator (exact / ERC-7710) redeems it, every cap checked on Arc. Float path for EIP-3009-only sellers: the chip pulls the exact amount (a capped grant payment to itself), then pays via **Circle's Facilitator Service**. Our merchant accepts both (plan v3 C, D) | Caps on-chain for our merchants; still able to pay any x402 seller |
| Owner actions | **Relayer primary, ERC-4337 break-glass.** Passkey signs a one-time delegation; our facilitator/relayer submits it. If the DelegationManager is paused: a v0.7 user op via Pimlico's public bundler, gas paid by the account in USDC. On chains without USDC gas: 4337 + a USDC paymaster (plan v3 H) | Same code as the facilitator; no relayer can steal, only delay |
| 0G | Standard providers (no TEE) for the hackathon (plan v3 E) | TEE providers are absent today; the prize doesn't need them |
| World | **Agent Pass only**: over-limit and restricted items need a fresh approval in World App; our backend verifies the ID token and co-signs that payment; `HumanApprovalEnforcer` on Arc checks it. IDKit registry dropped (plan v3 F) | Main World track; chain-agnostic OIDC fits Arc |
| Venue network | macOS Internet Sharing (Ethernet → Wi-Fi, 2.4 GHz channel, WPA2/WPA3); fallback phone hotspot on its own mobile data (plan v3 I) | Reverse tether into an Android hotspot doesn't route hotspot clients |
| Sponsors | Arc, 0G, World. No others | Arc = money, 0G = decisions, World = human approval |
| Backend / web foundation | Early **styldappv2** commit `370a0e23` (not stylelab v1): stack shell, **no** wardrobe logic | See `foundation.md`; HEAD skills + `repos/foldkit` for patterns |
| Infra shape (later) | Same family as stylelab / styld: Bun, Effect, Alchemy, Foldkit | One-to-one with how Kris likes to ship |
| Prize focus | **Arc: Advanced Stablecoin Logic** (built in Arc Studio: `RobotPaymentPolicyEnforcer` + `HumanApprovalEnforcer`, reusable "robot allowance" module) + **0G Physical AI** + **World Agent Pass** (plan v3 G) | Best fit for body + budget + human gate |
| Frame / CROPS | Skip | Dilutes the demo |
| Restricted-item demo | Mock pack and/or World age / approval story | Safer than real cigarettes at venue |

## Non-decisions (still open)

See `open-questions.md`. Also open since 2026-11-05:

- ~~Which 7702 implementation~~ Superseded: owner account is passkey-native `HybridDeleGator`; Arc supports 7702 (verified) for the fallback.
- What "unified balance" means on the wire: Circle's unified USDC balance product or just one Arc balance.
- ~~Which robot we have~~ **Answered 2026-11-05:** our own modified [Open Duck Mini](https://github.com/apirrone/Open_Duck_Mini): different servos, plus a camera and components for scanning QRs and signing. Brain: Radxa Zero 3W. Radxa OS, servos and walking policy: owned by Kris's teammate (plan v3 J).


## Project name

- Folder / repo slug: `eth-global-mumbai-2026` (renamed from `ekhakon` on 2026-11-05).
- Display title for now: **ETH Global Mumbai 2026** (submission marketing name still open).
