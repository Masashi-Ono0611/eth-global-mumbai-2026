# Architecture decisions

## Runtime and public contracts

One Cloudflare public origin replaces Caddy and Railway. A small public edge Worker routes explicit API namespaces to the internal Effect Worker and pages to the Alchemy Foldkit Website. Both internal Workers disable workers.dev and version preview URLs. The edge serves the Foldkit build's static assets directly: service-binding fetch bypasses the website's public asset router. Foldkit's generated SSR entry stays unmodified; beta.84 does not support a custom entry with `ssr.build`. The internal Effect Worker owns typed application operations and Domain hosting. HTTP, MCP and durable jobs invoke the same operations. Preserve published MCP names/arguments, `/mcp`, `/mcp/app`, auth discovery and consent/revocation behavior. Preserve public profile/share/link contracts.

## State ownership

D1 with Drizzle owns identity/application relational data, wardrobe, profiles, social/safety, catalogs and ordinary board metadata. Alchemy Domain on SQLite Durable Objects owns credit/usage reservations and generation lifecycle decisions, outboxes and durable orchestration. A domain-owned invariant has no second writable D1 copy. Projections are derived and idempotent. R2 owns media bytes. Vectorize indexes derived embeddings; all search candidates pass current visibility/safety authorization.

Model commands carry idempotency and request hashes. Provider accepted-but-response-lost is an explicit unknown state, reconciled by provider receipt where possible. Usage is reserved before execution, consumed after durable success or refunded once after known failure. Credentials, credit amounts and owner identity never come from trusted browser input.

Domain beta.84 looks up a transport command ID before re-running `decide`. Transport IDs therefore remain server-owned and stable per internal operation. The generation request must own public idempotency keys and canonical payload fingerprints; direct public Wallet command access is forbidden. The Wallet retains only pending holds, and its durable receipts prevent a settled operation from being reserved again under its original server-generated command ID. Receipt retention or deletion must preserve that invariant.

Monthly credits roll over up to twice the monthly grant, including held subscription credits. A plan downgrade may reduce unreserved subscription credits but never erases an in-flight hold. Refunds restore the original source pools, preserving purchased-credit ownership.

## Authentication

Yielded Auth is the chosen authentication library. Stateful sessions have no positive cookie cache: logout, account disablement and security-revision changes take effect on the next request. Password attempt budgets use atomic D1 token buckets with database time and HMAC identifier keys; auth runtime recreation cannot reset them. Port anonymous users/merge, email OTP, Google sign-in, sessions, account linking/deletion and MCP authorization with explicit storage adapters. MCP is bearer-only, HTTPS/loopback redirects, CIMD primary and compatible DCR, short-lived access tokens, consent re-read and immediate revoke. Dodo customer creation stays lazy at checkout and cannot block sign-in.

## UI and localization

Foldkit owns Model/Message/update/view/Commands. Port Studio interactions, accessibility, gestures, mobile/Safari behavior, public SSR/OG and en/sl. Reuse v1 design assets and reviewed content. Preserve ICU catalogs in `@styld/i18n` over cached `intl-messageformat`; General Translation is optional reviewed authoring only. API errors use typed codes; presentation localizes. No runtime translation calls.

## Providers and cost

Cloudflare image delivery replaces deterministic image transforms. Generative try-on still needs a measured provider. Workers AI candidates are evaluated against garment/person quality fixtures; accepted-result cost includes retries and fallback. A capability router chooses provider/model by task and budgets. No silent downgrade of identity, garment or safety quality. Deployed credentials use application-scoped pay-as-you-go access, never a personal subscription plan that forbids app backends.

## Observability

Native Cloudflare logs/traces are composed once at the host. Effect named spans and typed outcomes carry release/environment/correlation, job and attempt identifiers. Delayed work persists correlation separately from trace identity. Add explicit application metrics and failure/retry/projection/usage alerts. Keep raw personal payloads out of logs. Browser telemetry has an explicit bounded path. Validate failures and context isolation on the actual runtime.

The initial Worker uses `Cloudflare.Telemetry({ headSamplingRate: 1 })` for acceptance visibility and the platform's invocation logs. Production sampling, retention and alert thresholds are infrastructure decisions, while the usage aggregate remains the financial record. Native local logs are empty for successful requests, so deployed trace/log readback is a required gate rather than inferred from process output.

## Delivery boundary

Deliver an isolated preview at workers.dev, with safe test data and functioning provider paths. No production DNS cutover, destructive v1 migration or personal-data copying into preview. Provide a reconciled export/import rehearsal and documented production migration procedure as part of parity readiness.

The pinned Domain `2.0.0-beta.84` does not export the skill's `Domain.verify(Model)` helper. Building the real model validates definitions through its kernel; a story test checks construction. Follow installed source where the bundled skill describes a newer API.
