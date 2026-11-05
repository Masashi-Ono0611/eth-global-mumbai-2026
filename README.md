# ETH Global Mumbai 2026

Repo / folder: `eth-global-mumbai-2026`.

ETHGlobal Mumbai project notes for a walking duck robot that can pay with USDC.

This folder is **docs only** for now. No app code yet. The goal is to lock the story, rules, and prize plan before scaffolding.

## What we are building

A 3D-printed duck robot (Open Duck Mini) that:

1. Has its own wallet on the robot
2. Gets a spending limit from the owner's passkey wallet
3. Walks to a merchant, reads a payment QR with its camera
4. Pays in USDC on Arc mainnet
5. Optionally asks the owner (via World ID Agent Pass) before restricted or over-limit purchases

Demo beat: ask the duck to buy something, it walks, finds the QR, pays, comes back. Cigarettes are the joke version of the demo; use a mock pack or an age check for the real pitch.

## Why this matters

People should not hand a robot an open wallet. They should hand it a **budget**. The robot can spend inside that budget without the owner babysitting every cent, and the owner can revoke it instantly.

Offline bonus: the robot can sign a payment without network, then the merchant or a relay submits it later. The on-chain limit still applies when it lands.

## Prize tracks we are aiming at

- **Arc / Circle** — advanced stablecoin logic (must start in Arc Studio). One Arc track only.
- **0G** — Physical AI: Agents with a Body (decision loop + evidence + live booth demo).
- **World** — World ID Agent Pass (human approval for over-limit or restricted buys, including a denied path).

Easy optional add later: name the duck with ENSv2. Skipping Frame transactions and CROPS for now; they fight the Arc mainnet story.

## Hard rules

1. **On-chain is the authority.** Spending caps, revoke, and (where needed) World approval gates live on Arc. Cloudflare / our website only coordinates and records. A database row is never enough to authorise a payment.
2. **Mainnet, real USDC.** Keep the demo cap small (for example $20, or much less while testing).
3. **Robot key stays on the robot.** We never upload or store the ESP32 private key on our servers.
4. **Honest demos.** Show a denied / cancelled World path. Keep a real commit history. Prefer a mock restricted item if venue rules are awkward.
5. **Docs first, then foundation, then product.** No business logic until the shell is clean.

## Bootstrap plan (when we code)

Do **not** copy current styld.app / styldappv2 product modules.

Use **styldappv2 commit `370a0e23`** (foundation boundary review): Bun + Effect + Alchemy + Foldkit **without** wardrobe business logic. Not stylelab v1. Details in `docs/foundation.md`.

Then add only:

- owner passkey wallet + robot registration
- on-chain spending delegation
- World Agent Pass approval flow
- 0G decision step for Physical AI
- robot / ESP32 payment + QR path
- thin dashboard for the demo

## Software foundation (for the coding agent)

Reference clone: `/home/kristjan/code/styldappv2` (`github.com/grmkris/styld.app`).

- **Bootstrap from commit** `370a0e23` (_foundation boundary review_) — stack shell **without** wardrobe business logic.
- Wardrobe product starts at `68e12b0e`; do not copy that era as the base.
- `stylelab` is Styld v1 (maintenance); not the foundation.
- Latest HEAD’s pattern library: `repos/foldkit/` (only vendored repo snapshot today) plus `.agents/skills/` (Alchemy, Cloudflare Workers/DO, Foldkit, zyzz, Effect, etc.). Details in `docs/foundation.md`.
- Hardware / gate / offline brainstorm from ChatGPT: `docs/brainstorm-chatgpt-robot-payments.md`.
- Coding agent entrypoint: `docs/coding-agent-brief.md`.

## Folder layout (docs)

- `README.md` — this file
- `docs/vision.md` — product story and demo script
- `docs/prizes.md` — sponsor tracks and qualification checklist
- `docs/decisions.md` — choices we already made
- `docs/foundation.md` — styldappv2 commit pin + Foldkit/skills references
- `docs/brainstorm-chatgpt-robot-payments.md` — hardware / gate / offline brainstorm
- `docs/coding-agent-brief.md` — reading order for the coding agent
- `docs/infrastructure.md` — Cloudflare infrastructure brainstorm (for the team)
- `docs/open-questions.md` — what still needs answering
- `docs/research/` — optional copies of deeper research later

## Status

- Research done (sponsors, Arc stack, styld inspection)
- Non-technical foundation: in progress here
- Code scaffold: not started
- Hardware print / assemble: owner-owned timeline (start before the event if possible)
