# Styld translation and localization research

Snapshot: 2026-10-28. Public docs/source and local repository research only. No Styld files, dependencies, translations, API calls, or deployments changed.

## Existing Styld surface

Styld currently uses `next-intl` 4.13.1 in the Next.js web app with typed message keys derived from `en.json`, an `en`/`sl` catalog parity test, and a `NEXT_LOCALE` cookie. The catalogs contain 2,296 string leaves in each locale, 59 English plural messages, 58 Slovenian plural messages, one select message, three ICU rich-text tag messages, and several arrays used as UI steps/highlights. Slovenian therefore needs full CLDR plural handling (`one`, `two`, `few`, `other`), not just English-style singular/plural.

## General Translation findings

Current public packages inspected: `generaltranslation` 9.5.8, `gt-i18n` 1.0.39, and `@generaltranslation/icu` 0.1.2.

- General Translation is a localization platform with a CLI, dashboard, translation editor, context/glossary support, branching, CDN, API, and optional AI/agent workflows.
- The CLI translates JSON regardless of the runtime i18n library. Its JSON workflow supports custom syntax such as ICU messages for next-intl and i18next; keyed metadata can carry context and character limits.
- Starter pricing has a $0 platform fee and usage-based billing; the public usage page lists the current rates recorded below. Enterprise pricing is custom and all rates can change.
- `@generaltranslation/icu` is dependency-free ICU parsing/formatting with AST parsing/printing, interpolation, selects, cardinal/ordinal plurals, number/date/time and skeleton formatting through native `Intl`. It supports rich tag variables and requires no network. Its public formatter parses on each `formatMessage` call; no public precompiled-AST formatter was found.
- `gt-i18n` public functions require initialization; current source registers global configuration and a condition-store implementation. That alone does not establish that official adapters leak request locale: an adapter can supply an isolated store. No verified Foldkit adapter was found. Swarmm's October 19 spike used version 1.0.38 and found an undeclared `InterpolationOptions` type in internal declarations; that historical bug has not been reproduced on current 1.0.39. Avoid building our integration on internal singleton manipulation.
- General Translation's current docs list React, Next.js, TanStack Start, Vue, Node, and other integrations, but no inspected adapter provides a Foldkit runtime. We should use the CLI/platform independently of any framework adapter.

## Direct Foldkit evidence

Swarmm's existing stack spike tested General Translation with Effect 4, Foldkit, Alchemy and TypeScript 7. The offline `@generaltranslation/icu` path passed interpolation, select, English plurals, Slovenian `one`/`two`/`few`/`other`, English fallback, and a headless Foldkit locale switch. The spike explicitly recommended `@generaltranslation/icu` plus a small explicit-locale adapter, with General Translation's CLI introduced later for catalog translation. It rejected `gt-i18n` as the runtime seam because of initialization/global-state and declaration issues.

## Catalog-level probe

On 2026-10-28, an offline Bun probe ran against the actual Styld catalogs and the installed `intl-messageformat` 11.2.10 used by `next-intl`:

- all 4,592 catalog strings (2,296 per locale) parsed successfully with `@generaltranslation/icu`;
- 6,448 formatting cases covered defaults, plural-category and exact-selector values, Slovenian counts `0, 1, 2, 3, 4, 5, 11, 21, 101, 102, 103, 104`, decimals, select fallback, escaping, offset plurals, and rich tags. This is a finite sampled comparison, not exhaustive ICU conformance;
- GT ICU and FormatJS produced identical results in every case, and all parse/print round trips passed;
- the probe found three existing catalog messages whose plural forms do not enumerate every CLDR category: `admin.versionsCount` uses `=1/other`, `activity.activeCount` omits Slovenian `two`, and `profile.shop.piecesCount` omits Slovenian `two/few`. Those are translation/content decisions to review, not formatter failures.

A 20-round local benchmark over the same 4,592 strings took 444 ms for GT ICU (parsing each call), 558 ms for a new FormatJS formatter per call, and 105 ms for preconstructed FormatJS formatters. Warm-up and formatter construction are excluded from these timings. Minified browser engine bundles, excluding catalogs, were 6.3 KB gzip for GT ICU and 9.7 KB gzip for FormatJS. This is one Bun benchmark, not a Cloudflare CPU/SLO measurement; the rewrite must validate cold-start, memory and actual render CPU in workerd. Bench scripts are retained beside this report.

## Cloudflare and pricing facts

Cloudflare Workers documentation says Workers reuse isolates and warns against request-scoped mutable module state. For compatibility dates on or after 2026-08-04, Node.js compatibility is enabled by default; `nodejs_als` is available when only AsyncLocalStorage is needed. Both candidate formatters use native `Intl`, but a Worker smoke test must verify plural rules, date/number formatting, rich output, bundle size, and CPU before adoption.

