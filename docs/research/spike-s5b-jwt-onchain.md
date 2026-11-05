# Spike S5b: verify a World IdP (Agent Pass) ID token on Arc

Date: 2026-11-05. Scope: plan v3.1 §2.5 ("the approval is verified on Arc itself").
Code: `spikes/s5b-jwt-verifier.sol.txt` (contract, Arc probe, tests, fixture generator, scripts).
Scratch project: `~/code/eth-global-mumbai-2026-spikes/s5b-jwt` (outside the repo).

**Answer: yes.** A contract on Arc can verify the RS256 token, parse the claims, bind the token to one
payment and consume it, for about **409k gas per payment (≈ 0.0082 USDC at the 20 gwei floor)**. The same code and
the same RSA token were run on **live Arc mainnet** with an `eth_call` (nothing broadcast). The modexp precompile
there gives the same result and charges the same gas as Osaka.

Two findings change the plan:

1. **`amr` contains `pop` for passkey sign-ins too.** World documents `["pop","user","mfa"]` as a passkey assertion
   "which does not assert a fresh World proof". Checking "`amr` contains `pop`" is not enough. The enforcer must also
   **reject `mfa`**, or allowlist the exact sets `["pop"]` and `["pop","face","user"]`. The prototype rejects `mfa`.
2. **The raw token becomes public calldata.** It holds `sub`, a stable per-sector pseudonym, and for inbox-enabled
   accounts `email` = `<sub>@<domain>`. Every approval by the same owner can be linked on-chain. World's guide says
   "Keep the ID token and subject in your backend". Kris should decide whether that is acceptable for the demo.

## 1. JWKS and discovery (fetched live 2026-11-05 21:28 UTC)

| | Production `auth.world.org` | Sandbox `sandbox.auth.world.org` |
|---|---|---|
| Keys in JWKS | **1** | **1** |
| `kid` | `xDQ0qjmm6_Jlrx61ER2YuxNLQmXgmC7eDQITsMMuDGM` | `SjxoYTY6TKyO9wDOz9VmG4ze3tJsvwsPE5zgkOqqwAo` |
| `kty` / `alg` / `use` | RSA / RS256 / sig | RSA / RS256 / sig |
| Modulus | 256 bytes (RSA-2048) | 256 bytes (RSA-2048), a different key |
| Exponent | `AQAB` (65537) | `AQAB` (65537) |
| `kid` scheme | **RFC 7638 JWK thumbprint** (`b64url(sha256('{"e":"AQAB","kty":"RSA","n":"…"}'))`). Checked with openssl, and on-chain in `test_worldLiveKeyThumbprintMatchesKid` | same scheme (assumed, not checked) |
| JWKS caching | `cache-control: public, max-age=300` | same |

- **Discovery (production):** `id_token_signing_alg_values_supported: [RS256]`, `response_types_supported: [code]`,
  `subject_types_supported: [pairwise]`, `claims_supported: iss sub aud exp iat jti nonce auth_time acr amr`,
  `acr_values_supported: …/orb, …/orb-face`, `prompt_values_supported: none login consent`, PKCE `S256`.
- **Rotation:** only one key is published today, so there is no rotation overlap to observe. World documents no
  rotation schedule. A 5-minute JWKS cache suggests rotation could happen with little notice.
- **Token lifetime:** World's id-token guide example has `exp - iat = 300 s`. The illustrative claim order is
  `iss, sub, aud, exp, iat, jti, auth_time, acr, amr, nonce`. Inbox-enabled accounts also get `email` and
  `email_verified: true`.

## 2. Design (`HumanApprovalVerifier.sol`)

`verifyAndConsume(bytes jwt, bytes32 nonce, string sub, string aud)`. `verify(...)` is the same check as a view,
without consuming anything.

1. **Split.** Find the first two `.` with a 32-bytes-per-step SWAR scan. A third `.` cannot slip through because
   `.` is outside the base64 alphabet, so `Base64.decode` reverts on it.
2. **Header.** Base64url-decode it. Require `alg == "RS256"`, reject any `crit`, then look up the modulus by `kid`.
   Unknown or revoked kid → `UnknownKid`.
