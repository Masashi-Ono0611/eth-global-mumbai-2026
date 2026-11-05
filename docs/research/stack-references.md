# Stack references: upstream repos for the TypeScript/web stack

Snapshot: 2026-11-05. This covers the TypeScript/web stack only: Effect, Foldkit, Alchemy, auth, styling, tooling, skills and example apps. Chain, robot and hardware references are out of scope here.

Sources used to build the list: Styld HEAD (`~/code/styldappv2` @ `2df650f1`): root `package.json` catalog, `AGENTS.md`, `.agents/skills/sources.json`, `repos/sources.json`, `tools/oxlint/anti-slop/PROVENANCE.md`, `docs/research/stack-reference-review.md`, `docs/research/tooling-research.md`. Also Nod (`~/code/hack-meridian-2026`) and Froggy (`~/code/ethglobal-online-2026`). Upstream URLs were resolved from each package's `repository` field (`npm view <pkg> repository`) and checked with `gh api repos/<owner>/<repo>`.

All clones are `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1` into `references/<owner>_<repo>`, taken at the default branch except Drizzle (see below). Git ignores them (`.gitignore`: `references/*`). Treat them as read-only.

## Version drift to know about first

This repo's catalog is the Styld foundation pin (370a0e23). Styld HEAD and most clones are newer:

