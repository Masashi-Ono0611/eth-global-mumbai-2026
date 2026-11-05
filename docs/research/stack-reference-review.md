# Styld rewrite: independent reference review

Research snapshot: 2026-10-28. Source review only: no dependency installation, test execution, live application acceptance, deployment, paid generation, or Styld source changes. The repositories below are local shallow clones. A checked-in test or deployment receipt is evidence of its author's approach, not a test result obtained in this review.

## Strongest application references

### Retro — Alchemy Domain, Effect, Foldkit, Cloudflare

- Repository: https://github.com/michielryvers/retro
- Reviewed commit: `15715d2d752e74387e2d4d31bea2a45f0286b98f`
- Local clone: `/tmp/ref-retro-domain`
- Actual product: collaborative retrospective rooms, invitations, private notes, voting, live views, scheduled closure and deletion. Its README links a live deployment, which was not tested here.
- Uses commit-pinned Alchemy packages, Effect 4.0.6, Foldkit 0.169.0. This is an independent Domain consumer, not a framework example.
- [Aggregate](https://github.com/michielryvers/retro/blob/15715d2d752e74387e2d4d31bea2a45f0286b98f/packages/domain/src/Room/Room.aggregate.ts): room owns decisions and phase constraints; members and facilitator are resolved from server-provided actor context. Explicit state-size guard.
- [Authorized view](https://github.com/michielryvers/retro/blob/15715d2d752e74387e2d4d31bea2a45f0286b98f/packages/domain/src/Room/SharedBoard.view.ts): snapshots expose only the intended shared state; private note events are not simply relayed to everyone.
- [Privacy tests](https://github.com/michielryvers/retro/blob/15715d2d752e74387e2d4d31bea2a45f0286b98f/packages/server/test/Privacy.test.ts): checks private views, event-history disclosure, deduplicated retries and cross-session authority. These use Domain.InMemory, despite `it.live` naming; they do not establish Cloudflare persistence guarantees.
- [Retention tests](https://github.com/michielryvers/retro/blob/15715d2d752e74387e2d4d31bea2a45f0286b98f/packages/domain/test/Retention.test.ts): simulated clocks, stale expiry, early closure, bounded history.
- [Runtime patch](https://github.com/michielryvers/retro/blob/15715d2d752e74387e2d4d31bea2a45f0286b98f/patches/cloudflare-runtime.patch): transient retry classification, acquiring a fresh RPC stub, drain lease handling, bounded batches, deletion/tombstone hooks. [Retry tests](https://github.com/michielryvers/retro/blob/15715d2d752e74387e2d4d31bea2a45f0286b98f/packages/server/test/DurableObjectRetry.test.ts) cover part of this.
- Lesson: Domain is a credible application architecture candidate. Deletion, failure recovery, runtime compatibility and limits still require concrete application work. Do not infer that the currently published release includes these patches, or that upstream still has every issue addressed by this older pinned fork.

### Potion Calendar — Rat-stack application, D1/Drizzle and durable synchronization

- Repository: https://github.com/joelhooks/potion-calendar
- Reviewed commit: `c61736077d1c28dbbcbb889c5002438acb9e012c`
- Local clone: `/tmp/ref-potion-calendar`
- Actual product: multi-account Google Calendar UI, Better Auth, Foldkit, Effect 4.0.0, Alchemy beta.83. Public export of a private working repository; its product spec is excluded.
- [D1 schema](https://github.com/joelhooks/potion-calendar/blob/c61736077d1c28dbbcbb889c5002438acb9e012c/packages/database/src/schema/calendar.ts) and [cache adapter](https://github.com/joelhooks/potion-calendar/blob/c61736077d1c28dbbcbb889c5002438acb9e012c/packages/database/src/calendar-cache.ts): Drizzle SQLite schema and queries, explicit compare-and-swap revision check, person scoping, guarded writes.
- [Durable job storage](https://github.com/joelhooks/potion-calendar/blob/c61736077d1c28dbbcbb889c5002438acb9e012c/apps/web/src/server/live-jobs.ts): DO SQLite jobs, delivery numbers, generations, attempts, scheduling; native storage operations behind an explicit interface.
- [Live object](https://github.com/joelhooks/potion-calendar/blob/c61736077d1c28dbbcbb889c5002438acb9e012c/apps/web/src/server/live-object.ts): per-person ownership and authorization, work admission and account deletion handling.
- [Website](https://github.com/joelhooks/potion-calendar/blob/c61736077d1c28dbbcbb889c5002438acb9e012c/apps/web/src/website.ts): single-origin Worker, retained D1, DO binding, release identity and scheduled sync. README describes Miniflare using actual Worker/D1/DO plus a fake Google provider.
- [Trace-export test](https://github.com/joelhooks/potion-calendar/blob/c61736077d1c28dbbcbb889c5002438acb9e012c/packages/core/test/trace-export.test.ts) checks OTLP serialization and scope-close delivery into a fake transport. This is not evidence that deployed native CF tracing is configured.
- Lesson: excellent reference for capability ownership, native test adapters, auth, D1/Drizzle, and durable sync. It does not use Alchemy Domain for that synchronization.

### Hazel — substantial application and Cloudflare migration reference

- Repository: https://github.com/MapleTechLabs/hazel
- Reviewed commit: `4fb8080d3c5ae4704ffb37b200f9ff188a0ef865`
- Local clone: `/tmp/ref-hazel-styld`
- Actual product: collaborative chat with Foldkit frontend, Effect, Alchemy, R2, Workers, DOs, Postgres/Hyperdrive, external sync/workflow services.
- [Infrastructure notes and cutover log](https://github.com/MapleTechLabs/hazel/blob/4fb8080d3c5ae4704ffb37b200f9ff188a0ef865/infra/README.md): actual implementation differs from older root README. Current DB package uses effect-orm, not Drizzle. Its `packages/domain` name does not imply Alchemy Domain.
- [Outbox dispatcher DO](https://github.com/MapleTechLabs/hazel/blob/4fb8080d3c5ae4704ffb37b200f9ff188a0ef865/apps/backend/src/worker/outbox-dispatcher-object.ts): request kick, alarm retry and cron backstop; bounded batches; re-arms work after failures.
- [Processor](https://github.com/MapleTechLabs/hazel/blob/4fb8080d3c5ae4704ffb37b200f9ff188a0ef865/apps/backend/src/services/message-outbox-processor.ts): claims, retry delays, dedupe keys and terminal failure. A claim/lock does not by itself give external exactly-once delivery.
- [Telemetry composition](https://github.com/MapleTechLabs/hazel/blob/4fb8080d3c5ae4704ffb37b200f9ff188a0ef865/packages/infra/src/cloudflare/maple.ts) and [dashboard/alert resources](https://github.com/MapleTechLabs/hazel/blob/4fb8080d3c5ae4704ffb37b200f9ff188a0ef865/packages/infra/src/cloudflare/maple-monitoring.ts): observability declared alongside resources; environment-filtered request error and latency alerts. Uses its own vendor's Maple integration. The checked-in cutover log says telemetry credentials/alerts were still pending at that point.
- Lesson: borrow infrastructure ownership, durable outbox and observability-as-code. It is not proof of a complete all-Cloudflare migration or an endorsed replacement for Drizzle.

## Secondary references, with their actual status

| Reference | Reviewed commit | Useful for | Qualification |
| --- | --- | --- | --- |
| [just-be-dev/cafe-stack](https://github.com/just-be-dev/cafe-stack) | `b1f4451b2ca191048e10cda717f4c31175ad6dc6` | Effect/native CF tracing, platform import boundaries, pinned tooling | Starter, not large deployed product evidence |
| [NolanGC/foldkit-alchemy-starter](https://github.com/NolanGC/foldkit-alchemy-starter) | `b84eda258ac9e5e8e65698ec8582fd06d7a45aaf` | Better Auth/Drizzle/Postgres through Hyperdrive, DO outbox to archive | Older July beta APIs; cross-origin cookie design should not be copied into Styld |
| [foldkit/coverchart](https://github.com/foldkit/coverchart) | `677b804e9aa0d0d1f636067079ae404ead84115a` | Complex Foldkit app composition and Story/Scene/runtime tests | Framework-owned application, not independent CF backend proof |
| [just-be-dev/agent-feed](https://github.com/just-be-dev/agent-feed) | `90cbd98ccb3d444114f15b1173d2c27743ee9ad5` | Explicit native CF telemetry wiring | Still cafe-stack template at reviewed commit; do not count as another independent product |

Additional candidates were cloned/discovered but are not relied on: samebase/alchemy-convex is an infrastructure provider library, not the sought product reference; elianiva/elianiva.com was cloned but not substantively inspected.

## Telemetry: source and current Cloudflare documentation disagree in places

Alchemy source reviewed at `3bb45b0f089597f4b0f9c908b2f5d615201d1405` in `/tmp/styld-alchemy-domain-20261027`:

- [Telemetry binding](https://github.com/alchemy-run/alchemy/blob/3bb45b0f089597f4b0f9c908b2f5d615201d1405/packages/cloudflare/src/Workers/Telemetry.ts): enables host tracing and supplies an Effect tracer per event. Requires compatibility date >= 2026-07-28 for the API it uses.
- [Tracer](https://github.com/alchemy-run/alchemy/blob/3bb45b0f089597f4b0f9c908b2f5d615201d1405/packages/cloudflare/src/Workers/CloudflareTracer.ts): forwards scalar attributes, maps completion to `effect.exit`; events, links, non-scalar attributes remain Effect-local. Effect IDs are distinct from native CF IDs in this implementation.
- [Domain observability guide](https://github.com/alchemy-run/alchemy/blob/3bb45b0f089597f4b0f9c908b2f5d615201d1405/website/src/content/docs/domain/observability.mdx) describes command/decide/view/policy/projection/saga/external spans, `domain.correlation_id`, and domain metrics.
- The Domain guide's blanket statement that every Worker/DO event creates a disconnected native trace is too broad: [Cloudflare's May 7 change](https://developers.cloudflare.com/changelog/post/2026-05-07-automatic-tracing-across-do-and-worker-subrequests/) explicitly supports unified tracing through service bindings and DO subrequests. Later alarms, scheduled work and replays still need durable business correlation; do not assume all asynchronous causality becomes one native trace.
- [Cloudflare's October 26 addition](https://developers.cloudflare.com/changelog/post/2026-10-26-span-context-status-update-name/) exposes `spanContext()`, `setStatus()` and `updateName()`. The inspected Alchemy bridge has not adopted those methods. CF status is exported but currently not displayed/filterable in its dashboard. Therefore retain a queryable application outcome attribute even with status mapping.
- [Known limitations](https://developers.cloudflare.com/workers/observability/traces/known-limitations/): automatic external trace propagation is not supported. Do not promise one trace containing arbitrary browser/provider spans.
- Effect has one Tracer. Merging a native CF tracer and an OTLP tracer is not a reliable way to get two complete trace streams. Prefer native CF tracing plus platform OTLP export when an external destination is required; a separate Effect metrics exporter can coexist.

Proposed first-class telemetry contract:

1. One host-composition module supplies structured Effect logging, native CF tracing, context enrichment and redaction. Business operations use named Effect spans and typed failures.
2. Carry environment, release, operation, correlation ID, job ID and attempt ID. Add provider/model, latency, bytes and estimated/actual cost where relevant. User/job IDs belong in searchable logs/spans, not unbounded metric labels.
3. Use native platform metrics for infrastructure and [Analytics Engine](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/#custom-analytics-with-analytics-engine) for explicit application observations, or an OTLP metrics exporter. Neither is automatically populated with every Effect Metric simply by enabling traces.
4. Keep usage reservations, consumption, refunds and provider receipts in durable authoritative storage. Sampled telemetry is not the financial ledger.
5. Declare retention, sampling, dashboards and alerts alongside infrastructure where supported. Alert on generation failure/latency, pending job age, projection lag, failed delivery, unresolved provider outcome, cost anomalies and refund backlog. Include the alert destination in validation; a declared rule with no delivery is not an operational alert.
6. Preserve privacy: do not log wardrobe photos, prompts, auth tokens, signed media URLs or raw request bodies. Review automatic URL/query capture as well as application logging. Attach safe references and classify expected rejections separately from defects.
7. Validate telemetry on fetch, DO RPC, alarm/retry and queue/workflow paths. Check concurrent requests do not share context; confirm logs and native trace IDs correlate under the actual pinned bridge; check failures remain queryable.
8. Keep browser error/performance telemetry through an explicit frontend destination or authenticated, bounded relay. CF-native backend telemetry does not automatically cover browser execution.

## Architectural direction for Styld

This is compatible with one rewrite and one production cutover after a feature freeze. Internal implementation slices and rehearsals establish readiness; they do not require incremental production migrations.

- Keep one public origin and current route/auth/MCP contracts. An edge Worker replaces Caddy, serves assets and routes to internal capabilities. Separate API/jobs Workers only where their lifecycle or isolation benefits justify it; business domains are modules, not automatically services.
- Effect models complete application operations with typed errors, explicit dependencies and scoped lifetimes. Validate outside data at boundaries. HTTP, MCP and jobs invoke those same operations; adapters preserve existing external contracts.
- Foldkit is a credible full UI rewrite choice. Source examples do not prove Styld's React Flow editor, Base UI interactions, public SSR/OG behavior, mobile gestures, accessibility or localization can simply be ported. Prototype the actual Studio interaction and public-page rendering before fixing the frontend scope.
- Use Domain where serialized decisions, durable reactions and observable state transitions earn it: generation jobs and usage reservations are a strong first acceptance slice; boards may benefit if live multi-client coordination is required. Do not event-source every table by default.
- Assign one authoritative writer to each invariant. Domain-owned state may project into D1 for queries; an ordinary D1-owned entity should not also have an independently writable Domain copy. Cross-object reservations and provider effects require explicit idempotent protocols/compensation; neither Effect nor Domain makes separate writes atomic.
- Drizzle remains useful for SQL schema, migrations and queries. A fully CF data target is D1 for relational state, DO SQLite for serialized partitions, R2 for media and Vectorize for derived vector search. Styld currently uses pgvector/cosine queries, JSONB and PG enums; this is a query/data migration, not a driver replacement. Similarity candidates must be filtered through authoritative visibility/safety rules.
- R2 owns bytes; generated assets use stable object keys and durable metadata. Native image transformations can replace resizing/delivery, but cannot replace generative try-on.
- Choose one durable orchestration owner per job. Alchemy Domain's saga adapter uses its DO-backed Effect workflow engine; it is not automatically native Cloudflare Workflows. Select that or a native Workflows adapter deliberately rather than stacking both.
- Pin compatible Effect/Alchemy/Foldkit families, preserve infrastructure identities, retain stateful resources and migrate before serving new code. Avoid migrations at every Worker request/cold start. Keep the prior deployment/data snapshot until the cutover has a reconciled acceptance result.

Rat-stack principles reviewed in `joelhooks/rat-stack@de67d8c670cb7e10c83ef5e7a7cf7ff886ebbb2f`: named system of record, one writer per partition, no independent dual writes, complete operation contracts, provider guarantees, bounded reads, idempotency and behavioral gates. These are architectural principles; they do not require every project to adopt every library.

## Image generation economics

[Cloudflare's pricing page](https://developers.cloudflare.com/workers-ai/platform/pricing/) retrieved during this review lists:

- FLUX.2 klein 4B: $0.000059 per input 512x512 tile and $0.000287 per output 512x512 tile.
- FLUX.2 klein 9B: $0.015 for the first output MP (1024x1024), $0.002 per additional output MP, $0.002 per input-image MP.
- Therefore a 1024x1024 klein 4B output is about $0.001148 before reference inputs. With two one-tile references, about $0.001266 per attempt, excluding storage, delivery and retries. This is arithmetic from published rates, not measured billing.
- The [Workers AI launch documentation](https://developers.cloudflare.com/changelog/post/2026-01-28-flux-2-klein-9b-workers-ai/) describes four reference images and small input-size constraints. Verify the selected endpoint's current limits before relying on it for multi-garment try-on.
- Styld's checked-in pricing table records $0.034 per Gemini 3.1 Flash-Lite image, but that is a local estimate, not a verified current invoice or deployed model selection.
- Run a fixed garment/person evaluation set: identity, garment shape, logos/text, layering, footwear, cropping, skin tone, refusal and failure. Measure cost per accepted result, including retries and any fallback. The code already documents a cheaper provider changing footwear and cropping trousers.
- Route by capability and quality tier; use deterministic transforms/composites when no generation is needed. AI Gateway can centralize routing and telemetry but does not itself make an unchanged model cheaper.

## Acceptance cases before selecting the final design

1. Duplicate submit and changed payload with the same idempotency key; cross-user reuse; no double reservation or consumption.
2. Provider accepted a request but the response was lost; restart immediately before/after the external call. Reconcile a stored provider request ID where supported; retain an explicit unknown outcome when it is not safe to repeat.
3. Restart/redeploy while alarms, outbox work and projections are pending; exhausted retries become discoverable and recoverable.
4. Concurrent edits and competing quota reservations; prove native adapter behavior, not only Domain.InMemory tests.
5. Private-to-public and public-to-private changes, blocking/moderation and OAuth grant revocation during live connections; no stale projection can expose forbidden content.
6. Delete account/media with event history, snapshots, projections, R2 objects and scheduled work present; prevent replay or delayed callbacks from resurrecting it.
7. Export/import existing SQL and objects, stable IDs and timestamps, vector search behavior, public URLs and callback paths; reconcile totals and representative rendered behavior.
8. One representative operation is diagnosable across request, durable execution, provider attempt, persistence, refund/failure and client status, with working alerts and no private payloads.
9. Studio editing and public-page/OG/mobile behavior pass actual browser acceptance on the new UI.

The reference review supports the stack's building blocks. It does not establish Styld parity, runtime correctness or a guaranteed one-to-two-day delivery estimate.
