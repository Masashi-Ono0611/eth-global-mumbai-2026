# Delivery status

Status: active, foundation deployed to an isolated workers.dev preview. Full parity is not achieved.

## Foundation boundary review — 2026-10-28

- Commit `2d21426` closes a reproduced dependency-check bypass: a browser entry importing a JavaScript file that imported `node:fs` previously passed with only the entry audited. Discovery and traversal now cover TS/TSX/MTS/CTS/JS/JSX/MJS/CJS, TypeScript import-equals declarations, extensionless barrels and explicit JavaScript imports backed by TypeScript source. Bare Node built-ins are rejected; unresolved or ambiguous local source imports fail rather than silently skipping an edge.
- Seventeen additional filesystem regression cases exercise the complete graph checker. The full `heavy --wait bun run check` passed with exit 0: 81 type/Effect files with zero findings, all tooling gates, 75 unit tests, 13 native/browser tests with 82 assertions and bundle budgets (205,943 browser gzip bytes; 909,703 SSR source bytes). Log: `/tmp/styld-v2-boundary-review-final.log`; durable exit receipt: `/tmp/styld-v2-boundary-review-final.exit`.
- This commit changes quality tooling and handoff documentation only. The deployed application release remains `08191f5b40872d1806a4a677157e1af97f0c6482` with the accepted preview readback below. No email OTP implementation was started. The foundation is ready for handoff; the original full-parity goal remains active pending an explicit pause instruction.

## Browser identity foundation — 2026-10-28

- Added Foldkit `/login` and `/account` routes with typed Yielded session/sign-in/sign-out Commands, localized form feedback, accessible labels and mobile/RTL layout. Credentials stay out of Model, Message and Command arguments; the password field clears when the command takes its value.
- Native acceptance now binds the real public edge origin, as preview does. Chromium proves failed-login feedback, successful password login for a synthetic test identity, session persistence across reloads, account navigation, logout and immediate rejection of a replayed cookie. Seed routes exist only in the local test Worker.
- Full `heavy --wait bun run check` passed (exit 0): formatting, provenance, 2,296-message catalog, 71-file Effect/tsrs check with zero findings, typed lint, 56 unit tests, production build, and 12 native/browser tests. Log: `/tmp/styld-v2-identity-check.log`.
- This adds browser acceptance to the password identity foundation. Email OTP signup/login, Google, anonymous sessions/merge, onboarding and all remaining parity requirements remain pending. Deployed acceptance of this slice is recorded separately after deployment.

## Preview release — 2026-10-28

- Commit `73b01a2f36c24d3dcb11eeded65ad121b53f7f2a` is deployed to the isolated preview URL `https://styldappv2-styldedge-preview-vdqhe23kflepifq2.kristjan-grm11775.workers.dev`.
- `STYLD_RELEASE` readback matches the commit on `styldappv2-styldworker-preview-xl7ey7d6cq4z7vez`; `VITE_STYLD_RELEASE` matches on `styldappv2-styldwebsite-preview-z4qir7nggl6fxu2x`. API and Website workers.dev/version previews remain disabled. All three Workers have native logs/traces enabled, query-string redaction enabled and head sampling set to 1 for this preview.
- `STYLD_PREVIEW_URL=... heavy --wait bun test tools/preview.native.test.ts` passed: 1 test, 18 assertions. The deployed check covered health, auth/CSRF, a rejected foreign origin, missing-route behavior and hydrated browser rendering.
- Cloudflare deployment readback: Edge deployment `2d9b2be9-3783-4966-b8f7-cc6589858d03` / version `59314f15-a71d-4e8d-9222-f7522df57070`; Website deployment `430bca42-4f35-4f72-a880-5091ec91e42e` / version `fe3ab1ee-cb63-4e73-bcfc-79cc4853ecda`; API deployment `ff3d920b-d3a1-4071-aa9a-45d8d904a895` / version `18233254-e09b-4402-bf71-11974be6f169`.
- This is the foundation handoff release, not a feature-complete Styld replacement. The next agent should begin with the identity parity matrix (email OTP, Google, anonymous merge and onboarding), then port the v1 domains in the order recorded in `docs/DELIVERY.md`.