General Translation's current public usage page (retrieved 2026-10-28) lists JSON at $1 per 1,000 input tokens, optional platform context at $0.02 per 1,000 input tokens per 1,000 context tokens, GT Runtime/Devtime at $0.40 per 1,000 input tokens, and a $0 platform fee. The page is usage-based and can change; keep an account budget and do not invoke it on a normal render path.

## Alternatives

### `next-intl`

Excellent for the existing Styld Next.js app: typed message catalogs, server/client integration and rich text are already proven. It is a framework adapter, though, and should not become the shared runtime if the rewrite moves the UI to Foldkit/Alchemy Workers. Keep it as a compatibility reference or a thin web adapter, not the new core.

### Paraglide JS 2.29.2

The strongest alternative for a compile-time-first UI. It generates typed message functions, supports tree-shaking, SSR, Vite/standalone servers, locale routing, and translation checks for missing variables, forms, markup and unused messages. It supports JSON/i18next/ICU through inlang plugins and has a Cloudflare/edge SSR story.

Trade-offs for Styld: it introduces a compiler-generated runtime and inlang project, ICU is supplied through an inlang plugin rather than its core syntax, and rich text requires generated message parts/adapters. Its current docs support forcing a locale per message and describe AsyncLocalStorage-based SSR middleware, so it is not disqualified by global locale state; explicit locale state is still a cleaner fit for Foldkit's Model/update architecture. No inspected Foldkit application proved Paraglide integration. If we choose it later, use `inlang check` (not the deprecated no-op `inlang lint`) and fail CI when a check is incomplete.

### Lingui 6.10.1

Mature extraction/compile workflow, ICU, PO catalogs, typed IDs, rich text, React Server Components and framework-agnostic `@lingui/core`. It is a good choice for a React-heavy application with translator-owned PO files. Its macro/Babel/SWC extraction pipeline is additional build complexity and has no direct Foldkit/Alchemy reference in the inspected projects.

### FormatJS / `intl-messageformat`

A mature framework-independent ICU runtime with rich output, AST input, and reusable formatter instances. Its installed version 11.2.10 is already underneath Styld's `next-intl`. It supplies no translation-management workflow, but it is the preferred default after the local compatibility and cached-formatting probe. Construction can start from strings or build-generated ASTs; the benchmark measured reused string-constructed instances, not an AST compiler pipeline.

### i18next / react-i18next

Broad ecosystem and many adapters, including isolated-instance and fixed-language APIs. It is supported by General Translation's CLI. It was only lightly reviewed here; preserving Styld's existing ICU catalogs with a focused formatter offers a more direct migration.

## Recommendation

Adopt a two-layer design:

1. **Runtime package: `@styld/i18n`**
   - Production locales are `"en" | "sl"`; `"en-XA" | "ar-XB"` are test/dev pseudolocales.
   - Explicit `format(locale, messageKey, variables)`; no process-global locale.
   - Use `intl-messageformat` with bounded, lazily constructed formatter caches as the production default. Consider build-generated ASTs only if the actual bundle/cold-start profile warrants it. GT ICU remains a research comparator; do not ship two engines or silently fall between them.
   - Derive typed keys and argument contracts from ICU ASTs, validated across all shipped locales. The formatter itself does not provide catalog-specific types. Plain placeholders cannot reveal every domain type, so allow small explicit argument annotations where inference is insufficient. Do not create a custom ICU engine.
   - Catalogs loaded as immutable request inputs or statically imported per Worker bundle.
   - Foldkit adapter stores `uiLocale`, catalog version and loading state in the Model; locale changes are Messages/Commands. Ignore obsolete asynchronous load results and synchronize `html.lang`, `dir` and localized metadata.
   - SSR receives locale, time zone, catalog version and request-stable `now` explicitly and passes the same inputs to the client. Foldkit SSR/hydration is still a separate proof gate.
   - Formatting is synchronous presentation logic; Effect owns catalog I/O, persistence, request negotiation and telemetry. Domain operations return stable error codes and structured data, localized at UI/email/MCP presentation boundaries.
   - Separate `conversationLocale`, `notificationLocale`, and any future content/deliverable locale from `uiLocale`.

2. **Translation workflow: General Translation**
   - Source of truth remains reviewed repository catalogs.
   - GT CLI/dashboard is an optional authoring job for changed/new copy, with a reviewed diff and spend limit. Verify the pinned CLI's existing-translation preservation and billing behavior before activation. Existing en/sl translations need no initial retranslating.
   - Per-key metadata supplies context, glossary terms, legal/commercial constraints and max lengths.
   - Translation PRs run parity, ICU parse, variable, plural/select, markup, unused-key and pseudo-locale checks.
   - GT API keys stay in CI/build secrets. The Worker never calls GT to render a normal request.
   - A translation CDN can be considered later for large content catalogs; it must be versioned and fail back to the last-known-good local catalog.

