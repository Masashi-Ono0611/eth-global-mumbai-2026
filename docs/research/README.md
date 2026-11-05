# Research notes: index and status

Research is evidence, not the plan. Build from `docs/spec.md`; decide from `docs/decisions.md`. Status as of Fri 6 Nov 2026.

| Note | Status | Notes |
| --- | --- | --- |
| `arc-and-circle.md` | current evidence | Arc facts, Gateway/CCTP, Studio, prize text |
| `wallet-accounts-v2.md` | current evidence | HybridDeleGator on Arc, simulated grant chains. Its sub-delegation chain (owner → AI client → robot) is superseded: the grant goes to the chip directly |
| `spike-s2-facilitator.md` | current evidence (simulated) | our ERC-7710 facilitator, 14/14 on live Arc state; port source for `packages/chain` |
| `spike-s5b-jwt-onchain.md` | stretch only | on-chain World token verification; the event uses the backend co-signer |
| `bench-spikes.md`, `../spikes/hardware-results.md` | current evidence | the real Radxa signs the voucher (C1); Radxa bring-up, venue Wi-Fi |
| `0g.md` | current evidence | 0G router/storage/chain facts. `0gm-1.0` TeeML is gone from the catalogue; standard providers are the decision |
| `robots-and-embedded.md` | current evidence | QR, ESP32, signing options. "Pick Microduck" is superseded: the duck is our modified Open Duck Mini |
| `stack-references.md`, `reference-additions.md` | current | what is cloned under `references/` and why |
| `merchant-and-agent-commerce.md` | partly superseded | x402 shapes and facilitator findings stand; the 18+ rule / `buyer-eligibility`, wallet-MCP `pay` and EIP-3009 acceptance are not the plan |
| `evm-accounts-and-payments.md` | superseded by decision | 7702 + session keys → passkey-native HybridDeleGator; offline/float paths dropped |
| `mcp-wallet-and-ai-client.md` | superseded by decision | Agents SDK DO + OAuth grant + sub-delegation → Effect service + D1, no MCP on the critical path |
| `nod-froggy-patterns.md` | superseded by decision | OAuth/MCP grant ceremony and a DO per wallet → consent page + D1 |
| `robot-browser-and-mcp.md` | superseded by decision | WebSocket + robot MCP + Microduck sim → HTTPS long-polling, no frames, no sim |
| `world.md`, `world-v2.md` | partly superseded | Agent Pass facts stand; device flow → browser flow with `nonce`; HumanRegistry/18+ dropped |
| `worldchain-ens-alternative.md` | decided against | stay on Arc; ENS optional later; prize picks Arc + 0G + World |

Spike code (text copies): `spikes/`. Mainnet smoke evidence will live in `docs/evidence/`.