## Final foundation deployment — 2026-10-28

- The tested code release `08191f5b40872d1806a4a677157e1af97f0c6482` is deployed to the same isolated preview URL. Deployed acceptance passed again: 1 test, 18 assertions.
- Cloudflare readback: Edge deployment `fc205fa1-8c15-48c9-9ff1-b68b6632bdae` / version `62634d2d-bf16-4fdc-8094-d0853164d0d2`; Website deployment `4f1e4c56-80f5-4929-a830-cf4443ffb683` / version `62c1ef52-1a36-4401-b7b9-7c1b35e56907`; API deployment `0060c4a1-fea8-4542-86aa-0d58e111e724` / version `123540e8-abc2-4f65-bc07-905d84e787cc`.
- API and Website `workers.dev` and version previews remain disabled. All three Workers have native logs/traces enabled, query-string redaction enabled, persistent logs/traces and head sampling set to 1 for this preview. API/Website release bindings match the deployed code release; the edge is the public routing shell and carries no application release binding.

## Foundation handoff checks — 2026-10-28

- Added validated agent provenance and generated Codex/Cursor MCP configuration; `repoagents check`, provenance verification and the offline skill verifier pass. Vendored skills are byte-pinned, with the Alchemy Domain license recorded.
- Added graph, browser-boundary, suppression-census, checker-canary, Knip and duplicate-code gates. The browser graph is transitive and export-map aware; the census has four reasoned directives and rejects explicit `any` and non-null assertions. Knip passes in normal and production modes. There are zero duplicate blocks at the configured eight-line/50-token minimum after extracting the shared native auth request helper.
- Added a native restart/recovery fixture. It waits for the new Worker generation and API release identity, then proves Domain wallet state/idempotency receipts, stateful auth session reads and R2 bytes survive the restart. The test also proves duplicate settlement and reservation commands remain retry-safe.
- Added browser/SSR bundle budgets (256 KiB total gzip browser assets, 3 MiB SSR source), a hosted CI workflow and `docs/HANDOFF.md`. The complete local gate passed for this handoff's code: formatting, agents, provenance, i18n, graph, suppressions, canaries, 81-file Effect/tsrs with zero findings, typed lint, Knip twice, jscpd, 58 unit tests, production build, 13 native/browser tests with 82 assertions and bundle budgets. Browser assets measured 205,941 gzip bytes; SSR measured 909,703 source bytes. Log: `/tmp/styld-v2-foundation-check.log`.

## 2026-10-28 — initial baseline

- Created the new repository at `/home/kristjan/code/styldappv2` on main.
- Captured v1 commit `dddf9d44b656701282debd2ff88b343851145126` and 341 relevant files.
- Inventory counts: {"pages": 57, "routeHandlers": 1, "routers": 24, "workers": 15, "databaseDomains": 24, "mcp": 67, "behaviorTests": 153}.
- Preserved prior architecture/tooling/localization research under `docs/research`.
- New implementation, quality gates, native runtime proof, provider integration, deployment and review rounds remain to be completed.

Next: install the exact compatible stack, implement and prove quality gates, then the first vertical runtime slice.

## Foundation gate bootstrap

- Exact stack catalog and lockfile created; runtime packages will be resolved as their owning workspaces are added.
- Type checker: effect-tsrs 0.2.2, TypeScript and Effect diagnostics in one pass with plugin coverage verification. Editor/reference checker: tsrs 0.20.0.
- Oxlint 1.89 uses the pinned SHA-256-verified tsrs-lint backend with no stock fallback. Anti-slop rules and selected skills have file hashes.
- Initial gate passed: formatting, 37 provenance files, 8 checked TypeScript files with zero findings, typed lint, 2 backend-integrity tests.
- Graph, Knip, duplicate/suppression checks, semantic canaries, native runtime, app implementation and deployment remain pending. This initial gate is not the final delivery gate.

## Localization foundation

