# Research notes

These notes were written on 5 and 6 Nov 2026, before and during the build. They are evidence, not the plan: build from
`docs/spec.md` and take decisions from `docs/decisions.md`. Notes about options we did not build (7702 session keys, a
wallet over MCP, the robot as an MCP server, the Nod/Froggy patterns, World Chain with ENS, and the two long World
notes) were removed on 7 Nov; git history has them, and `references/README.md` still names them in its last column.

| Note | What it holds | Still true? |
| --- | --- | --- |
| `arc-and-circle.md` | Arc facts, Gateway and CCTP, Arc Studio, the prize text | Yes |
| `0g.md` | 0G Router, Storage and Chain facts | Yes, except `0gm-1.0` TeeML, which left the catalogue |
| `0g-measurements.md` | Masashi's 6 Nov measurements: model choice, TEE verification, the prize checklist | Yes |
| `wallet-accounts-v2.md` | `HybridDeleGator` on Arc and simulated grant chains | Yes, except the owner → AI client → robot sub-delegation: the grant goes to the chip directly |
| `spike-s2-facilitator.md` | Our ERC-7710 facilitator, 14/14 on live Arc state; the source `packages/chain` was ported from | Yes |
| `spike-s5b-jwt-onchain.md` | Verifying a World token in an Arc contract | A stretch we did not build; the backend co-signs instead |
| `merchant-and-agent-commerce.md` | x402 shapes and facilitator findings | The x402 findings hold. The 18+ rule, a wallet-MCP `pay` and EIP-3009 acceptance were dropped |
| `bench-spikes.md` | The real Radxa signs the voucher (C1), Radxa bring-up, venue Wi-Fi | Yes; results in `../spikes/hardware-results.md` |
| `robots-and-embedded.md` | QR, ESP32 and signing options | Yes, except "pick Microduck": the duck is our modified Open Duck Mini |
| `voice-gpt-live.md`, `vita-voice-demo.md` | The talking duck on a laptop: 0G push-to-talk chosen over GPT-Live | Demo only, no app code |
| `stack-references.md`, `reference-additions.md` | Why each clone under `references/` exists | Yes |

Spike code is kept as text copies in `spikes/`. Proven runs are in `docs/evidence/`.