No hosted service is required for rendering or ordinary builds. Any later live user-content translation is a separate, authorized job with source/target locale, content hash, review status, retries and cost accounting.

## Catalog and locale architecture

- English is the source language; Slovenian is the launch target.
- Add `en-XA` pseudo-locale for expansion and `ar-XB` RTL fixtures even if RTL is not a launch market.
- Locale resolution preserves the existing choice cookie, then considers saved preference, supported `Accept-Language`, then English. If public locale routes are introduced, the explicit route wins. Unsupported tags map to documented fallbacks.
- Preserve current `/@name`, share links and published MCP routes. Define public locale/SEO routes deliberately; only emit `hreflang` and sitemap alternatives for actual equivalent localized URLs.
- Catalogs are immutable versioned assets split by surface when useful. Cache formatters by finite catalog key, version, locale and relevant formatting options. Public response caching must include locale/version and preserve existing visibility/auth rules; personalized responses never enter a public cache. Never mutate a shared request locale or cache interpolated user values.
- Rich text uses an allowlisted tag-to-renderer map; translated strings never become raw HTML. Preserve the existing three italic tag messages through this adapter.
- Dates, numbers, currencies, relative time and plural categories use `Intl`; locale does not choose payment currency.
- Legal/terms and commercial copy require reviewed translations, and acceptance records store the accepted terms version and locale.
- Include welcome/auth emails in the shared locale contract and capture notification locale when enqueuing delivery. User-written content and catalog titles retain their original language unless explicitly translated.
- Emit structured missing-message, fallback and formatter-error events with key, locale, catalog/deploy version and request trace context. Aggregate counters by bounded dimensions; deduplicate noisy errors. Never record interpolation values or complete user messages. Pure views return diagnostics to the host boundary rather than doing logging inside rendering.

## Gates

Add an i18n gate to the monorepo quality system:

- exact key parity across shipped locales;
- ICU parse and print round-trip;
- compatible variable-name/type contracts across languages;
- complete plural/select categories for each locale, or a documented exact-selector/intentional fallback waiver;
- rich-tag parity and allowlist checks;
- missing/empty translations fail; identical strings are reviewed with an allowlist for brands, proper names and legitimately identical copy;
- unused-key analysis must report incomplete coverage; use finite explicit key maps instead of arbitrary runtime key construction;
- pseudo-locale expansion and RTL rendering fixtures;
- server/Worker render and hydration use the same locale/catalog version;
- public route, metadata and `hreflang` snapshots;
- email/auth/MCP error catalog coverage;
- long-string and accessibility-label checks.
- The gate consumes the pinned tsrs/effect-tsrs and Oxlint pipeline from the tooling research. Add compile-negative fixtures for missing/wrong arguments, and reviewed lint exemptions for user content, URLs and product names. Keep locale policy in one small project instruction; no new agent/MCP integration is needed to render translations.

## Decision

Choose a small explicit-locale `@styld/i18n` adapter over cached `intl-messageformat`, preserve the reviewed en/sl ICU catalogs, and make General Translation an optional reviewed catalog-authoring workflow. Paraglide is the strongest alternative if generated message functions/extraction become a priority. The first implementation acceptance should render a real public page, one Studio interaction and a welcome email in en/sl, verify concurrent Worker requests, then exercise the pseudolocales and error telemetry. No new monorepo or rewrite was started in this research turn.

## Sources and reproducibility

- General Translation: https://generaltranslation.com/en-US, https://generaltranslation.com/en-US/pricing/usage, https://generaltranslation.com/en-US/docs/cli/reference/formats/json-files, https://github.com/generaltranslation/gt at `6a46c44feec8134a2248632f2cded4a5af1b1b8f`.
- Paraglide: https://paraglidejs.com/basics, https://paraglidejs.com/checking-translations, source snapshot `b54a31737ab6e69cde5b7583d892fee777978cfc`.
- FormatJS: https://formatjs.github.io/docs/intl-messageformat/ and the installed 11.2.10 source; Lingui: https://lingui.dev/ref/core and https://lingui.dev/guides/typed-message-ids.
- Cloudflare: https://developers.cloudflare.com/workers/runtime-apis/nodejs/, https://developers.cloudflare.com/workers/configuration/compatibility-flags/, https://developers.cloudflare.com/workers/best-practices/workers-best-practices/.
- Local reference: `/home/kristjan/code/swarmm/packages/i18n` and its Effect/Foldkit spike in `docs/foundation-spec.md`.
- Scratch probe outputs: `/tmp/styld-i18n-research-20261028/probe-results.json` and `/tmp/styld-i18n-research-20261028/bundle-results.json`.
