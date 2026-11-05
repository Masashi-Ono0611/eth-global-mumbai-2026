# Deployment

Two Alchemy stacks, both on the personal Cloudflare account (`bceaeae4788dce3493514fde194b4a7e`), both deployed from
GitHub-hosted runners (the repo is public; no self-hosted runner on this box).

| Stack | File | Stage | Live | Deployed by |
| --- | --- | --- | --- | --- |
| `EthMumbai` (app) | `alchemy.run.ts` | `main` | https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev | `check.yml` job `deploy`, every push to `main` after `bun run check` is green |
| `EthMumbaiSite` (scratch site) | `docs/site/alchemy.run.ts` | `prod` | https://eth-mumbai-site.kristjan-grm11775.workers.dev | `site.yml`, every push to `main` touching `docs/site/**`; no app gates (see `docs/site/README.md`) |

The app is one public edge Worker (`Edge`, owns the workers.dev URL) in front of the API Worker (`Api`) and the Foldkit
SSR Worker (`Website`), which have no public URLs; plus D1 `Database` and R2 `Media`.

## State

Both stacks keep Alchemy state in the **named** Cloudflare state store `alchemy-state-store-ethmumbai` (its own
Worker and its own suffixed secrets in the account's Secrets Store), so any checkout and CI plan against the same
resources. Never point this project at the account's default `alchemy-state-store`: it is v7 and shared with other
projects. Alchemy stays at **2.0.0-beta.84** (state store v7) for the same reason: beta.85 bootstraps stores to v8,
and beta.84 in turn holds Effect at 4.0.x (it imports `effect/Crypto`, removed in 4.1). Upgrading means checking first
that a v8 bootstrap of the named store leaves the default store alone.

## Secrets

GitHub Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `APP_AUTH_SECRET`, `APP_AUTH_SESSION_KEYS`.
Locally the app's two live in the ignored `.env.main.local` (mode 600; never print or commit it). `APP_AUTH_SECRET` is
at least 32 characters. `APP_AUTH_SESSION_KEYS` is JSON `{ "activeKeyId": "k1", "keys": [{ "id": "k1", "material": … }] }`,
material at least 32 random bytes as unpadded base64url. `APP_RELEASE` is the commit, set by CI or on the command line.

## Deploy by hand

After `heavy --wait bun run check` is green, with `CLOUDFLARE_API_TOKEN` in the environment:

```sh
export CLOUDFLARE_ACCOUNT_ID=bceaeae4788dce3493514fde194b4a7e
APP_RELEASE="$(git rev-parse HEAD)" heavy --wait bunx alchemy deploy --stage main --env-file .env.main.local --dry-run --no-input
APP_RELEASE="$(git rev-parse HEAD)" heavy --wait bunx alchemy deploy --stage main --env-file .env.main.local --no-input --yes
```

Read the plan and the final resource outcomes, not just the exit code (this CLI has returned 0 on failed uploads).
Then check `/api/health` (its `release` is the commit) and run the browser acceptance:

```sh
APP_PREVIEW_URL=https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev \
  heavy --wait bun test tools/preview.native.test.ts
```