- Preserved both v1 catalogs (2,296 string leaves each), including four intentionally empty onboarding result prompts per locale.
- Added reproducible catalog/key/argument generation and a content version, cached explicit-locale formatting, structured rich text, and expansion/RTL pseudolocales that preserve interpolation values.
- The catalog gate checks key/variable parity, ICU syntax, approved rich tags and plural categories. Three exact frozen-copy plural exceptions preserve v1 wording; additional omissions fail.
- Local foundation gate passed: Oxfmt, 37 provenance files, generated-catalog checks, effect-tsrs on 17 files with zero findings, verified tsrs-lint/Oxlint, and 15 tests.
- Worker Intl/concurrency, Foldkit SSR/hydration, locale negotiation/persistence, safe formatter-error telemetry, email coverage and page/accessibility acceptance remain pending. This is a tested package foundation, not completed localization parity.

## Domain wallet foundation

- Added Alchemy Domain Wallet: separate credit pools, bounded pending reservations, fingerprint conflicts, subscription-first allocation, original-pool refunds and trusted service authority.
- Full current gate passed: 30 TypeScript files, zero findings, verified typed lint, 20 tests. Wallet stories run against Domain.InMemory, not Cloudflare persistence.
- Domain beta.84 lacks the skill's Domain.verify helper; model construction validates its definitions instead. This deviation is source-verified.
- Generation request idempotency, durable orchestration, complete billing semantics, native concurrency/restart proof, wallet read projections, HTTP/MCP authority and deployment remain pending.

## Native Cloudflare runtime proof

- Added an Alchemy server Worker with native Cloudflare tracing/log observability enabled, compatibility date `2026-10-19`, and a local stack entrypoint.
- The original workerd acceptance deployed and deleted a dedicated `RuntimeWorker` fixture plus `WalletAggregate` Durable Object. It passed Slovenian `Intl` formatting and concurrent reservation serialization with separate-user state; it did not execute the application `StyldWorker` entrypoint.
- Added the first D1/Drizzle/Yielded Auth persistence boundary: the application-owned `accounts` table and Yielded's managed credential/session tables are generated as explicit SQLite migrations. Alchemy owns application of those migrations in an isolated v2 D1 database; its bookkeeping remains separate from the application schema.
- Added an isolated EU-jurisdiction R2 bucket and native Worker bindings for D1 and R2. The native workerd acceptance now proves the migrated application tables are readable and the R2 binding is live; the gate passes 3 tests (Intl, Domain concurrency, D1/R2 storage).
- Added the first live Yielded Auth boundary: the shared `AuthContract`, D1-backed credential/session persistence through `@yielded/auth-persistence-drizzle`, an application secret, signed session keyring decoding, and origin/CSRF-protected HTTP routes. The native workerd acceptance now proves an unauthenticated `getSession` request through the generated Worker router; the gate passes 4 tests (Intl, Domain concurrency, D1/R2 storage, Auth HTTP).
- This still proves local native storage and host composition only. Eviction/restart recovery, alarm/backoff, deployed workers.dev readback, browser telemetry, sign-in/provider flows, and the full HTTP/MCP surface remain pending.

## Auth/runtime slice gate

- `ALCHEMY_TEST_DEV=1 bun test packages/server/test/Runtime.native.test.ts` passed: 4 tests, 0 failures.
- `bun run format:check`, `bun run provenance:check`, `bun run i18n:check`, `bun run lint`, `bun run test:unit`, and `heavy bun run typecheck` passed. The unit suite reported 9 files and 51 tests, later found to include duplicate workspace-symlink discovery; this historical count is not unique coverage. Effect-tsrs checked 55 files with zero findings.
- The Auth HTTP acceptance uses the generated POST `getSession` contract with explicit `application/json`; no CSRF or origin checks are bypassed. The native fixture uses loopback-only test secrets and insecure cookies; production requires Worker secrets and secure cookies.
- Added a browser-safe `@styld/auth/client` adapter around Yielded's `Client` transport. It uses the same `AuthApi` contract, credential-inclusive fetches, bounded JSON envelopes and the standard CSRF header; a contract test verifies the generated route and request body without mocking modules. Foldkit UI wiring and same-origin API proxying remain the next host integration step.
- The published Alchemy beta.84 Cloudflare adapter required the minimal export-map patch in `patches/`; its Node/Bun import regression test passes.

