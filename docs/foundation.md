# Software foundation (styldappv2)

Reference tree on Netcup: `/home/kristjan/code/styldappv2`  
Remote: `https://github.com/grmkris/styld.app` (history as present on that clone)

This is the stack shell we want to **port from**, not the wardrobe product. `~/code/stylelab` is Styld v1 (maintenance only); do not bootstrap from it.

## Recommended commit to copy

**Primary pin:** `370a0e23d3595abf9963d3a65be33fccc393907c`  
Message: *Record foundation boundary review acceptance* (2026-10-28)

**Also good:** `9af7c51783e9c67c7f59a1ff47e1ebc2f11c819a`  
Message: *Record final foundation preview readback* (same day, slightly earlier)

At these commits the repo has Bun workspaces, Effect, Alchemy, Foldkit web shell, D1/R2/auth persistence, public edge + API + SSR topology, and quality gates — **before** wardrobe / pieces / try-on product work.

**Do not use HEAD / current styldappv2 tip** as the copy source for product modules. Wardrobe business logic starts at:

- `68e12b0e685ae95717237a00cd5f10af83d36852` — *Keep a wardrobe of pieces…* (2026-10-29)

Everything from that commit onward is product. Keep studying HEAD for patterns and skills, but scaffold from the foundation pin.

**Optional:** `1c9fe94c22345033af200ee1ae3359bb835f601f` — *Vendor Foldkit…* lands the `repos/foldkit` agent reference shortly after the foundation pin. Prefer including that snapshot (or re-pulling it) so coding agents can read Foldkit examples without guessing.

### How a coding agent should bootstrap

```sh
cd /home/kristjan/code
git clone /home/kristjan/code/styldappv2 eth-global-mumbai-2026-app   # or clone github.com/grmkris/styld.app
cd eth-global-mumbai-2026-app
git checkout 370a0e23d3595abf9963d3a65be33fccc393907c
# then rename package/resource ids, drop Domain credit-wallet product assumptions,
# and add duck / Arc / World / 0G modules — do not replay wardrobe history
```

Or: `git archive 370a0e23 | tar -x -C ~/code/eth-global-mumbai-2026-app` into a fresh git repo.

## What lives under `repos/` on latest HEAD

Pinned in `repos/sources.json` (verified by `bun tools/vendored.ts` / `vendor:check`):

| Snapshot | Upstream | Ref / commit | Role |
| --- | --- | --- | --- |
| `repos/foldkit/` | [foldkit/foldkit](https://github.com/foldkit/foldkit) | `foldkit@0.170.0` / `a471adb24d750ab9e8d8312edad53ff6f26d961b` | Read-only Foldkit source, examples, skills (`audit-program`, `generate-program`, `foldkit`). Refresh with `bun tools/vendored.ts --pull foldkit foldkit@<version>`. Never edit in place. |

At inspection time this was the **only** entry under `repos/`. The “bunch of references” for stack patterns are mostly the **vendored agent skills** under `.agents/skills/` (see below), plus Foldkit’s own examples inside `repos/foldkit/examples/` (SSR, auth, query-sync, websocket-chat, etc.).

`FOLDKIT.md` at repo root is copied from the Foldkit snapshot; `vendor:check` rejects drift.

## Vendored skills (latest HEAD) — pattern library for agents

Pinned in `.agents/skills/sources.json`. Coding agents should load the matching skill before work. Especially relevant for eth-global-mumbai-2026:

| Skill | Upstream | Why it matters here |
| --- | --- | --- |
| `foldkit`, `generate-program`, `audit-program` | foldkit/foldkit @ 0.170.0 | UI / SSR program shape |
| `alchemy-domain` | alchemy-run/alchemy | Alchemy Domain models (do **not** reuse Styld credit-wallet product; Arc USDC limits are on-chain) |
| `learn-alchemy`, `test-behaviour`, `investigate-a-failure` | joelhooks/rat-stack | Alchemy + behaviour testing habits |
| `durable-objects`, `workers-best-practices`, `web-perf`, `wrangler` | cloudflare/skills | Workers / DO / perf (Alchemy still owns deploy; wrangler skill is reference) |
| `zyzz`, `good-css`, `frontend-design`, animation skills | various | Styling / UX (zyzz, not Tailwind) |
| `domain-modeling`, `grilling` | mattpocock/skills | Domain modelling discipline |
| `x18n*` | x18n-dev/x18n | i18n if kept |
| `effect` | present under `.agents/skills/effect` | Effect 4 conventions used by Styld |
| `styld-telemetry` | local | Effect → Workers Logs patterns |

Full list and commits: read `/home/kristjan/code/styldappv2/.agents/skills/sources.json`.

## Docs inside styldappv2 worth reading before porting

- `AGENTS.md` — architectural rulebook (exact pins, Effect layers, module ownership, vendor rules)
- `docs/ARCHITECTURE.md`
- `docs/DEPLOYMENT.md`
- `docs/DELIVERY.md` / `docs/HANDOFF.md` (historical; skim)
- `FOLDKIT.md`

## Alignment with eth-global-mumbai-2026 product rules

- Copy **infra + conventions**, not wardrobe / imaging / stylist / Dodo / credit Domain wallet product.
- Spending authority stays on **Arc mainnet** (see `decisions.md`). Cloudflare coordinates; it does not authorise spend via D1 alone.
- Port skills + Foldkit snapshot so the coding agent has the same pattern library Styld uses today.

## Note on “stylelab”

`/home/kristjan/code/stylelab` is the older Styld v1 app (agents mark it maintenance-only; v2 is styldappv2). The empty foundation we want is the **early styldappv2 commit above**, not an early stylelab commit.
