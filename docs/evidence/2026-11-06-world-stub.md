# World approval rehearsal with the in-Worker stub issuer, 2026-11-06

Rehearsal only. The submission uses auth.world.org, and the live World run that replaced this stub is
`2026-11-06-live-world.md`. At the time of writing, Kris's production World client was pending (the portal reported
his Google account not eligible for self-service). Until it exists, `packages/server/src/world/Stub.ts` stands in for
World IdP so the over-cap / restricted path runs end to end: approval → our backend co-signs → the chip signs the
voucher with the approval → settlement through our `RobotPaymentPolicyEnforcer` on Arc.

## What the stub is

| | |
| --- | --- |
| Routes | `GET /api/dev/world/.well-known/openid-configuration`, `GET /api/dev/world/authorize` (a page that says "STUB IdP — not World — rehearsal only", shows state and nonce, Approve / Deny), `POST /api/dev/world/token` (`client_secret_basic` `stub:stub`, single-use code in `auth_challenges` kind `world_stub`), `GET /api/dev/world/jwks` |
| Mounted when | `WORLD_STUB_JWK` holds the private RSA JWK and `WORLD_ISSUER` equals `${AUTH_ORIGIN}/api/dev/world`; otherwise the prefix answers 404 |
| ID token | RS256, `iss` = the stub issuer, `aud` = `stub`, `sub` = `stub-owner-1`, the approval's nonce echoed, `auth_time` = now, `acr` = `https://world.org/oidc/acr/orb`, `amr` = `["pop"]`, a fresh `jti`, `exp` +300 s; `kid` = the RFC 7638 thumbprint derived from the key at runtime |
| Same checks as World | the callback verifies the stub's token with the unchanged `verifyIdToken` (signature, iss, aud, exp, nonce, auth_time, acr, amr, jti once); the only difference is that the stub never binds `accounts.world_sub`, so a rehearsal cannot lock a wallet to a fake World account |
| Transport | the Worker talks to its own stub in process (a Worker cannot fetch its own workers.dev host); the HTTP token endpoint is still served and tested |
| Key | GitHub secret / `.env.main.local` name `APP_WORLD_STUB_JWK` (bound as `WORLD_STUB_JWK`); a fresh key generated locally, never printed |

Switch on: `APP_WORLD_ISSUER=<app origin>/api/dev/world`, `APP_WORLD_CLIENT_ID=stub`, `APP_WORLD_CLIENT_SECRET=stub`.
Switch back to World: set those three to the real World client (`https://auth.world.org`, its id and secret).

## Native evidence

`heavy --wait bun run test:native` → 18 pass, 0 fail, including `WorldStubAcceptance.ts` ("world stub (rehearsal
only): Approve → co-signed approval → signing; Deny → denied; replay 409; token guards"), with a per-run RSA key:

1. A passkey owner, a paired robot with a grant, "cigarettes" → 0G (stub) → `awaiting_approval` with an approval page.
2. `GET /api/world/authorize?approval=…` → 302 to `/api/dev/world/authorize?…max_age=0…`; the page says "STUB IdP —
   not World — rehearsal only".
3. Approve → our callback (302 back to `/wallet/approvals/:id`) → approval `approved`, errand `signing` (the chip's
   sign request carries the co-signed approval). Replaying the same callback → 409.
4. A second errand, Deny → approval `denied` ("World answered access_denied"), errand `denied`, nothing signed.
5. Token endpoint: wrong client secret → 401; the spent code → `invalid_grant`; discovery lists
   `client_secret_basic`.

Deployed rehearsal (approval → co-sign → settle on mainnet): done in browser runs 5 to 7
(`2026-11-06-deployed-browser.md`) and e2e runs 7 to 10 (`2026-11-06-deployed-e2e.md`).
