# Brief for the coding agent

Docs-only repo today: `/home/kristjan/code/eth-global-mumbai-2026`. Read these in order, then scaffold **code** elsewhere (suggested: `/home/kristjan/code/eth-global-mumbai-2026-app` or similar) — do not dump product code into this docs folder unless Kris asks.

1. `README.md` — product and hard rules
2. `docs/vision.md` — demo script
3. `docs/prizes.md` — Arc + 0G + World
4. `docs/decisions.md` — locked choices
5. `docs/foundation.md` — **styldappv2 commit pin + Foldkit/skills references**
6. `docs/brainstorm-chatgpt-robot-payments.md` — hardware / gate / offline brainstorm
7. `docs/open-questions.md` — answer or propose answers before big forks

### Non-negotiables

- Bootstrap from styldappv2 commit `370a0e23` (foundation), not from wardrobe-era HEAD and not from stylelab v1.
- Bring `repos/foldkit` + relevant `.agents/skills` pattern library forward.
- Arc **mainnet**; on-chain spending authority; duck key never leaves the device.
- Gate ESP32 must not trust an unverified “I paid” claim from the duck.
- World approval that must block payment needs an on-chain/co-signer condition if we claim cryptographic enforcement.