3. **Signature.** Compute `sha256(header.payload)` over the raw ASCII. Base64url-decode the signature and check it
   with OZ `RSA.pkcs1Sha256(digest, s, 0x010001, n)`. OZ enforces at least 2048 bits, `s < n`, and strict PKCS#1
   v1.5 padding.
4. **Payload.** Base64url-decode it, then run one minimal JSON scan of the top-level object (see §3).
5. **Checks:**
   - `iss` == the configured issuer.
   - `sub` == the expected owner and `aud` == the expected client id.
   - `nonce` == `toHexString(nonce)`: `0x` plus 64 lowercase hex digits, the EIP-712 invoice hash.
   - `acr` is in the allowlist (`orb`, `orb-face`).
   - `amr` is an array that contains `"pop"` and not `"mfa"`.
   - `exp > now`, `iat` and `auth_time` are not more than 60 s in the future, and `auth_time + maxAuthAge >= now`
     (the tests use 300 s).
6. **Consume.** Mark `jtiUsed[keccak(jti)]` and `nonceUsed[nonce]` as used, then emit `ApprovalConsumed`. Both are
   one-shot. A jti can't be replayed with another nonce, and a nonce can't be replayed with another token.
7. **Keys.**
   - `registerKey(n)` (admin only) **derives the kid itself** as the RFC 7638 thumbprint, the way World names its
     keys. The admin can't mislabel a key, but still decides *which* key to trust.
   - `e` is fixed at 65537.
   - `revokeKey(kid)` and `setAcr(acr, bool)` are also admin only.

## 3. Parsing assumptions and attack surface

The scanner is a fail-closed **top-level tokenizer**, not a substring search:

| Rule | Why |
|---|---|
| Only keys of the single top-level object count. Nested objects and arrays are skipped with string- and escape-aware depth tracking | A `"nonce":"…"` inside a nested object or inside a string value is never matched (decoy tests) |
| Strings are skipped with `\` escape handling. Inside a JSON string every `"` is `\"`, so `"key":` can't appear there | The decoy-in-string test |
| A top-level **key containing a backslash** reverts | `"nonce"` would otherwise alias `nonce` in a real JSON parser |
| A claim we read must appear **at most once**, otherwise `DuplicateClaim` | Parsers disagree on duplicates (JS takes the last one) |
| String claims we read must have **no escapes** (`EscapedClaim`). No unescaping is done | Fail closed. For example, `https:\/\/auth.world.org` is valid JSON but is rejected |
| Numbers must be bare digits, at most 15 (no `-`, `.`, `e`) | `exp: -1` and `exp: 1.5` are rejected |
| `aud` must be a string; an array reverts | World issues a string. A multi-audience array would need more code |
| `amr` must be an array of strings | `amr: "pop"` is rejected |
| Nothing but whitespace after the closing `}` | Trailing garbage reverts |
| **Not checked:** bracket *type* matching inside skipped containers, raw control characters inside strings, and UTF-8 validity | These only matter if the *signer* emits invalid JSON. The signature covers the exact bytes, so an attacker can't introduce them |

**Residual risk:**

- The parser assumes World's JSON encoder escapes `"` and `\` correctly. An attacker who runs the flow with our
  `client_id` controls only the `nonce` string, and their own `sub` fails the `sub` check.
- Base64 decoding (OZ) is lenient: it accepts both alphabets, with or without padding. That is harmless here
  because the signature covers the *encoded* text, and replays are keyed by jti and nonce, not by the token bytes.
- `verifyAndConsume` is open to anyone. A front-runner who sees the token can consume it first, which blocks the
  payment but steals nothing. In the real enforcer, consumption happens inside the redemption itself.

## 4. Test results (`forge test`, 43/43 pass)

Fixtures come from `gen/gen.ts`: fresh RSA-2048 keys, a World-shaped header `{"alg":"RS256","kid":<thumbprint>,
"typ":"JWT"}`, and World's claim set plus `email` and `email_verified`. The `VALID` token is **1054 bytes**
(payload JSON 453 bytes).

