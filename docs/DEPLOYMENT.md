# Deployment

Two Alchemy stacks, both on the personal Cloudflare account (`bceaeae4788dce3493514fde194b4a7e`), both deployed from
GitHub-hosted runners (the repo is public; no self-hosted runner on this box).

| Stack | File | Stage | Live | Deployed by |
| --- | --- | --- | --- | --- |
| `EthMumbai` (app) | `alchemy.run.ts` | `main` | https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev | `check.yml` job `deploy`, every push to `main` after `bun run check` is green |
| `EthMumbaiSite` (scratch site) | `docs/site/alchemy.run.ts` | `prod` | https://eth-mumbai-site.kristjan-grm11775.workers.dev | `site.yml`, every push to `main` touching `docs/site/**`; no app gates (see `docs/site/README.md`) |
| `EthMumbaiMerchant` (merchant till) | `apps/merchant/alchemy.run.ts` | `prod` | https://eth-mumbai-merchant.kristjan-grm11775.workers.dev | `merchant.yml`, every push to `main` touching `apps/merchant/**` (its own tests, then deploy); its Worker forwards the five public merchant routes to the app's edge |

The app is one public edge Worker (`Edge`, owns the workers.dev URL) in front of the API Worker (`Api`) and the Foldkit
SSR Worker (`Website`), which have no public URLs; plus D1 `Database` and R2 `Media`.

## State

Both stacks keep Alchemy state in the **named** Cloudflare state store `alchemy-state-store-ethmumbai` (its own
Worker and its own suffixed secrets in the account's Secrets Store), so any checkout and CI plan against the same
resources. Never point this project at the account's default `alchemy-state-store`: it is v7 and shared with other
projects. Alchemy stays at **2.0.0-beta.84** (state store v7) for the same reason: beta.85 bootstraps stores to v8,
and beta.84 in turn holds Effect at 4.0.x (it imports `effect/Crypto`, removed in 4.1). Upgrading means checking first
that a v8 bootstrap of the named store leaves the default store alone.

### Incident 6 Nov 2026: the state store re-keyed itself, and the guard

**What happened.** The CI deploy of `c164d57` (09:32Z) logged "Cloudflare State Store … not found; deploying it". In
beta.84, `isStateStoreServing` turns any failure of its `getSubdomain` or `/version` probe into "missing", and with
`--yes` (CI must pass it to apply) a missing store is bootstrapped. That bootstrap generated a new
`StateStoreEncryptionKeyValue`, overwrote the store's encryption-key and token secrets in the Secrets Store, and then
failed. The store Worker itself was not redeployed. Every record of both stacks stayed encrypted with the old key,
which existed nowhere else: it was only in the store's own records (encrypted with itself) and in the overwritten,
write-only secret. Every deploy then failed with `getState (RpcCallError)`. The live app kept serving.

**Recovery: adoption, no data touched.**
1. Pin the live physical names (`packages/server/src/ProductionNames.ts`, used on stage `main`; the site's comments
   D1 on `prod`).
2. Delete the unreadable records with `alchemy state delete EthMumbai/main -r` and `… EthMumbaiSite/prod -r`. This
   removes state only.
3. Deploy once by hand with `--adopt` from a clean worktree. Api, Website, D1 and R2 were adopted, and Edge was adopted
   at apply time. No delete, no replace. URLs and every D1 row were unchanged, and D1 migrations did not re-run:
   their bookkeeping lives in the database's own `__alchemy_migrations`.

**Guard.** `patches/@alchemy.run%2Fcloudflare@2.0.0-beta.84.patch`: when the store's Worker script exists, a failed
probe now fails the deploy ("refusing to re-bootstrap it") instead of bootstrapping, and a failure of the existence
check fails too. A retry finds the store serving.

**Rules.**
- Never bootstrap or upgrade the state store from CI. Only a person runs `alchemy state bootstrap`, by hand.
- Keep the pinned names. Without them, a lost state would mint a second app instead of adopting this one.
- Before a deploy with `--adopt`, dry-run it and read the plan: only `adopted`/`update`, and `create` only where
  Apply adopts it by name.

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
