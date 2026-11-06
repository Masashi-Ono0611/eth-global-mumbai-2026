# Deployment

Three Alchemy stacks, all on the personal Cloudflare account (`bceaeae4788dce3493514fde194b4a7e`), all deployed from
GitHub-hosted runners (the repo is public; no self-hosted runner on this box).

| Stack | File | Stage | Live | Deployed by |
| --- | --- | --- | --- | --- |
| `EthMumbai` (app) | `alchemy.run.ts` | `main` | https://vitaquack.com from the cutover below (the workers.dev URL https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev keeps serving) | `check.yml` job `deploy`, every push to `main` after `bun run check` is green |
| `EthMumbaiSite` (scratch site) | `docs/site/alchemy.run.ts` | `prod` | https://vitaquack.com/plan/ (zone route `vitaquack.com/plan*`; `base.ts` handles the prefix) and https://eth-mumbai-site.kristjan-grm11775.workers.dev | `site.yml`, every push to `main` touching `docs/site/**`; no app gates (see `docs/site/README.md`) |
| `EthMumbaiMerchant` (merchant till) | `apps/merchant/alchemy.run.ts` | `prod` | https://cafe.vitaquack.com (custom domain) and https://eth-mumbai-merchant.kristjan-grm11775.workers.dev | `merchant.yml`, every push to `main` touching `apps/merchant/**` (its own tests, then deploy); its Worker forwards the till's three merchant routes to the app's edge |

The app is one public edge Worker (`Edge`, owns `vitaquack.com` and the workers.dev URL) in front of the API Worker (`Api`) and the Foldkit
SSR Worker (`Website`), which have no public URLs; plus D1 `Database` and R2 `Media`. The merchant till is one
static-site Worker (`Till`, physical name pinned to `eth-mumbai-merchant`): it serves its Vite build and forwards only
the till's merchant routes (`/api/merchants/<id>/{items,counter,counter/latest}`) to the app's
edge (`APP_ORIGIN`), never cookies; it has no D1, R2 or secrets of its own.

On `vitaquack.com` the edge serves the static landing at `/` (docs/site/pitch, copied into the build by
`tools/copy-landing.ts`; its films under `/media/*` with byte ranges, `packages/server/src/EdgeLanding.ts`), the
wallet's pages under `/app/…` (the prefix is `APP_BASE` in `packages/protocol/src/Pages.ts`), the API under `/api/…`
and the simulator under `/sim/`. `vitaquack.com/plan*` is the scratch site's zone route and `cafe.vitaquack.com` the
till's custom domain; both are owned by those stacks.

## Off Cloudflare: the evidence uploader on netcup

One piece runs outside Cloudflare: the **evidence uploader** (`tools/evidence-uploader/`), which puts finished
episodes and their camera frames on 0G Storage and records them in `EpisodeLog` on 0G Galileo. 0G's storage SDK needs
Node, so it cannot run in a Worker. It runs on netcup as the system service `vitaquack-evidence-uploader` (since 7 Nov
2026; restarts on any exit, starts with the box), polling `https://vitaquack.com` every 15 s. CI does not deploy it;
`sudo systemctl restart vitaquack-evidence-uploader` picks up a change. If it is down, errands still run and pay, but
their proof stays at "Saving to 0G...". Status, logs and install: `tools/evidence-uploader/README.md`.

## Cutover to vitaquack.com (6 Nov 2026)

One app deploy moves the app's origin: on stage `main` the Edge gets the custom domain `vitaquack.com` (pinned zone
`ac3b1b0de3412475c7a0adcb4e4ece6b`), so `edge.url`, and with it `AUTH_ORIGIN`, the passkey rp id and the World
callback, become `https://vitaquack.com`. Every push of `main` deploys through CI, so the domain commit reaches
`origin/main` only when the steps before the deploy are done.

**Before the deploy**
1. On `main` together: the app under `/app` (apps/web routes and assets), the server's page links (`approvalPagePath`),
   the landing copy and the edge's `/` and `/media`, the Edge `domain`, and Telegram's links (`telegram/Render.ts`).
