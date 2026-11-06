# Vitaquack

**Don't give a robot your wallet. Give it a budget.**

A passkey wallet on [Arc](https://docs.arc.io) grants a USDC budget to a robot's chip. A Robot Agent asks [0G](https://0g.ai)
what to buy, the chip signs every payment, our x402 facilitator settles it, and Arc enforces every limit when the payment
lands. Over the per-payment limit, the owner approves once in World App ([World Agent Pass](https://auth.world.org)); the
daily cap is never lifted. The robot speaks to its owner on Telegram. The duck
([Vitaquack](https://github.com/apirrone/Open_Duck_Mini), our modified Open Duck Mini) is the first robot; a browser
simulator duck runs the same chip protocol. Live at <https://vitaquack.com>.

Built at ETHGlobal Mumbai, 5 to 7 Nov 2026. Prize tracks: Arc (Advanced Stablecoin Logic), 0G (Physical AI: Agents with
a Body), World (Agent Pass).

## How it works

1. **Wallet.** The owner signs up with a passkey. That passkey is the signer of a MetaMask `HybridDeleGator` smart account
   on Arc mainnet (verified on-chain with the P-256 precompile). The owner funds it with USDC.
2. **Grant.** The owner grants a robot's chip a budget ("$10/day, max $2 per payment, these merchants, until Sunday") by
   signing a MetaMask Delegation Framework delegation with the passkey, which needs no transaction and no gas.
3. **Robot Agent.** One errand state machine per robot: it asks 0G (`pay / ask_human / walk_away`) over structured
   input, logs the request id, and sends the chip a sign request over HTTPS long-polling.
4. **Chip.** The chip holds the only spending key, checks the invoice against its policy, builds the one-time payment
   voucher itself and signs it. If 35 s pass without a lease from the agent, the chip stops and refuses to sign.
5. **Merchant.** An x402 checkout. Our facilitator verifies the voucher, simulates, and submits `redeemDelegations`; Arc
   checks the daily cap, the per-payment cap, the payee allowlist, the invoice replay guard, expiry and revocation.
6. **World.** When a payment is over the per-payment cap, the owner approves it in World App, and the backend verifies
   the token and co-signs that one payment. Deny (on the page, in the conversation or from Telegram) or expiry means
   nothing is paid; the daily cap can't be lifted.
7. **Evidence.** Every decision is logged with its 0G request id and, for `glm-5.3`, its TEE proof; episodes and the
   chip-signed camera frames are uploaded to 0G Storage and anchored in an `EpisodeLog` contract. The café's ESP32
   screen shows the counter's invoice QR and opens only on an Ed25519-signed "paid".

The one rule: **Arc is the authority.** Our servers coordinate and relay, so they can delay a payment but can never
authorise, steal or redirect one.

## Status

- **Live:** the wallet at <https://vitaquack.com/app/>, the landing at <https://vitaquack.com/>, the café till at
  <https://cafe.vitaquack.com>, the simulator at <https://vitaquack.com/sim/>, the team site under
  <https://vitaquack.com/plan/> (the [architecture page](https://vitaquack.com/plan/architecture/) carries the status
  board; pages are commentable).
- **Docs and design:** `docs/spec.md` (the build order), `docs/decisions.md`, `docs/plan.md`; `docs/demo.md` is the
  click-by-click walkthrough; `docs/evidence/README.md` indexes every proven run.
- **Proven on mainnet and live providers** (`docs/evidence/`): chip-signed payments settled under passkey-signed grants,
  replay refused, revoke, the next payment refused by Arc; the `RobotPaymentPolicyEnforcer` on Arc; real 0G decisions
  (`glm-5.3` in a TEE, proofs verified independently); episodes and camera frames on 0G Storage, anchored in
  `EpisodeLog`; a real Orb-verified World approval that paid on Arc; the simulator duck paying a chai on 0G navigation.
  Not yet proven on stage: the full run on vitaquack.com with the real duck, the Radxa chip and the ESP32 counter screen.
- **Code:** built from `docs/spec.md` during the event (see the commit history); every stack is deployed by CI from
  `main` through Alchemy (`docs/DEPLOYMENT.md`).

## Repo map

| Path                      | What                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/web`                | Foldkit SSR app: wallet, robots as conversations, approvals, merchant demo, virtual gate        |
| `packages/server`         | the API Worker: auth, wallet, robot agent, merchant, chip protocol, World                       |
| `packages/protocol`       | shared schemas and hashes (invoice hash, chip messages, x402, approval)                         |
| `packages/chain`          | Arc: delegations, facilitator, relayer (viem + MetaMask Smart Accounts Kit)                     |
| `contracts`               | `RobotPaymentPolicyEnforcer` (Arc) and `EpisodeLog` (0G Chain), Foundry; authored in Arc Studio |
| `apps/chip`               | the chip client (mock chip now; the Radxa runs the same code)                                   |
| `apps/merchant`           | the café till (cafe.vitaquack.com): puts an item on the ESP32 counter screen                    |
| `apps/sim`                | the browser simulator duck (Pollen's Microduck engine, vendored) with a software chip           |
| `tools/evidence-uploader` | uploads episodes and camera frames to 0G Storage and records them on 0G Chain                   |
| `docs/`                   | spec, decisions, plan, research, spikes, evidence, the team site (`docs/site`)                  |
| `references/`             | read-only upstream clones (gitignored; pinned in `references/README.md`)                        |

## Run it

```sh
bun install
heavy --wait bun run check        # the full gate (format, typecheck, lint, knip, tests, native workerd tests)
bun run dev:preview               # local Alchemy stage
```

Deploys go through Alchemy on every green push to `main` (`docs/DEPLOYMENT.md`). Secrets are never in the repo.

## Code that predates the event

The application shell was imported on 5 Nov 2026 as a single commit from the public
[`grmkris/styld.app`](https://github.com/grmkris/styld.app) repository at commit `370a0e23` (Bun workspaces, Effect 4,
Alchemy on Cloudflare, Foldkit, D1/R2, quality gates). It contains no product logic; Styld's product was never part of
this repo. Everything about wallets, grants, robots, merchants, chips, World and 0G was written during the event, in
small commits. Research notes under `docs/research/` and the spike code under `docs/research/spikes/` were produced
during the event too.

## Team

Kris (software, orchestrating the agents), two teammates on the physical duck and 0G. Agents: Claude Code sessions on
this repo (see `AGENTS.md`).
