# Delivery plan

Objective: deliver the complete Styld v2 monorepo, following the researched stack/tooling patterns, with v1 feature parity, a testable workers.dev deployment and multiple final review rounds. No smaller prototype substitutes for this objective.

## Baseline

V1 repository: `/home/kristjan/code/stylelab`. Frozen comparison commit: `dddf9d44b656701282debd2ff88b343851145126`. `docs/migration/v1-inventory.json` records tracked page, route, router, worker, schema, MCP and behavioral-test paths with content hashes. Later v1 changes are reviewed explicitly before adding to this baseline.

## Work sequence

1. Foundation: exact dependency family, tsrs/effect-tsrs, verified tsrs-lint, Oxfmt/Oxlint/anti-slop, graph/provenance/suppression gates, skills/MCP, tests and reproducible build.
2. Runtime proof: Alchemy isolated preview, D1/Drizzle, R2, native telemetry, Foldkit SSR + client, en/sl, Yielded sessions, Domain reservation/job through a native Worker test. Native acceptance now exercises the actual application Worker and the built Foldkit website through the public edge, including browser hydration, locale persistence, and unauthenticated session reads with Origin/CSRF enforcement. The isolated preview and native telemetry readback are accepted at the release recorded in STATUS; signed-in flows and job recovery remain pending.
3. Port domain operations and UI by the parity matrix. Preserve source behavior and constraints, not just route names. Land coherent tested slices.
4. Connect provider adapters, durable retries/refunds, auth flows, billing test mode and live-safe email. Exercise storage/restart/privacy failure cases.
5. Rehearse import/export with fixtures and stable IDs; verify public links, image delivery, vectors, locale, mobile and MCP contracts.
6. Deploy clean tested release to workers.dev; verify the actual release and end-to-end flows. Run architecture/tooling, correctness/security, and product/browser review rounds, fix findings, rerun final gates.

## Feature acceptance matrix

| Area       | Required behavior                                                                                                                               | Status  | Evidence |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------- |
| identity   | anonymous sessions and merge; email OTP; Google; logout; account linking and deletion; roles/admin                                              | pending | —        |
| onboarding | taste-first flow; style/body preferences; starter board/follows; retry-safe welcome email                                                       | pending | —        |
| wardrobe   | upload/analyze; categories/colors/tags; edit/favorite/archive/delete; search; capacity and visibility                                           | pending | —        |
| studio     | boards/pins/collages; canvas editing; image/text/layout; undo and save; rendering; sharing; safety-filtered public reads                        | pending | —        |
| outfits    | compose/render; try-on; outfit check and followups; calendar/planning; saved looks                                                              | pending | —        |
| scans      | multi-photo scan; detect/extract garments; product shots; progress/retry/cancel; correct charging                                               | pending | —        |
| stylist    | chat threads/streaming/tools; wardrobe/catalog retrieval; persistent context and handoffs                                                       | pending | —        |
| catalog    | shop identity/profile; feed sync/pagination/retirement; manual items; dictionary/AI classify; semantic/plain search and facets; click analytics | pending | —        |
| social     | published profiles; feed pagination; follow; directories; public links; OG cards; unpublished-owner protections                                 | pending | —        |
| safety     | reports; two-way blocks; moderation; notices; admin restore/remove/dismiss; feed approvals and curation                                         | pending | —        |
| billing    | plans/credits; checkout/portal; Dodo signatures/events/dedupe; lazy customer; quotas/reserve/consume/refund                                     | pending | —        |
| mcp        | frozen tools and schemas; resources/apps; OAuth/CIMD/DCR; scopes/consent/revoke; signed-out browsing vs protected host auth                     | pending | —        |
| operations | activity/dashboard/admin/referral/feedback; email; analytics; provider receipts; job recovery                                                   | pending | —        |
| migration  | stable IDs/timestamps/URLs; SQLite query equivalence; object transfer; vectors; auth import/session strategy; count/hash reconciliation         | pending | —        |
| experience | en/sl; legal content; mobile/Safari/PWA; accessibility; empty/error/loading states; browser telemetry                                           | pending | —        |

## Proof levels

Record unit/property, native workerd, deployed preview, browser and real-provider results separately. A source manifest, green build or stub response does not prove feature parity. Final sign-off requires implementation paths and behavioral evidence for every row and every exported v1 operation.

## Completion conditions

All parity rows accepted; zero unresolved high/medium review findings; pinned and effective quality gates; full build/tests and native/deployed acceptance at the final commit; isolated Worker URL and release readback; clean owned worktree; no production changes; documented remaining owner-specific connector approvals if a client requires interactive login, without calling those acceptance tests passed.
