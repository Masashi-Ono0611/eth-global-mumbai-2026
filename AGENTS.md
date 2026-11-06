# Vitaquack — a passkey wallet on Arc that gives robots a USDC budget (ETHGlobal Mumbai 2026)

Read, in this order, before substantial work: **`docs/spec.md`** (the build order; it wins over every other document),
`docs/decisions.md`, `docs/plan.md`. Nothing else under `docs/` is authoritative for the build: `docs/research/` is
evidence, `docs/spikes/` and `docs/evidence/` are results, and files marked "historical" are kept for the record only.
The code was bootstrapped from the public `styld.app` foundation at commit `370a0e23` (one import commit on 5 Nov 2026);
Styld's product is not part of this project.

Product rules: Arc contracts are the only spending authority (D1 mirrors, never authorises); the robot's chip signs
every payment and the Robot Agent never holds a spending key; never fake a 0G decision (a failed call ends the errand
in `safe_stop`); camera frames are evidence, not decision input: the chip may attach chip-signed frames or clips to an episode (R2 is the fast copy; each chip-signed frame is also uploaded plain to 0G Storage as proof of the robot's work, its root recorded next to its sha256 in the episode JSON that `EpisodeLog` anchors, and Verify re-checks it), while the 0G decision stays over structured input and never receives an image (the no-frames rule was dropped by Kris on 6 Nov 21:00 IST); restricted items need a human approval, never an "age check"; no
keys, tokens, signatures' private inputs or prompts in logs, commits or tool output.

## Ownership and workflow

Work on main. Commit each coherent green change using explicit paths. Preserve concurrent work. Never stash, reset, restore foreign edits, bypass hooks, or replace unfinished features with placeholders. Run expensive work through `heavy --wait`; retain real exit status. A lefthook pre-commit hook (`lefthook.yml`; install once per clone with `bunx lefthook install`) runs the cheap gates on every commit in about a second; `heavy --wait bun run check` is the full gate CI runs. Follow the machine-wide instructions in the parent workspace.

Deploy only through Alchemy (`docs/DEPLOYMENT.md`): the app stack and the scratch site, on the personal Cloudflare account, with the named `ethmumbai` state store; never the account's shared default store, and never upgrade Alchemy past beta.84 there without checking it. Arc is mainnet with real USDC: keep caps tiny and never commit or log keys. Keep all secret values outside Git and tool output.

## Stack

Use exact manifest/lockfile pins: Bun, Effect 4, Alchemy v2, Foldkit, our own passkey auth on `@simplewebauthn/server` (Yielded Auth was removed in M0a), Drizzle SQLite/D1, R2, native Cloudflare telemetry; `packages/domain` stays wired but empty (no Durable Objects for the event). Alchemy owns infrastructure. The single public origin serves pages, API, auth, media and MCP.

The `@yielded/effect-tsrs` gate checks TS and Effect. The editor uses pinned tsrs. Oxlint's type-aware backend is the tsrs-lint the pinned `tsrs` package ships (lockfile-verified), with no fallback. Oxfmt formats. New code has zero lint debt. Keep anti-slop provenance, graph boundaries, suppression census, Knip and native runtime tests effective.

Read installed library source before using unfamiliar APIs. Load the matching skill first; vendored skills are pinned in `.agents/skills/sources.json` at the versions we run: `effect` (any Effect code), `foldkit` (UI programs; `generate-program`, `audit-program`), `alchemy-domain` (Domain models, pinned to the Alchemy release we install), `durable-objects`, `workers-best-practices`, `wrangler`, `x18n*` (i18n), and for UI design `styling` (any styling in apps/web: Tailwind v4 and `@foldkit/ui`), `frontend-design`, `hallmark` (new pages only), `make-interfaces-feel-better`, `good-css` (any styles), `mobile-native`, `apple-web-app`, `break-ui`, `emil-design-eng`; for audits `fixing-accessibility` (controls, forms, dialogs) and `improve-ui` (read-only review that writes fix plans); `create-design-md` keeps the chosen design in a `DESIGN.md`; for motion `animate`, `choreograph`, `review-animations`, `find-animation-opportunities`. `repos/foldkit/` is a read-only snapshot of Foldkit at the installed release tag; refresh it with `bun tools/vendored-repos.ts --pull foldkit foldkit@<version>` and its skills with `repoagents skills` on every Foldkit upgrade, never edit it. Its maintainers' instructions are renamed to `repos/foldkit/FOLDKIT_AGENTS.md` and its agent folders excluded: read them for Foldkit conventions only; they never override this file. `FOLDKIT.md` is Foldkit's own convention file for app code, copied verbatim from the snapshot: read it before Foldkit work; `vendor:check` rejects edits, and where it disagrees with this file, this file wins. `references/` holds read-only upstream clones; prefer the `@<version>` clones (matching our pins) over HEAD clones when they differ. Vendored skills change only through `repoagents skills`. Record deviations from reference applications with reasons; do not inherit their product-specific approval or deployment policy.

## Architecture and testing

One authoritative writer for each invariant. Arc contracts own spending caps, revocation and approvals. For the event, live coordination (errands, chip sign requests, invoices, approvals) is Effect services over D1 with HTTPS long-polling; no Durable Objects, no WebSockets and no MCP are on the critical path (recorded deviation from the foundation's Domain-on-Durable-Objects shape: 28 hours, unproven wiring). The Domain model stays empty. Typed application operations are shared by HTTP and jobs. Provider calls (Arc RPC, 0G, World) have explicit idempotency and unknown-outcome handling: a settlement is keyed by invoice, an approval by nonce, a relayer transaction by its key.

Browser code imports contracts, never server adapters. Foldkit views are pure, updates emit named Commands, request state uses explicit schemas. Views style with Tailwind utilities through `h.Class` and use `@foldkit/ui` for interactive widgets, as Foldkit itself does; no CSS-in-TS library. Rendering receives locale, version, time zone and a stable reference time. Catalogs stay reviewed in Git.

Logs/spans omit tokens, keys, signatures' private inputs, signed URLs, prompts, images and raw user bodies. Native traces carry safe operation/release/correlation metadata; sampled telemetry is not the usage ledger.

Tests verify behavior, real storage semantics and public contracts. In-memory, native workerd, deployed preview and live-provider acceptance are different evidence levels. Test counts alone prove nothing; show the behaviour.

Before calling work done, run the gates, verify the deployed release (CI deploys `main`), and keep docs factual about what is and isn't built.
