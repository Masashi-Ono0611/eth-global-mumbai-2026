# 6 Nov, 17:00 to 18:10 IST: the demo's approval story becomes spending limits only

Kris decided (17:45 IST, via session -9e) that cigarettes leave the catalogue and the demo: the World approval beat
is a purchase over the per-payment cap, and the daily cap is never lifted. This file records what was proven for
that change before the deploy; the live run on the deployed app with Kris's own passkey, World App and the mock chip
is `demo-run.md` (still to record).

## What changed (commits on `main`, pushed 18:00 IST, deployed as release `39aac79`)

| Commit | Lane | Change |
| --- | --- | --- |
| `b3700d2` | M+R | Counter invoices: an invoice an owner was ever asked about is never offered to another errand. The new tests exposed a real bug: after a denied thali, the next thali errand reused the same counter invoice; its approval nonce is derived from the invoice, so the `INSERT … ON CONFLICT (nonce) DO NOTHING` was skipped silently and the approval page answered 404. That would have hit the demo on "deny, then ask again". |
| `5773a04` | M+R | Catalogue: chai 0.10, samosa 0.25, thali 2.00; no restricted item is sold (the restricted-item machinery and its separate payee stay, general and tested). The World stub acceptance approves and denies a thali. |
| `518ac36` | M+R | Decision table: an amount over `budget.remainingToday` is `walk_away` even when the owner asked (an approval cannot lift the daily cap); over the per-payment cap and asked is still `ask_human`. The prompt input states the daily-allowance fact as structure (`dailyAllowance: {exceeded, approvalCanLift: false, ownerCanRaise: true}`) and drops the approval hint. New native test `LimitsAcceptance.ts`. |
| `cf4ca7a`, `2dd6388` | Wallet redesign | Allowance presets default to 3.00 a day / 1.00 per purchase (daily choices 1.00 / 3.00 / 5.00); the consent sentence and the active grant's last rule read "A purchase over 1.00 asks you first in World App; nothing goes past 3.00 a day." |
| `1f70c46`, `f7df069`, `a32baf3`, `b9b099f`, `9faf467`, `2b818ae`, `9d479b0` | Docs, pitch | decisions, plan, spec (§6 daily-cap rule, catalogue, runbook step 8), demo.md, video-script, submission, world-debrief, hardware-handoff, the pitch page (8 screens, restricted beat removed), the script page, the architecture page's demo rules. |

## Evidence

Real model, 0G router, `glm-5.3` (TeeML): `packages/server/scripts/zg-probe.ts`, scenarios `chai | thali |
thali-over-today`, run by the M+R worker at 17:50 IST, 5 of 5 as the table says:

| Scenario | `remainingToday` | Decision |
| --- | --- | --- |
| chai 0.10 | 3.00 | `pay` |
| thali 2.00 (over the 1.00 per-payment cap) | 2.90 | `ask_human`, twice |
| thali 2.00 (over today's allowance) | 0.90 | `walk_away`, twice: "Over today's allowance; the owner can raise it." |

Native (workerd + D1), `packages/server/test/LimitsAcceptance.ts`, grant 3.00/day and 1.00/payment, a stub brain
that applies the decision table to what the Worker actually sent: chai → `pay` → `paid`; thali → `ask_human`
(`remainingToday` 2.90) → approved in the stub World → `signing` → `paid`; a second thali → `walked_away`
(`remainingToday` 0.90, `dailyAllowance.exceeded`), and the evidence records `walk_away` / `walked_away`; plus a
declined thali with no TEE proof. Full native suite: 24 pass, 0 fail.

Gate: `heavy --wait bun run check` at `a108be8` (the same tree as `518ac36`, docs aside) in a fresh worktree
after `bun install --frozen-lockfile`: exit 0 (a first run in a worktree with stale `node_modules` failed typecheck
with bogus "cannot find module" errors; not the code). CI "Checks and deploy" on `9eedd02` and `39aac79`: success.

Deployed: `GET /api/health` → `release 39aac79…`, every feature flag true. `GET /api/merchants/duck-cafe/items` →
`chai 100000`, `samosa 250000`, `thali 2000000`, none restricted, merchant `payTo` set.

## Not yet proven on the deployed app

The thali approval with the 3.00/1.00 grant and the daily-cap walk-away have run natively and against the real model,
not yet through the deployed pages with a real passkey, World App and the mock chip: that is the demo run
(`demo-run.md`). Later the same evening the thali `ask_human` ran on the deployed app through the simulator, with the
owner's No (`2026-11-06-sim-e2e.md`). The earlier live-World and 0G runs in this folder used the cigarettes catalogue,
and they stay as recorded.