| Case | Expected | Result |
|---|---|---|
| Valid token; claims reordered and pretty-printed; header reordered; face amr `["pop","face","user"]` with acr `orb-face`; `\u` and `\"` escapes in an ignored claim | pass | ✅ |
| World's live production modulus → derived kid == live `kid` | equal | ✅ |
| Tampered payload (valid signature from the original) | `BadSignature` | ✅ |
| Signed with the wrong key, same kid | `BadSignature` | ✅ |
| Unknown kid; revoked kid | `UnknownKid` | ✅ |
| `alg` HS256 or `none`; `crit` header | `UnsupportedAlg` / `CritHeader` | ✅ |
| 4 segments; truncated signature | `InvalidBase64Char('.')` / `BadSignature` | ✅ |
| Wrong expected nonce, sub or aud; sandbox issuer | `BadNonce` / `BadSubject` / `BadAudience` / `BadIssuer` | ✅ |
| `aud` as an array | `WrongType(aud)` | ✅ |
| Expired (`now == exp`) | `Expired` | ✅ |
| Stale `auth_time` (1 h old, `exp` still valid: session reuse); valid token used 301 s after `auth_time` | `AuthTooOld` | ✅ |
| `iat` / `auth_time` in the future | `IssuedInFuture` | ✅ |
| Same token twice; same jti with another nonce | `JtiUsed` | ✅ |
| Same nonce with another jti | `NonceUsed` | ✅ |
| amr `["pop","user","mfa"]` (passkey only) | `PasskeyOnly` | ✅ |
| amr `["user"]`; amr `"pop"` as a string | `NoProofOfPersonhood` / `WrongType` | ✅ |
| acr `selfie` | `BadAcr` | ✅ |
| **Decoy in a string value** (`note: 'x","nonce":"<victim>","sub":"<victim>"'`, plus a decoy `email`) | victim nonce → `BadNonce`, victim sub → `BadSubject`, real claims → pass | ✅ |
| **Decoy in a nested object or array** (`ext:{nonce,sub,arr:[{nonce}]}` placed before the real claims) | same | ✅ |
| Duplicate top-level `nonce` | `DuplicateClaim` | ✅ |
| Escaped key `"nonce"` | `EscapedKey` | ✅ |
| Escape inside `sub` | `EscapedClaim(sub)` | ✅ |
| Trailing garbage after `}`; missing `nonce`; `exp: -1`; `exp: 1.5` | `MalformedJson` / `MissingClaim` / `WrongType` | ✅ |
| Non-admin `registerKey` | `NotAdmin` | ✅ |

## 5. Gas and cost (Osaka, solc 0.8.35, optimizer 200 runs)

| Measurement | Gas | USDC at 20 gwei |
|---|---|---|
| **Full tx `verifyAndConsume`** on local anvil (Osaka), 1060-byte token. Receipt `gasUsed`, including 21k intrinsic, calldata and 2 fresh SSTOREs | **408,577** | **0.0082** |
| Execution only, `verify` (view, cold storage) in forge | 326,293 | 0.0065 |
| Same verifier on **live Arc** via `eth_call` CREATE (key storage warm, same tx) | verify 301,780 / consume 348,861 | identical to anvil Osaka |
| `registerKey` (one-off, per key or rotation) | 253,186 | 0.0051 |
| Deployment | ≈ 12.7 KB runtime | ~0.06 (est.) |

**Where the gas goes** (one `verify`, from `test/Profile.t.sol`):

| Step | Gas |
|---|---|
| Split | 9.4k |
| Base64 decode: header / payload / signature | 10.4k / 53.4k / 30.7k |
| sha256 | 1.0k |
| `RSA.pkcs1Sha256` | 56.0k, of which 33.3k is modexp |
| JSON scan: payload / header | 85.2k / 18.9k |
| Claim checks, `toHexString` and `keccak` | rest |
| Consume | 2 × 22.1k SSTORE + event |

**Modexp pricing differs by fork:**

- Measured inside the probe, modexp costs **33,340 gas on Osaka** (EIP-7883: 32,768 plus ~570 call overhead) and
  **6,033 on Prague** (EIP-2565: 5,461 plus overhead).