2. Delete Namecheap's parking `A vitaquack.com → 162.255.119.71` right before the push. Beta.84 attaches a custom
   domain with `PUT /accounts/:id/workers/domains` and never sends `override_existing_dns_record`; Cloudflare refuses
   a custom domain on a hostname that still has a DNS record, and the deploy fails after the Edge script is already
   uploaded. The MX forwarding records stay. The `www` CNAME stays too: there is no www redirect tonight (below).
3. Dry-run (`Deploy by hand`) and read the plan: `update` of Edge (domain, assets), Api (`AUTH_ORIGIN`) and Website;
   no `create`, `replace` or `delete`.

**After the deploy**
1. Cloudflare creates the apex's DNS record and certificate; the first HTTPS requests can fail until the certificate
   is issued (minutes). Then check:
   `curl -s https://vitaquack.com/api/health` (its `release` is the commit), `curl -sI https://vitaquack.com/` (200,
   the landing), `curl -sI -H 'Range: bytes=0-1' https://vitaquack.com/media/f2.mp4` (206, `content-range: bytes
   0-1/…`), `curl -sI https://vitaquack.com/app/` (200), and that `https://vitaquack.com/plan/` is still the scratch
   site (a zone route takes precedence over a custom domain) and `https://cafe.vitaquack.com/` the till.
2. Passkeys belong to the rp id `vitaquack.com`: passkeys made on the workers.dev origin stop working there, and
   same-origin POSTs from it get 403. The owner registers again, which makes a new smart account: fund it.
3. Add `https://vitaquack.com/api/world/callback` as a redirect URI in the World Developer Portal (Kris).
4. Telegram: rerun `telegram-set-webhook.ts` (webhook → `https://vitaquack.com/api/telegram/webhook`).
5. The till's `APP_ORIGIN` (`apps/merchant/alchemy.run.ts`) → `https://vitaquack.com`, then redeploy the till.
6. Chips pair again with `--server https://vitaquack.com`: a pairing records its server's origin and the chip refuses
   any invoice outside it (`bad_invoice_origin`).
7. Browser acceptance against the new origin: `APP_PREVIEW_URL=https://vitaquack.com heavy --wait bun test
   tools/preview.native.test.ts`.

**www.vitaquack.com.** Alchemy's `domain.redirects` attaches the host and 301s it in the zone's
`http_request_dynamic_redirect` ruleset. The deploy token can list the zone's rulesets and its Workers custom domains,
but answers "request is not authorized" on that phase, so `redirects` would fail the deploy after attaching the apex.
After the event: give the token zone Single Redirect (dynamic redirect) edit on `vitaquack.com`, delete the parking
`www` CNAME, and add `redirects: ['www.vitaquack.com']` to the Edge's `domain`.

**Rollback.** Removing the `domain` prop does not detach anything: Alchemy leaves custom domains unmanaged and keeps
`edge.url` at the apex. Set `domain: null` on stage `main` to detach it, which also returns `AUTH_ORIGIN` to the
workers.dev URL.

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
`APP_SCANS_ENABLED`, `APP_VOICE_ENABLED`, `APP_LIVE_ENABLED`). A feature binding left unset defaults to `pending`, and then only its routes answer 503 "not
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
APP_PREVIEW_URL=https://vitaquack.com heavy --wait bun test tools/preview.native.test.ts
```

The scratch site and the till have their own deploy scripts. Dry-run first, from the stack's directory, and read the
plan: an `update` of the existing Workers, no `create` of a second one.

```sh
export CLOUDFLARE_ACCOUNT_ID=bceaeae4788dce3493514fde194b4a7e
(cd docs/site && bunx alchemy deploy alchemy.run.ts --stage prod --dry-run --no-input)
(cd apps/merchant && bunx alchemy deploy alchemy.run.ts --stage prod --dry-run --no-input)
bun run --cwd docs/site deploy && bun run --cwd apps/merchant deploy
```