| Package | This repo | Styld HEAD | Clone HEAD |
| --- | --- | --- | --- |
| effect / @effect/* | 4.0.6 | 4.1.2 | 4.1.2 (`Effect-TS_effect/packages/effect/package.json`) |
| alchemy / @alchemy.run/* | 2.0.0-beta.84 | 2.0.0-beta.85 | 2.0.0-beta.85 |
| foldkit | 0.169.0 | 0.170.0 (+ `@foldkit/ui` 0.170.0) | 0.170.0, commit `a471adb24d` = Styld's `repos/foldkit` pin |
| @yielded/auth | 0.1.0-beta.46 | 0.1.0-beta.47 | 0.1.0-beta.47 |
| @yielded/effect-tsrs | 0.2.2 | 0.2.3 | 0.2.3 |
| tsrs | 0.20.0-ts7.1.0-beta | 0.21.0-ts7.1.0-beta (ships `tsrs-lint`) | main |
| effect-cf, zyzz, @maple-dev/effect-sdk | not installed | 0.59.0, 0.0.44, 0.13.1 | 0.59.0, 0.0.44, 0.13.1 |

The Effect, Alchemy, Foldkit, auth, effect-cf, zyzz and Maple clones match Styld HEAD's pins exactly. When reading them, remember this repo is one minor version behind until the catalog is bumped. The `tsrs-lint` crate exists upstream at `oxc-project_tsrs/crates/tsrs_lint`. Styld's `tools/tsrs-lint.ts` says the npm `tsrs` package has shipped it since 0.21, which replaces the `grmkris/tsrs` fork described in `docs/research/tooling-research.md`.

## Reference table

Licence is the clone's root `LICENSE` file. "none" means no licence file was found, so default copyright applies: read for patterns, do not copy code.

### Core stack (installed packages)

| Local path | Upstream | HEAD | Licence | What it is | Why it matters for us | Key paths |
| --- | --- | --- | --- | --- | --- | --- |
| `references/foldkit_foldkit` | https://github.com/foldkit/foldkit | `a471adb24d` | MIT | Foldkit monorepo: `foldkit`, `@foldkit/ui`, `@foldkit/vite-plugin`, `@foldkit/devtools-mcp`, `@foldkit/oxlint-plugin`, docs site, skills | The UI framework, its headless controls, SSR, devtools MCP and lint rules all come from this one repo | `AGENTS.md`, `packages/create-foldkit-app/templates/base/FOLDKIT.md`, `packages/foldkit/src`, `packages/ui/src/<control>`, `packages/ui/src/test`, `packages/devtools-mcp`, `packages/oxlint-plugin-foldkit/src/rules`, `examples/{ssr,auth,routing,form,websocket-chat,ui-showcase}`, `skills/{foldkit,generate-program,audit-program}` |
| `references/foldkit_foldkit-domains` | https://github.com/foldkit/foldkit-domains | `45e124c96f` | MIT | Foldkit example: domain search with editable static HTML and hydration | SSR/hydration pattern ([repo description](https://github.com/foldkit/foldkit-domains)) | `src/`, `AGENTS.md` |
| `references/foldkit_coverchart` | https://github.com/foldkit/coverchart | `220ccf075b` | none | Foldkit-authored app (chord charts) | Complex Foldkit composition plus Story/Scene tests (Styld review) | `src/`, `FOLDKIT.md`, `vitest.config.ts` |
| `references/wevm_zyzz` | https://github.com/wevm/zyzz | `388dfd28ad` | MIT | Typed styling library with a compiler, Vite/unplugin plugins and an oxlint plugin | Styld's styling layer. It has no Foldkit adapter, so Styld bridges with `apps/web/src/Styled.ts` (`zyzz/runtime` `Html.Attributes` → Foldkit attributes) | `AGENTS.md`, `src/{Style,Theme,variable,cx,Config}.ts`, `src/unplugin`, `src/oxlint`, `src/themes`, `site/` (docs, [zyzz.style](https://zyzz.style)) |
| `references/Effect-TS_effect` | https://github.com/Effect-TS/effect | `cb679e39ca` | MIT | Effect 4 monorepo (effect, platform-*, sql-*, vitest, ai) | Core runtime. `@effect/sql-d1` and `sql-sqlite-do` live here too | `packages/effect/{AGENTS.md,SCHEMA.md,HTTPAPI.md,MCP.md}`, `ai-docs/src/{08_observability,09_testing,40_sql,51_http-server}`, `packages/sql/{d1,sqlite-do}`, `packages/vitest`, `MIGRATION.md` |
| `references/alchemy-run_alchemy` | https://github.com/alchemy-run/alchemy | `5bbe9aa4d8` | Apache-2.0 | Alchemy v2 "Infrastructure as Effects": alchemy, cloudflare, domain, frontend-frameworks, test, drizzle | Owns infra, Workers/DO/D1/R2 bindings, Domain aggregates on DOs, Foldkit SSR hosting | `AGENTS.md`, `packages/cloudflare/src/{Workers,D1,R2,...}`, `packages/domain/{src,skills/alchemy-domain}`, `examples/cloudflare-{foldkit-ssr,domain,d1-drizzle,effect-sql-d1,durable-object-sql}`, `website/src/content/docs/{domain,cloudflare,testing}` |
| `references/yielded-dev_auth` | https://github.com/yielded-dev/auth | `bc4df04453` | MIT | `@yielded/auth` and its adapters (persistence, drizzle, workerd, simplewebauthn, oauth, react-native, electron) | Our auth. `auth-simplewebauthn` gives passkey ceremonies, which a robot owner's spending approval may need | `AGENTS.md`, `GLOSSARY.md`, `packages/auth`, `packages/auth-platform-workerd`, `packages/auth-persistence-drizzle`, `packages/auth-simplewebauthn` ([passkey guide](https://yielded.dev/auth/guide/passkeys)), `examples/` |
| `references/danieljvdm_effect-cf` | https://github.com/danieljvdm/effect-cf | `28f1ee52fe` | MIT | Effect-native Cloudflare bindings (D1, DO, alarms, queues, AI Gateway, Analytics Engine, tracer, OTLP) | Styld HEAD added it (`WorkerEnvironment`). Typed DO/alarm/storage wrappers | `AGENTS.md`, `packages/effect-cf/src/{Environment,DurableObject*,D1,Queue*,CloudflareTracer,AnalyticsEngine}.ts`, `examples/` |
| `references/drizzle-team_drizzle-orm` | https://github.com/drizzle-team/drizzle-orm (tag `v1.0.0-rc.5`) | `5d71fc408a` | Apache-2.0 | Drizzle ORM/Kit 1.0 RC | D1 schema and migrations. `main` is still 0.45.x, so the clone is at the [rc.5 tag](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.5) | `drizzle-orm/src/{d1,sqlite-core,durable-sqlite,effect-d1,effect-sqlite-do,effect-core}`, `drizzle-kit/` |
| `references/MapleTechLabs_maple` | https://github.com/MapleTechLabs/maple | `b7dcb26a79` | FSL-1.1-ALv2 (repo); `packages/effect-sdk/LICENSE` is MIT | OpenTelemetry platform. Its `@maple-dev/effect-sdk` has server, Cloudflare and Foldkit entry points | Styld HEAD's browser telemetry uses `MapleFoldkit` and consent from the SDK. Also has a Foldkit web app and an Alchemy stack | `packages/effect-sdk/src/{foldkit,cloudflare,client,server}`, `packages/alchemy-maple`, `alchemy.run.ts`, `AGENTS.md`, `DESIGN.md` |
| `references/phosphor-icons_core` | https://github.com/phosphor-icons/core | `2b75f3ad12` | MIT | Phosphor icon SVGs and catalog (`@phosphor-icons/core`) | Styld generates its icon set from it (`tools/icons.ts`) | `assets/`, `src/` |

### Quality tooling

| Local path | Upstream | HEAD | Licence | What it is | Why it matters | Key paths |
| --- | --- | --- | --- | --- | --- | --- |
| `references/oxc-project_tsrs` | https://github.com/oxc-project/tsrs | `c96e7683dc` | Apache-2.0 | Rust port of the TypeScript 7 checker, plus `tsrs-lint` | `typecheck:reference` and the type-aware Oxlint backend (`OXLINT_TSGOLINT_PATH`) | `README.md`, `crates/tsrs_lint`, `npm/tsrs`, `docs/` |
| `references/yielded-dev_effect-tsrs` | https://github.com/yielded-dev/effect-tsrs | `947f60cac7` | MIT | Rust port of all 130 Effect diagnostics on tsrs. Has a CLI and Oxlint presets | Our `typecheck` gate (TS and Effect in one pass) | `README.md`, `PORTING.md`, `oxlint-presets/`, `upstream.json` |
| `references/Effect-TS_tsgo` | https://github.com/Effect-TS/tsgo | `11414d156b` | MIT | Effect Language Service for tsrs/tsgo/Oxlint: quick fixes and refactors | Editor quick fixes. Upstream source of effect-tsrs's rules | `README.md` (supported version matrix) |
| `references/dmmulroy_anti-slop` | https://github.com/dmmulroy/anti-slop | `13909c9e07` | MIT | Oxlint rules against low-evidence TS patterns | Vendored rule-by-rule into `tools/oxlint/anti-slop` (pinned upstream at `c44ef22c`, see its PROVENANCE) | `src/rules`, `src/effect/rules` |
| `references/itaymendel_oxlint-plugin-complexity` | https://github.com/itaymendel/oxlint-plugin-complexity | `46d436e531` | MIT | Cyclomatic and cognitive complexity rules for Oxlint | In our `oxlint.config.ts` | `README.md`, `src/` |
| `references/grmkris_repoagents` | https://github.com/grmkris/repoagents | `43ca7cf29d` | MIT | One AGENTS.md, vendored skills with provenance, one MCP list across Claude/Codex/Grok/Cursor | `agents:check` and `repoagents skills` manage `.agents/skills/sources.json` | `README.md`, `src/` |

### Example and pattern apps (Effect + Foldkit + Alchemy)

| Local path | Upstream | HEAD | Licence | What it is | Why it matters | Key paths |
| --- | --- | --- | --- | --- | --- | --- |
| `references/michielryvers_retro` | https://github.com/michielryvers/retro | `15715d2d75` | MIT | Live retrospectives on Alchemy Domain + DO + Foldkit (Effect 4.0.6, Foldkit 0.169.0, Alchemy beta.84: same family as our current pins) | Best independent Domain consumer: aggregate, authorised views, privacy and retention tests, runtime patch. An allowance is an aggregate in the same way | `packages/domain/src/Room/{Room.aggregate,SharedBoard.view}.ts`, `packages/server/test/{Privacy,DurableObjectRetry}.test.ts`, `packages/domain/test/Retention.test.ts`, `patches/` |
| `references/Manzanita-Research_terrarium-v2` | https://github.com/Manzanita-Research/terrarium-v2 | `1ba55a12a0` | MIT | Deterministic agent sims on Alchemy Domain: a vending world with cash/stock invariants, rejections that carry evidence, an operator API as the agent's whole interface | Close analogue to "an agent spends from a budget": `InsufficientCash`-style rejections, invariants, a statechart checked against `explore()` | `packages/vending/src/{Shop,Market,Score}/`, `src/Shop/Shop.invariants.ts`, `src/Shop/Shop.chart.ts`, `src/OperatorApi.api.ts`, `docs/design/NOTES.md` |
| `references/joelhooks_potion-calendar` | https://github.com/joelhooks/potion-calendar | `017ae30e4b` | MIT | Calendar app on Effect 4.0.0, Foldkit 0.167, Alchemy beta.83, D1/Drizzle, DO jobs | Capability ownership, D1 compare-and-swap, DO job storage, native test adapters (Styld review) | `packages/database/src/{schema/calendar,calendar-cache}.ts`, `apps/web/src/server/{live-jobs,live-object}.ts`, `apps/web/src/website.ts` |
| `references/joelhooks_rat-stack` | https://github.com/joelhooks/rat-stack | `1496c2b5c9` | MIT | Agentic TS scaffold (Effect 4.1.2, XState, Alchemy) plus a skills library | Source of the `learn-alchemy`, `test-behaviour` and `investigate-a-failure` skills. One-writer and idempotency principles | `skills/`, `AGENTS.md`, `VISION.md`, `packages/{capability,check-harness}` |
| `references/just-be-dev_cafe-stack` | https://github.com/just-be-dev/cafe-stack | `766ead07bc` | none | Effect 4 + Foldkit + Bun/mise + Alchemy 2 starter (website Worker + API Worker, typed RPC) | Smallest end-to-end template. Native CF tracing and import boundaries | `README.md`, `alchemy.run.ts`, `src/`, `oxlint.config.ts`, `docs/` |
| `references/just-be-dev_agent-feed` | https://github.com/just-be-dev/agent-feed | `90cbd98ccb` | none | cafe-stack-derived app | Explicit native CF telemetry wiring (Styld review: still template-shaped) | `alchemy.run.ts`, `src/` |
| `references/just-be-dev_effect-typed-id` | https://github.com/just-be-dev/effect-typed-id | `8570b812fb` | none | TypeID (`user_01h…`) for Effect Schema | Prefixed IDs for robots, allowances and payments | `README.md`, `index.ts`, `index.test.ts` |
| `references/NolanGC_foldkit-alchemy-starter` | https://github.com/NolanGC/foldkit-alchemy-starter | `b84eda258a` | none | Foldkit + Alchemy chat starter (Better Auth, Hyperdrive Postgres, DO outbox) | Older July betas. Read for DO outbox only, do not copy its cross-origin cookies | `backend/`, `frontend/`, `alchemy.run.ts` |
| `references/MapleTechLabs_hazel` | https://github.com/MapleTechLabs/hazel | `b1f34ef6d4` | FSL-1.1-ALv2 | Chat product: Foldkit, Effect, Alchemy, Workers, DO, R2 | DO outbox (kick + alarm + cron), observability-as-code with Maple | `infra/README.md`, `packages/sync-do/src/outbox.ts` (the Styld review cited `apps/backend/src/worker/outbox-dispatcher-object.ts` at `4fb8080d`; it has since moved or been removed), `packages/infra/src/cloudflare/maple*.ts` |

### Skill source repos (from Styld's `.agents/skills/sources.json`)

| Local path | Upstream | HEAD | Licence | Skills Styld takes from it |
| --- | --- | --- | --- | --- |
| `references/emilkowalski_skills` | https://github.com/emilkowalski/skills | `c8a79627b5` | MIT | animate, animation-vocabulary, apple-design, break-ui, find-animation-opportunities, mobile-native, review-animations (Styld pin `a81dbca0`) |
| `references/joe-bell_skills` | https://github.com/joe-bell/skills | `6e79fd26ab` | MIT | apple-web-app (same commit as Styld pin) |
| `references/mattpocock_skills` | https://github.com/mattpocock/skills | `4ae2317ddb` | MIT | domain-modeling, grilling |
| `references/cloudflare_skills` | https://github.com/cloudflare/skills | `1f2cd0a195` | Apache-2.0 | durable-objects, web-perf, workers-best-practices, wrangler |
| `references/anthropics_skills` | https://github.com/anthropics/skills | `ca45fc496a` | per skill (`skills/frontend-design/LICENSE.txt`, Apache-2.0 per Styld) | frontend-design |
| `references/vojtaholik_good-css` | https://github.com/vojtaholik/good-css | `35e0e8c673` | MIT | good-css |
| `references/blader_humanizer` | https://github.com/blader/humanizer | `0ef9fe5bc3` | MIT | humanizer (same commit as Styld pin) |
| `references/jakubkrehel_make-interfaces-feel-better` | https://github.com/jakubkrehel/make-interfaces-feel-better | `35545ea151` | MIT | make-interfaces-feel-better (same commit) |
| `references/cursor_plugins` | https://github.com/cursor/plugins | `2776ddd235` | per plugin (`thermos/LICENSE`, `pstack/LICENSE`) | thermo-nuclear-review, thermo-nuclear-code-quality-review, unslop |

The Foldkit skills (`foldkit`, `generate-program`, `audit-program`) come from `references/foldkit_foldkit/skills`. `alchemy-domain` comes from `references/alchemy-run_alchemy/packages/domain/skills/alchemy-domain`. `learn-alchemy`, `test-behaviour` and `investigate-a-failure` come from `references/joelhooks_rat-stack/skills`. I checked that every Styld skill path exists in these clones, except hallmark and x18n, which were not cloned.

## Vendor into `repos/` vs pointer only

Rule: vendor when the repo is small, agents read it on most UI or domain tasks, and it documents a package we install at an exact version. Do this through Styld's `tools/vendored.ts` model: pin to the release commit, hash the tree, rename upstream AGENTS.md, exclude `.claude/` and `.agents/`. Use a pointer (`references/` plus a line in AGENTS.md) for anything huge, rarely read, or already shipped readable in `node_modules`.

Vendor into `repos/`:

- **foldkit** at `foldkit@<catalog version>`. Styld's snapshot is 25 MB after exclusions. It is the most-read reference (the `foldkit` skill expects `repos/foldkit/`, and agents use `FOLDKIT.md` and `examples/`). Copy Styld's `repos/sources.json` entry and `tools/vendored.ts`. Bump the catalog to 0.170.0 first so the snapshot and package agree.
- **effect-cf** (`packages/effect-cf` is about 2 MB). Small, young, and its API is not in model memory. Vendor only if we adopt it. Styld uses only `WorkerEnvironment` so far.
- **yielded auth** (`packages/` is about 6 MB): optional. Vendor `packages/auth`, `auth-platform-workerd`, `auth-persistence-drizzle` and `auth-simplewebauthn` (if we use passkeys) at the catalog tag. Otherwise use a pointer.

Pointer only (read from `references/`, or from `node_modules`):

- **Effect.** `node_modules/effect/AGENTS.md` and `ai-docs/` ship in the package at the exact installed version, which is what Styld's `effect` skill reads. The 73 MB clone is for cross-package source (`sql/d1`, `sql/sqlite-do`, `vitest`).
- **Alchemy** (237 MB clone). The `alchemy-domain` skill is already vendored under `.agents/skills`. Read examples and website docs from `references/`. Our `patches/` already pin the behaviour we depend on.
- **zyzz** (21 MB, mostly Rust and native). It is too large to vendor and agents use only `src/` and the site docs. Point to it, and keep a local `zyzz` skill (Styld's `.agents/skills/zyzz` is project-written, not vendored).
- **Drizzle**, **tsrs**, **effect-tsrs**, **Effect-TS/tsgo**, **oxlint-plugin-complexity**, **repoagents**, **phosphor core**. These are tools, read rarely.
- **anti-slop**. Keep Styld's file-by-file vendoring under `tools/oxlint/anti-slop` with its hash manifest, not a `repos/` snapshot.
- **Maple, Hazel.** Both repos are FSL-1.1-ALv2 (Functional Source License; see the root `LICENSE` in each clone), and Maple's clone is 242 MB. Read for patterns only. Do not copy code from them into this repo. The exception is `packages/effect-sdk`, which carries its own MIT `LICENSE`. Use `@maple-dev/effect-sdk` as a dependency if we want Maple telemetry.
- **All example apps** (retro, terrarium-v2, potion-calendar, rat-stack, cafe-stack, agent-feed, coverchart, foldkit-domains, foldkit-alchemy-starter, effect-typed-id). Several have no licence file. Record deviations from them in docs, as Styld does.

## Skills to carry over from Styld

This repo has `alchemy-domain`, `durable-objects`, `thermo-nuclear-code-quality-review`, `unslop` and `wrangler` so far (`.agents/skills/sources.json`). Add these with `repoagents skills`, pinned to the commits in Styld's `sources.json`:

- **Code:** `foldkit`, `generate-program`, `audit-program` (foldkit/foldkit, same commit as the `repos/foldkit` snapshot), `learn-alchemy` (rat-stack), `workers-best-practices` (cloudflare/skills).
- **Local, adapted from Styld rather than vendored:** `effect` (points at `node_modules/effect/AGENTS.md` + `ai-docs`) and `zyzz` (once zyzz is adopted). Rewrite the Styld-specific paragraphs. A local telemetry skill modelled on `styld-telemetry` once observability exists.
- **Planning, tests and review:** `domain-modeling`, `grilling` (mattpocock), `test-behaviour`, `investigate-a-failure` (rat-stack), `thermo-nuclear-review` (cursor/plugins).
- **UI:** `frontend-design` (anthropics), `make-interfaces-feel-better`, `good-css`, `break-ui`, `mobile-native` (owners and the duck demo will be used on phones), `apple-web-app` (only if the dashboard becomes an installable web app).
- **Copy:** `humanizer` (README, pitch and submission text).
- **Optional:** `web-perf`. For a hackathon demo, animation skills (`animate`, `review-animations`) only if motion work happens.

Do not carry: `x18n`, `x18n-check`, `x18n-setup` (no i18n), `hallmark` (Styld uses it only on request; repo is 233 MB), `apple-design`, `animation-vocabulary`, `find-animation-opportunities` (polish-stage only), or any wardrobe/try-on content. Note that this repo still has Styld's `packages/i18n`, `tools/i18n*` and the `intl-messageformat` catalog entries from the foundation copy. These are candidates for removal if i18n is definitely out.

## Not cloned, not found, or not verified

- **Not cloned (size or out of scope), pointer only:**
  - [oxc-project/oxc](https://github.com/oxc-project/oxc) (216 MB; Oxlint/Oxfmt, JS plugin API under `npm/oxlint-plugins`).
  - [alchemy-run/distilled](https://github.com/alchemy-run/distilled) (952 MB).
  - [Nutlope/hallmark](https://github.com/Nutlope/hallmark) (233 MB).
  - [x18n-dev/x18n](https://github.com/x18n-dev/x18n) (no i18n).
  - [yielded-dev/agent](https://github.com/yielded-dev/agent) (220 MB; Styld HEAD uses `@yielded/agent` for its stylist, not in our catalog).
  - [yielded-dev/sync](https://github.com/yielded-dev/sync) (Effect realtime sync; may matter for live robot status).
  - [cloudflare/workerd](https://github.com/cloudflare/workerd), [cloudflare/workers-sdk](https://github.com/cloudflare/workers-sdk).
  - [webpro-nl/knip](https://github.com/webpro-nl/knip), [kucherenko/jscpd](https://github.com/kucherenko/jscpd), [evilmartians/lefthook](https://github.com/evilmartians/lefthook).
  - [MapleTechLabs/maple-ui-parity](https://github.com/MapleTechLabs/maple-ui-parity) (React→Foldkit port harness).
- **Present in `~/code/reference` but not re-cloned here:** Manzanita-Research `pleat` (an alternative to zyzz), `foldkit-dials` and `foldkit-native`; just-be-dev `foldmark`; julia-script `effect-harness` and `effect-inspect`; joelhooks `rat-king`; `cloudflare/agents`. None of these is in Styld's dependency graph. Clone them if a track needs them.
- **Auth repo naming.** The canonical repo is [yielded-dev/auth](https://github.com/yielded-dev/auth). npm still lists `danieljvdm/effect-auth`, which redirects there. The older `~/code/reference/yielded-auth` clone tracks the fork `grmkris/auth`.
- **Licences.** The GitHub API reports `NOASSERTION` for Maple and Hazel. Their `LICENSE` files are FSL-1.1-ALv2. These have no licence file and no `license` in `package.json`: coverchart, cafe-stack, agent-feed, effect-typed-id, foldkit-alchemy-starter. `anthropics/skills` and `cursor/plugins` license per skill or plugin.
- **Private repos.** None were needed. Every repo above was public and cloneable.
- **Not verified.**
  - Runtime behaviour of any example. This was a source-only review.
  - Whether `effect-cf` 0.59 and Alchemy beta.85's own Cloudflare bindings overlap in ways that conflict.
  - Whether `@maple-dev/effect-sdk/foldkit` works on Foldkit 0.169 (Styld uses it with 0.170).
  - Retro's and Terrarium's Alchemy pins are commit builds (`pkg.alchemy.run/.../72f84cc`) or beta.84, so their patches may already be upstream.
- **No reference found** for a Foldkit + Alchemy app that does on-chain payments or allowances. For the stack itself, Nod (`~/code/hack-meridian-2026`, which vendors `repos/foldkit`) and Froggy are the closest prior art. Neither recorded further stack reference repos beyond Foldkit; their other references are chain and agent-payment repos.