## Observability metadata slice

- Added `@styld/observability`, a shared Effect boundary that accepts only bounded environment, release, component, kind, correlation, operation, job and attempt fields. It maps the same approved attributes to named spans and log annotations; request bodies, credentials, signed URLs, prompts and arbitrary headers never enter this seam.
- The native server Worker and Foldkit SSR request boundary now derive metadata from deployment bindings/build identity plus allowlisted `x-styld-*` headers. The native fixture carries explicit `local`/`native-test` identity, while Alchemy preview binds `preview`/`preview` identity.
- The package tests prove header bounds, secret-header exclusion, span attributes and log annotations. Unit coverage was 29 tests across 8 files. The 4/4 native fixture tests did not exercise the new application observability wrapper. Client-supplied metadata remains insufficiently constrained as a privacy boundary; generated correlation identity, real release metadata, deployed trace/log readback, browser telemetry ingestion and application metrics/alerts remain pending.

## Application runtime and public edge

- Replaced the speculative custom Foldkit entry with a separate public edge and supported generated SSR. Internal API and website Workers disable workers.dev and version preview URLs. The edge serves the build's static files and forwards the original requests/responses through native service bindings.
- Corrected D1/R2 binding-layer composition, deferred runtime-only auth configuration out of Alchemy planning, and supplied Alchemy's HTTP platform services to the real application router.
- Auth signing keys now decode from Cloudflare secret-text JSON, with key-length, key-ID, active-key and duplicate-key checks. Configuration errors omit raw input. The configuration module is independent of the auth runtime and its WASM dependency.
- Fixed browser entry tree-shaking: the package now declares the hydration entry's side effects, so both the actual client code and its CSS survive the generated Foldkit import.
- Native acceptance now tests the actual application Worker and production SSR artifact in workerd through the edge. Eight tests pass, including Chromium hydration, English/Slovenian switching, cookie persistence after reload, RTL/mobile overflow, built JS/CSS delivery, auth session reads, Origin/CSRF rejection, 404s, D1/R2 bindings and wallet serialization. Local Vite dev SSR is not used as deployed-runtime evidence.
- Current unit gate: 55 unique tests in 10 files. Type/Effect gate: 64 files, zero findings. Typed lint passes. No public preview or signed-in/provider acceptance yet; all full-parity matrix rows remain pending.

## Preview configuration and SSR tracing

- The first cloud plan created only isolated v2 preview resources. Initial upload partially provisioned D1/R2 and the website, then failed because raw `secret_text` descriptors received Redacted objects. The supported bound `env` path now performs that serialization; the incorrect type suppression was removed.
- Preview secret material is generated locally in ignored `.env.preview.local` with mode 600. It is separate from v1 and production secrets.
- Deployment now requires `STYLD_RELEASE` and binds it into the API and SSR build. The Foldkit SSR boundary installs Alchemy's Cloudflare tracer per request, and the website enables native traces with an explicit compatibility date.
- After the binding/tracer correction: typecheck, typed lint, 55 unit tests and all 8 native/browser tests pass. Cloud redeployment/readback remains pending; the partial resource upload is not acceptance.

## Preview acceptance receipt — 2026-10-28

