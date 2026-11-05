# Dependency patches

## Alchemy Domain beta.84 export map

Pinned `@alchemy.run/cloudflare@2.0.0-beta.84` imports `captureContext` from `@alchemy.run/domain/internal` in both its source and compiled Domain adapter. The matching published Domain package ships those files but sets that subpath to `null` in its export map. An ordinary adapter import fails under Bun before hosting can start.

`patches/@alchemy.run%2Fdomain@2.0.0-beta.84.patch` exposes only that existing subpath with type, Bun/Worker source and default compiled conditions. It changes no algorithm or persistence semantics. Bun applies the version-specific patch through the lockfile. Application code must continue using public Domain APIs.

The dependency-contract test imports the adapter under Node and Bun. Native Worker bundling and hosting remain separate checks. On a coordinated Alchemy upgrade, inspect the upstream export map, remove this patch if repaired, and rerun both import and native lifecycle tests. No upstream issue has been submitted.