- **Arc mainnet charged exactly 33,340** and returned the same output hash. The Arc probe reported chain id 5042.
- On Prague the whole verifier costs ~27k less (274k vs 302k).
- The plan's "≈ 33k for RSA" holds for the precompile alone (the OZ wrapper adds ~23k). Base64, JSON scan and
  claim checks together cost ~210–270k, the upper half of the plan's 100–300k estimate.

**Headroom, not done:**

- Replacing the Solidity-level scanner and the OZ base64 with one hand-written assembly pass would probably bring
  `verify` to ~200k (estimate).
- Passing dot offsets as hints saves ~9k.
- Not worth doing for the hackathon, since cost is already < 1 cent.

**Not measured:** the surrounding payment (DelegationManager `redeemDelegations`, the other caveats and the ERC-20
transfer). Expect roughly +100–200k, so ≈ 0.011–0.012 USDC for an over-limit payment.

## 6. What remains

- **A real World token with our nonce (needs S5 and Kris's phone).** We need to confirm:
  - The exact header (is `typ` present? any extra fields?).
  - The real claim order and encoding: escaped `/` in `iss` would trip `EscapedClaim`, and so would any escapes in
    `sub`.
  - The real `sub`, `aud` and `jti` formats and the token length.
  - That a 66-character `0x…` nonce is accepted and echoed unchanged.
  - The `amr` and `acr` values (`orb` vs `orb-v3`, see world.md).
  - Then feed that token into `verify` in a fork test, with `vm.warp` to its `iat`.
- **Key rotation:**
  - Today a token signed by a new key fails closed with `UnknownKid`, which is a liveness risk, not a safety risk.
  - Options: a keeper that polls the JWKS (5-minute cache) and calls `registerKey`; a short-delay multisig admin;
    or pre-registering the next key once World publishes overlap keys.
  - Ask World at the booth whether rotation is scheduled during the event.
- **Enforcer integration:** wrap this as the `HumanApprovalEnforcer` caveat (`beforeHook`). Take the token from
  `args`, compute the nonce from the execution calldata (`{invoiceHash, amount, payee, expiry}`), and read `sub` and
  `aud` from `terms`. Consumption then happens inside redemption only, which closes the front-running grief.
- **Privacy decision:** `sub` and `email` become public on Arc (see the top of this note).

## 7. Known / Uncertain / Unknown

| | Item |
|---|---|
| **Known** | World JWKS: one RSA-2048 key, e=65537, RS256, kid = RFC 7638 thumbprint (verified on-chain against the live key). Sandbox has a different single key |
| **Known** | OZ v5.7.0 `RSA.pkcs1Sha256` verifies RS256 JWTs. The full verify-and-consume tx is 408,577 gas ≈ **0.0082 USDC** at 20 gwei, for a 1.06 KB token |
| **Known** | Arc mainnet modexp: same output as anvil Osaka and same gas (33,340 with overhead), i.e. EIP-7883 pricing. The whole verifier ran unchanged via `eth_call` on chain 5042 |
| **Known** | `amr` from a passkey is `["pop","user","mfa"]`, so the check must reject `mfa` (the plan said "contains pop") |
| **Known** | The parser resists decoys in string values and nested objects, duplicate keys and escaped-key aliasing (tests) |
| **Uncertain** | The real World header and claim encoding. Fixtures follow World's docs, but no real token has been decoded yet. The parser fails closed on surprises (escaped `iss`, `aud` array) rather than accepting them |
| **Uncertain** | Whether World accepts and echoes a 66-character hex `nonce` unchanged (OIDC allows it; World's limits are undocumented) |
| **Uncertain** | Overhead of the whole payment around the enforcer (+100–200k estimated) |
| **Uncertain** | Whether publishing `sub` and `email` on-chain is acceptable (World's guidance says keep them in the backend) |
| **Unknown** | World's key-rotation schedule and whether it publishes overlapping keys |
| **Unknown** | Whether production `acr` is `…/orb` (discovery) or `…/orb-v3` (the human-in-the-loop reference). Only the allowlist would need to change |
