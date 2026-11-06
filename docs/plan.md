# Plan v3.6: Vitaquack at ETHGlobal Mumbai

The build order is `docs/spec.md` and the decision log is `docs/decisions.md`. Where this file disagrees with them, they
win. The click-by-click walkthrough is `docs/demo.md`, the form text is `docs/submission.md`, and every proven run is
indexed in `docs/evidence/README.md`. Git history keeps the earlier versions of this plan (status boards, checkpoints,
spikes).

Submissions close **Sat 7 Nov 09:00 IST, no late entries**. Aim for 08:00.

## Where things stand (Sat 7 Nov)

- Live: the wallet at https://vitaquack.com/app/, public proof pages at https://vitaquack.com/app/proofs (no sign-in;
  "Verify against 0G" runs in the reader's browser), the café till at https://cafe.vitaquack.com, the simulator duck at
  https://vitaquack.com/sim/, the shop at https://vitaquack.com/shop/ (USDC on Arc), the team site under
  https://vitaquack.com/plan/.
- Proven on the deployed app: the full loop with real 0G decisions, including a real Orb-verified World approval paid on
  Arc, revoke, and episodes with chip-signed frames on 0G Storage and `EpisodeLog`. The evidence uploader runs as the
  systemd service `vitaquack-evidence-uploader` on netcup. Details and links: `docs/evidence/README.md`.
- Demo rules: grant defaults 3.00 a day and 1.00 per payment. The 2.00 thali is the over-limit approval beat, and a
  thali past the daily cap makes the robot walk away. No restricted item is sold. Every errand starts from the duck's
  scan.

## Still open before 09:00

| What | Who | Record in |
| --- | --- | --- |
| The live World deny on vitaquack.com: _fill in_ | Kris | `docs/submission.md` (World track) |
| The real-duck run (sign-up → chai pays → thali approve → thali deny → walk away → revoke) with the Radxa chip and the ESP32 counter screen: _fill in_ | Kris, teammates | `docs/evidence/demo-run.md` |
| The video (2:30 to 2:59, ≥ 720p, real narration): _fill in_ | Kris | `docs/video-script.md`, `docs/submission.md` Links |
| The Radxa scanner wiring (`docs/hardware-handoff.md` §5) | teammates | the real-duck run |
| The phone hotspot with the Radxa, ESP32 and laptops (H2, H6 in `docs/spikes/hardware-results.md` not yet run) | teammates | `docs/spikes/hardware-results.md` |
| A keyed Arc RPC URL (`APP_ARC_RPC_URL`); until then the Worker uses `https://arc-rpc.publicnode.com` | Kris | nothing to record |

After the event Kris revokes the Alchemy CLI OAuth grant.

Not on the critical path: Bun on the Radxa is not tested (H3 signs in Python at 187 ms), and the walking policy is
trained in simulation but has not run on the real duck (https://vitaquack.com/plan/duck-walk/). On-chain Agent Pass
verification (the S5b prototype) stays a stretch.

## Fallbacks, decided in advance

| If this fails | Then |
| --- | --- |
| Real-device passkey signing | the optional EOA owner on the Hybrid account signs (built in) |
| On-chain Agent Pass check | it is the stretch; the backend co-signer is the default |
| Bun on the Radxa | the Python signer from bench C1 (proven), or the mock chip on a laptop |
| Camera QR reading on the duck | the simulator duck's camera reads the same counter QR (`docs/evidence/2026-11-06-sim-e2e.md`) |
| 0G slow or down | that is the safe stop we must show anyway; never fake a decision |
| Venue network | the dedicated phone hotspot |
| The duck doesn't walk | demo the Radxa reading a QR and signing; never block the payment on the gait |

## Booth questions still open

- Arc: can judges open a Studio URL without logging in; is a Studio-authored enforcer deployed to mainnet by us
  acceptable; a keyed RPC.
