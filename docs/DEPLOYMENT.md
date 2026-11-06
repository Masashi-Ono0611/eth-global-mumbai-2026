# Deployment

Three Alchemy stacks, all on the personal Cloudflare account (`bceaeae4788dce3493514fde194b4a7e`), all deployed from
GitHub-hosted runners (the repo is public; no self-hosted runner on this box).

| Stack | File | Stage | Live | Deployed by |
| --- | --- | --- | --- | --- |
| `EthMumbai` (app) | `alchemy.run.ts` | `main` | https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev | `check.yml` job `deploy`, every push to `main` after `bun run check` is green |
| `EthMumbaiSite` (scratch site) | `docs/site/alchemy.run.ts` | `prod` | https://eth-mumbai-site.kristjan-grm11775.workers.dev | `site.yml`, every push to `main` touching `docs/site/**`; no app gates (see `docs/site/README.md`) |
| `EthMumbaiMerchant` (merchant till) | `apps/merchant/alchemy.run.ts` | `prod` | https://eth-mumbai-merchant.kristjan-grm11775.workers.dev | `merchant.yml`, every push to `main` touching `apps/merchant/**` (its own tests, then deploy); its Worker forwards the five public merchant routes to the app's edge |

The app is one public edge Worker (`Edge`, owns the workers.dev URL) in front of the API Worker (`Api`) and the Foldkit
SSR Worker (`Website`), which have no public URLs; plus D1 `Database` and R2 `Media`. The merchant till is one
static-site Worker (`Till`, physical name pinned to `eth-mumbai-merchant`): it serves its Vite build and forwards only
the till's merchant routes (`/api/merchants/<id>/{items,invoices,gate-key}`, `/api/invoices/<id>/status`) to the app's
edge (`APP_ORIGIN`), never cookies; it has no D1, R2 or secrets of its own.

## State

All three stacks keep Alchemy state in the **named** Cloudflare state store `alchemy-state-store-ethmumbai` (its own
Worker and its own suffixed secrets in the account's Secrets Store), under `EthMumbai/main`, `EthMumbaiSite/prod` and
`EthMumbaiMerchant/prod`, so any checkout and CI plan against the same resources. Each stack's file passes
`Cloudflare.state({ name: 'ethmumbai' })`; a new stack must too. Never point this project at the account's default
`alchemy-state-store`: it is v7 and shared with other projects. Alchemy stays at **2.0.0-beta.84** (state store v7)
for the same reason: beta.85 bootstraps stores to v8, and beta.84 in turn holds Effect at 4.0.x (it imports
`effect/Crypto`, removed in 4.1). Upgrading means checking first that a v8 bootstrap of the named store leaves the
default store alone.

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
check fails too. A retry finds the store serving. The root `patchedDependencies` applies it to every install of that
version, so all three workflows (each runs `bun install --frozen-lockfile` at the root) deploy through the guard.

**Rules.**
- Never bootstrap or upgrade the state store from CI. Only a person runs `alchemy state bootstrap`, by hand.
- Keep the pinned names: the app's in `packages/server/src/ProductionNames.ts` (stage `main`), the site's comments D1
  (`prod`), the till's Worker `eth-mumbai-merchant`. Without them, a lost state would mint a second copy instead of
  adopting the live one. The till came after the incident (first deploy 10:55Z) and was pinned from the start.
- Before a deploy with `--adopt`, dry-run it and read the plan: only `adopted`/`update`, and `create` only where
  Apply adopts it by name.

## Secrets

GitHub Actions secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (all three stacks), and for the app only
`APP_AUTH_SESSION_KEYS` plus the feature bindings `alchemy.run.ts` lists (`APP_RELAYER_PRIVATE_KEY` …
`APP_SCANS_ENABLED`). A feature binding left unset defaults to `pending`, and then only its routes answer 503 "not
configured"; `/api/health` reports which are set, as booleans. The site and the till take no app secrets. Locally the
app's live in the ignored `.env.main.local` (mode 600; never print or commit it). `APP_AUTH_SESSION_KEYS` is JSON
`{ "activeKeyId": "k1", "keys": [{ "id": "k1", "material": … }] }`, material at least 32 random bytes as unpadded
base64url. `APP_RELEASE` is the commit, set by CI or on the command line.

### Telegram (spec §14)

`APP_TELEGRAM_BOT_TOKEN` (the @vitaquack_bot token from BotFather) and `APP_TELEGRAM_WEBHOOK_SECRET` (16–256 of
`[A-Za-z0-9_-]`, random) are GitHub secrets and lines in `.env.main.local`. Both set turns the feature on
(`/api/health` → `telegram: true`); either missing or `pending` turns it off and its routes answer 503. After a deploy
that changes the edge URL, or after rotating either value, point the bot at the app by hand (never from CI):

```sh
bun --env-file=.env.main.local packages/server/scripts/telegram-set-webhook.ts         # setWebhook + commands
bun --env-file=.env.main.local packages/server/scripts/telegram-set-webhook.ts --info  # read the current webhook
```

Owners link a chat only through the wallet's one-time code (avatar → Connect Telegram); no chat id is configured
anywhere. Once a webhook is set, Telegram's `getUpdates` stops answering.

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

The scratch site and the till have their own deploy scripts. Dry-run first, from the stack's directory, and read the
plan: an `update` of the existing Workers, no `create` of a second one.

```sh
export CLOUDFLARE_ACCOUNT_ID=bceaeae4788dce3493514fde194b4a7e
(cd docs/site && bunx alchemy deploy alchemy.run.ts --stage prod --dry-run --no-input)
(cd apps/merchant && bunx alchemy deploy alchemy.run.ts --stage prod --dry-run --no-input)
bun run --cwd docs/site deploy && bun run --cwd apps/merchant deploy
```