- The isolated preview deployed successfully at [`workers.dev`](https://styldappv2-styldedge-preview-vdqhe23kflepifq2.kristjan-grm11775.workers.dev), release `14e5884e01b74a131df6cb7a744f4cb646ed2219`.
- Cloudflare readback: edge version `a335ebd4-fd65-4ec2-beed-1404aeda5767`, website version `5bc8e8cd-ca19-44a7-bae1-9dd691310241`, API version `7bcfb139-52c4-4567-a7c2-d168ea23c29a`; API and website have workers.dev and version previews disabled, while only the edge has the public subdomain.
- Deployed acceptance (`STYLD_PREVIEW_URL=… heavy --wait bun test tools/preview.native.test.ts`) passed: health, session read, wrong-Origin rejection, unknown API route, browser hydration, Slovenian persistence/reload, RTL mobile overflow and client assets.
- Native Cloudflare observability readback passed through the account telemetry query: edge/website invocation logs and website `styld.web.render` spans carry `styld.environment=preview`, the exact release, `styld.component=web`, and `effect.exit=success`. API `styld.http` spans also carry the exact release, server component and finite Effect outcome. Edge and downstream Workers currently have separate native trace IDs; cross-service trace continuity is not claimed. This is runtime proof of the initial release, not a production alerting policy.
- A plain Python request can receive Cloudflare Error 1010 from the account's bot controls; Playwright/normal browser requests and the deployed acceptance path pass. Do not treat a bot-blocked ad-hoc client as an application failure.

## Telemetry trust boundary

- The public edge now removes all incoming `x-styld-*` fields and supplies a new UUID correlation ID. HTTP metadata accepts only that UUID; job/operation/attempt fields must originate in trusted application operations. Tests verify malicious labels are removed while request bodies, cookies, Origin, redirects and repeated Set-Cookie headers survive.
- Deployment identity now fails with a sanitized typed configuration error instead of silently reporting local/unreleased values. The local build explicitly identifies itself as local; deployed SSR/API receive the release from the stack.
- All three Workers declare query-string redaction in native observability. This closes a platform-default leak found in the settings readback; production retention/metrics/alerts and browser telemetry remain pending.
- Gate after these changes: 65 type/Effect files with zero findings, typed lint, 56 unit tests, 8 native/browser tests, generated catalogs and provenance checks. The prior release's deployed receipt is above; redeployment of this change remains pending.

## Telemetry deployment receipt — 2026-10-28

- Release `b1d6b2167313751c26ac6c5b7a8df5c80091130e` deployed successfully: all three Worker updates completed; deployed browser/API acceptance passed (14 assertions).
- Active versions read back at 100%: edge `4227f61f-99db-403e-afa8-1482368fc322`, website `b6351b8d-c8cf-46fc-8351-23e18fd9d1de`, API `f2249c30-25d3-462c-b67a-6c13d3511a13`. API and website still disable workers.dev and version preview access.
- Native settings confirm `redact_query_string=true` on all three Workers. API and website bindings identify the exact release. Live API spans carry generated UUID correlation IDs and bounded release/environment/component fields.
- Full feature parity, signed-in/provider acceptance, browser telemetry, metrics and alerts remain pending.

## Authoritative session acceptance

- Added a test-only D1 identity fixture that creates a real Argon2id credential using Yielded's Worker hasher. It is imported only by the native-test Worker; no seed or password-signup endpoint exists in the application Worker.
- Native replay testing reproduced a stale signed-in result after logout when the complete cookie jar included the positive session snapshot. Removed `cacheFor: 30_000`; sessions now consult authoritative persistence on every request.
- Native acceptance passes 9 tests, including real password verification, wrong-password rejection, closed password signup, session claims, logout replay rejection and immediate account-disable invalidation through the actual public edge/API Worker. Type/Effect check passes on 66 files; typed lint and formatting pass.
- This is local signed-in acceptance only. Public sign-in UI, unified email OTP signup/login, Google, anonymous merge, durable attempt limiting and deployed identity acceptance remain pending.

## Durable password admission

- Replaced Yielded's per-runtime default password limiter with an application-supplied D1 token bucket. The conditional debit and bounded expiry cleanup share an atomic batch; D1 time controls refill, and bucket keys are HMAC digests instead of raw identifiers.
- Native tests prove budgets persist across separate application requests, three concurrent admissions win out of twelve for a three-token budget, fractional refill survives, and expired entries recover. Fixture routes remain exclusive to the native-test Worker.
- Full integration gate passed: formatting, 37 provenance files, 2,296 catalog messages, 68 type/Effect files with zero findings, typed lint, 56 unit tests, production build and 11 native/browser tests. Evidence: `/tmp/styld-v2-check.log` (exit 0).
- Edge/network abuse limits and isolate-wide KDF admission still need host-level integration. Email proof delivery and unified OTP registration/sign-in remain unfinished. This slice has not yet been deployed.
