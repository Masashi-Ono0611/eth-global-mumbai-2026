# Vitaquack

**Don't give a robot your wallet. Give it a budget.**

A passkey wallet on [Arc](https://docs.arc.io) grants a USDC budget to a robot's chip. A Robot Agent asks [0G](https://0g.ai)
what to buy, the chip signs every payment, our x402 facilitator settles it, and Arc enforces every limit when the payment
lands. Over the limit or for a restricted item, the owner approves once in World App ([World Agent Pass](https://auth.world.org)).
The duck ([Vitaquack](https://github.com/apirrone/Open_Duck_Mini), our modified Open Duck Mini) is the first robot.

Built at ETHGlobal Mumbai, 5–7 Nov 2026. Prize tracks: Arc (Advanced Stablecoin Logic), 0G (Physical AI: Agents with a
Body), World (Agent Pass).

## How it works

1. **Wallet.** The owner signs up with a passkey. That passkey is the signer of a MetaMask `HybridDeleGator` smart account
   on Arc mainnet (verified on-chain with the P-256 precompile). The owner funds it with USDC.
2. **Grant.** The owner grants a robot's chip a budget ("$10/day, max $2 per payment, these merchants, until Sunday") by
   signing a MetaMask Delegation Framework delegation with the passkey. No transaction, no gas.
3. **Robot Agent.** One errand state machine per robot: it asks 0G (`pay / ask_human / walk_away`) over structured
   input, logs the request id, and sends the chip a sign request over HTTPS long-polling.
4. **Chip.** The chip holds the only spending key, checks the invoice against its policy, builds the one-time payment
   voucher itself and signs it. No lease from the agent for 35 s → it stops and refuses to sign.
5. **Merchant.** An x402 checkout. Our facilitator verifies the voucher, simulates, and submits `redeemDelegations`; Arc
   checks the daily cap, the per-payment cap, the payee allowlist, the invoice replay guard, expiry and revocation.
6. **World.** Over the cap, or a restricted item (a mock cigarette pack): the owner approves in World App; the backend
   verifies the token and co-signs that one payment. Deny or expiry means nothing is paid.
7. **Evidence.** Every decision is logged with its 0G request id; episodes are uploaded to 0G Storage and anchored in an
   `EpisodeLog` contract. The gate (a web page now, an ESP32 later) opens only on an Ed25519-signed "paid".

The one rule: **Arc is the authority.** Our servers coordinate and relay; they can never authorise, steal or redirect a
payment, only delay it.

## Status

- **Docs and design:** `docs/spec.md` (the build order), `docs/decisions.md`, `docs/plan.md`, the live
  [architecture page](https://eth-mumbai-site.kristjan-grm11775.workers.dev/architecture/) and
  [plan page](https://eth-mumbai-site.kristjan-grm11775.workers.dev/plan/) (both commentable).
- **Evidence so far:** the first real payment on Arc mainnet (6 Nov 06:10 IST: a chip-signed $0.01 voucher under a
  grant, replay refused, revoke, next payment refused; `docs/evidence/2026-11-06-smoke.md`), the
  `RobotPaymentPolicyEnforcer` deployed on Arc (`docs/evidence/contracts.md`), simulated grant chains and approvals
  against live Arc state (`packages/chain/test`), a World token verifier prototype
  (`docs/research/spike-s5b-jwt-onchain.md`), and the real Radxa signing the payment voucher
  (`docs/spikes/hardware-results.md`). Not yet proven: a passkey-signed grant broadcast, a real 0G decision, the
  uploader against 0G Storage, World approve/deny.
- **Code:** built from `docs/spec.md` during the event (see the commit history); the passkey wallet, merchant, chip
  protocol, Robot Agent and facilitator are deployed by CI from `main`.

## Repo map

| Path                      | What                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/web`                | Foldkit SSR app: wallet, robot console, merchant demo, virtual gate                             |
| `packages/server`         | the API Worker: auth, wallet, robot agent, merchant, chip protocol, World                       |
| `packages/protocol`       | shared schemas and hashes (invoice hash, chip messages, x402, approval)                         |
| `packages/chain`          | Arc: delegations, facilitator, relayer (viem + MetaMask Smart Accounts Kit)                     |
| `contracts`               | `RobotPaymentPolicyEnforcer` (Arc) and `EpisodeLog` (0G Chain), Foundry; authored in Arc Studio |
| `apps/chip`               | the chip client (mock chip now; the Radxa runs the same code)                                   |
| `tools/evidence-uploader` | uploads episodes to 0G Storage and records them on 0G Chain                                     |
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
