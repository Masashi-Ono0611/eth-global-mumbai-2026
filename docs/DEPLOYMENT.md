# Isolated preview deployment

Only the v2 `preview` stack is authorized. It has independent D1/R2 resources and three Workers. The public edge owns the workers.dev URL; API and SSR Workers disable both public workers.dev and version preview URLs. No custom domain is attached.

The ignored `.env.preview.local` file holds `STYLD_AUTH_SECRET` and `STYLD_AUTH_SESSION_KEYS`. The latter is JSON with an `activeKeyId` and `keys` array of `{ id, material }`; material is at least 32 random bytes encoded as unpadded base64url. Keep this file mode 600. Never print it, commit it, or use v1/production secrets here.

Supply `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` through the environment. Alchemy's environment credential resolver requires both; a token alone falls back to the configured profile. The account for this preview is `bceaeae4788dce3493514fde194b4a7e`.

After the owned changes are committed and gates are green:

```sh
STYLD_RELEASE="$(git rev-parse HEAD)" heavy --wait bunx alchemy deploy \
  --stage preview --env-file .env.preview.local --dry-run --no-input
STYLD_RELEASE="$(git rev-parse HEAD)" heavy --wait bunx alchemy deploy \
  --stage preview --env-file .env.preview.local --no-input --yes
```

Read the plan and final resource outcomes, not just the process exit code. The pinned CLI has returned exit 0 on failed plans/uploads. Read back Worker deployment IDs, bindings and public access settings; check health, auth/CSRF, asset delivery and browser hydration against the returned edge URL. Local unit and workerd passes do not establish cloud acceptance.

The native test stack deploys the production Foldkit artifact in workerd; Alchemy's ordinary Foldkit development host uses Node/Vite. `heavy --wait bun run test:native` rebuilds first and includes Chromium browser acceptance. Install the repository's pinned browser with `heavy --wait bunx playwright install chromium` if needed.

The current isolated preview URL is `https://styldappv2-styldedge-preview-vdqhe23kflepifq2.kristjan-grm11775.workers.dev`. Verify it with:

```sh
STYLD_PREVIEW_URL="https://styldappv2-styldedge-preview-vdqhe23kflepifq2.kristjan-grm11775.workers.dev" \
  heavy --wait bun test tools/preview.native.test.ts
```

That receipt is tied to the deployed release recorded in `docs/STATUS.md`; a later deploy must produce a new URL/version readback and rerun the test. Cloudflare bot controls may return Error 1010 to ad-hoc non-browser clients, so use the browser acceptance path when validating the public URL.
