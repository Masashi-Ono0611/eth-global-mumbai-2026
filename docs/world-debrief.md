# World Agent Pass: integration debrief

Ready to paste into the World prize form. The Wallet lane, which built the integration
(`packages/server/src/world/`, `apps/web/src/pages/Approval.ts`), wrote it on Fri 6 Nov 2026.

## What we built

A robot with a USDC budget on Arc buys something over its per-payment limit. In the final demo that is a 2.00 thali
against a 1.00 limit; the live approval below was a 0.50 restricted item from the earlier cigarettes catalogue.
Over-limit purchases need the owner's fresh World approval, and the daily cap can't be lifted. Our on-chain enforcer
(`RobotPaymentPolicyEnforcer`, Arc mainnet `0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3`) refuses that payment unless it
carries an approval signed by our approver key. The approver signs only after the owner passes a fresh World ID
authentication through World IdP (Agent Pass):

1. The errand creates an approval row whose `nonce` is the EIP-712 digest of {invoice hash, payee, amount, expiry}.
2. Approve with World sends the owner to World IdP (`/api/v1/authorize`, from discovery) with `response_type=code`,
   `scope=openid`, a random `state`, that digest as the OIDC `nonce`, `max_age=0`, `prompt=login` and an `S256` PKCE
   challenge (a fresh verifier per attempt).
3. The callback exchanges the code (`client_secret_basic` + `code_verifier`) and verifies the RS256 ID token against
   World's JWKS: `iss`, `aud`, `exp`, `nonce` equal to the digest, `auth_time` not older than the approval, `acr` Orb or
   Orb + face, `jti` used once, and `sub` equal to the World account bound to this wallet on its first approval. `amr`
   is recorded on the approval with `acr` but not judged (friction 1).
4. Only then does the approver sign that one payment. The robot's chip signs its voucher with the approval attached,
   and Arc settles it. A denial in World App (`error=access_denied`), an expired window (300 s) or any failed check ends
   the errand `denied` or `expired`, and nothing is signed.

Proven so far:

- The verifier against our own RS256 tokens (`packages/server/test/World.test.ts`), the approval page and the deny path
  in scene tests, and PKCE and the routes' guards on the native Worker.
- The whole approve/deny path on the deployed app through our in-Worker rehearsal issuer
  (`docs/evidence/2026-11-06-deployed-browser.md`, runs 5 to 7). That issuer proves no human.
- 6 Nov, with the real client: authorize → World App → callback → token exchange worked on the first try once PKCE was
  in. Our verifier then refused the token (`mfa`, friction 1), fixed in 95a92bd.
- Live approval with a real Orb ID, 6 Nov 14:55 IST: Kris (his own passkey wallet on a MacBook, World App on his phone)
  approved a 0.50 USDC restricted payment. The token was accepted, the approver co-signed, and Arc settled the payment
  with our enforcer's `PaymentApproved`
  ([0xae55688e…ffa9](https://explorer.arc.io/tx/0xae55688e158c399fb763b517fad4d1c690d2fdb54cd0ae74f85b88d8c604ffa9);
  `docs/evidence/2026-11-06-live-world.md`).
- The live deny: _fill in_.

## Time to first success

- Discovery and JWKS of `https://auth.world.org` answered on the first request, with no account needed.
- The first verified token in our tests came under an hour after reading the discovery document.
- The first live approval with an Orb-verified World ID came the same afternoon the client was registered (first
  approved payment on Arc at 14:55 IST), after two fixes on our side: PKCE (friction 2) and the `amr` rule (friction 1).
  The World round trip itself (authorize → World App → callback → token) worked on its first real try.

## Friction

1. `amr` semantics are undocumented, and the obvious reading is wrong. Our rule, taken from research and examples,
   was "`amr` contains `pop` and not `mfa`" (a passkey sign-in was said to carry `["pop","user","mfa"]`). World's real
   token for an Orb-verified account signing in with World App carried `mfa` too, so the rule refused a real human on
   the first live try ("World token rejected: mfa"). We now judge only `acr` (Orb / Orb + face) with a fresh
   `auth_time` (forced by `max_age=0` + `prompt=login`) and record `amr`. The token carried `acr`
   `https://world.org/oidc/acr/orb` and `amr` `["pop","user","mfa"]` (from the approval row's `amr_json`), the same
   `amr` our research attributed to a passkey-only sign-in, so `amr` cannot tell them apart. A documented table of `amr`
   values per sign-in method, and one claim that means "fresh Orb proof now", would have saved the round trip.
2. PKCE is mandatory, also for confidential clients. The token endpoint answers `400 invalid_request "code_verifier
   must appear exactly once and be nonempty."` without it, although the client authenticates with
   `client_secret_basic`. Discovery lists `code_challenge_methods_supported: ["S256"]`, and the step-up guide mentions
   it in passing ("S256 PKCE as normal browser sign-in"). The token endpoint docs should say it.
3. Endpoints are not under the issuer root. Discovery lists `/api/v1/authorize` and `/api/v1/token`, so plans and
   examples that build `${issuer}/authorize` break. We read discovery at runtime and cache it.
4. There is no transaction binding. The ID token says "this World account authenticated now", and nothing in it says
   "approve 0.50 USDC to 0x… for invoice X". We overload the OIDC `nonce` with an EIP-712 digest of the payment. It
   works, but every integrator has to invent it, and the binding is only as strong as each app's nonce discipline.
5. `sub` is pairwise. The subject is per client, so a wallet must bind the World account on its first approval and
   compare it on every later one. Apps cannot ask whether this is the same human as last time.
6. Key rotation is implicit. The JWKS has one key, `max-age=300`, and no published rotation schedule. A cache longer
   than five minutes needs a refresh-on-unknown-`kid` path (we have one).
7. Verifying on-chain is heavy. Our S5b spike verified a World RS256 token on Arc for ≈ 409k gas (≈ $0.008), but
   publishing the token makes approvals linkable. We chose the backend co-signer for the event and kept the on-chain
   verifier as a stretch.

## One improvement

Echo a signed action in the ID token: support OAuth Rich Authorization Requests (`authorization_details`) for a human
checkpoint, e.g. `{"type":"payment","amount":"0.50","asset":"USDC","payee":"0x…","reference":"<invoice hash>"}`,
returned verbatim in the token, plus one documented claim that means "fresh Orb proof now". Relying parties could then
verify that this human approved exactly this payment without inventing nonce schemes, and an on-chain verifier could
check it directly.
