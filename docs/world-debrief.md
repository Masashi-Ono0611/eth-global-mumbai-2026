# World Agent Pass: integration debrief

Ready to paste into the World prize form. Written by the Wallet lane, which built the integration
(`packages/server/src/world/`, `apps/web/src/pages/Approval.ts`) on Fri 6 Nov 2026.

## What we built

A robot with a USDC budget on Arc buys a restricted item (a mock cigarette pack) or something over its per-payment cap.
Our on-chain enforcer (`RobotPaymentPolicyEnforcer`, Arc mainnet `0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3`) refuses
that payment unless it carries an approval signed by our approver key. The approver signs only after the owner passes
a **fresh World ID authentication** through World IdP (Agent Pass):

1. The errand creates an approval row whose `nonce` is the EIP-712 digest of {invoice hash, payee, amount, expiry}.
2. **Approve with World** sends the owner to World IdP (`/api/v1/authorize`, from discovery) with `response_type=code`,
   `scope=openid`, a random `state`, that digest as the OIDC `nonce`, `max_age=0` and `prompt=login`.
3. The callback exchanges the code (`client_secret_basic`) and verifies the RS256 ID token against World's JWKS:
   `iss`, `aud`, `exp`, `nonce` equal to the digest, `auth_time` not older than the approval, `acr` Orb or Orb + face,
   `amr` containing `pop` and **not** `mfa`, `jti` used once, and `sub` equal to the World account bound to this
   wallet on its first approval.
4. Only then does the approver sign that one payment; the robot's chip signs its voucher with the approval attached and
   Arc settles it. A denial in World App (`error=access_denied`), an expired window (300 s) or any failed check ends the
   errand `denied`/`expired`, and nothing is ever signed.

Proven so far: the verifier against our own RS256 tokens (10 cases including the `mfa` rejection,
`packages/server/test/World.test.ts`), the approval page and deny path in scene tests, the routes' guards on the native
Worker. **Live with a real Orb ID: _fill in after the demo run_.**

## Time to first success

- Discovery and JWKS of `https://auth.world.org`: answered on the first request, no account needed.
- First verified token in our tests: under an hour from reading the discovery document.
- First live approval with an Orb-verified World ID: _fill in (time from client registration to the first approved
  payment on Arc)_.

## Friction

1. **Endpoints are not under the issuer root.** Discovery lists `/api/v1/authorize` and `/api/v1/token`; plans and
   examples that build `${issuer}/authorize` break. We read discovery at runtime and cache it.
2. **`amr` contains `pop` for passkey sign-ins too.** A World sign-in with a passkey carries `["pop","user","mfa"]` and
   proves no fresh human presence, so "contains `pop`" is not the check; you must also reject `mfa`. This is visible
   only in examples, and it is the easiest mistake to ship.
3. **No transaction binding.** The ID token says "this World account authenticated now"; it does not say "approve
   0.50 USDC to 0x… for invoice X". We overload the OIDC `nonce` with an EIP-712 digest of the payment. It works, but
   every integrator has to invent it, and the binding is only as strong as each app's nonce discipline.
4. **Pairwise `sub`.** The subject is per client, so a wallet must bind the World account on its first approval and
   compare it on every later one; there is no way to ask "is this the same human as last time" across apps.
5. **Key rotation is implicit.** The JWKS has one key, `max-age=300`, and no published rotation schedule. A cache longer
   than five minutes needs a refresh-on-unknown-`kid` path (we have one).
6. **Verifying on-chain is heavy.** Our S5b spike verified a World RS256 token on Arc for ≈ 409k gas (≈ $0.008), but publishing
   the token makes approvals linkable; we chose the backend co-signer for the event and kept the on-chain verifier as a
   stretch.

## One improvement

Echo a **signed action** in the ID token: support OAuth Rich Authorization Requests (`authorization_details`) for a
human checkpoint, e.g. `{"type":"payment","amount":"0.50","asset":"USDC","payee":"0x…","reference":"<invoice hash>"}`,
returned verbatim in the token, plus one documented claim that means "fresh Orb proof now". Relying parties could then
verify "this human approved exactly this payment" without inventing nonce schemes, and an on-chain verifier could check
it directly.
