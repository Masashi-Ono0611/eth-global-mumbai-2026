# Deployed merchant, x402 and gate (M3), 2026-11-06 06:22 IST

| | |
| --- | --- |
| Release | `b342dc2345d412491c0a93f534838fead0bfb025` (`GET /api/health`) |
| App | <https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev> (`$APP` below) |
| Relayer (facilitator) | `0x404b09F43db64fB08f70b0b3e2b785bC312D6fDb` |
| Merchant payee | `0x2845D56f584c5f38d1f0f4B3C1A0A28cf55397F5` |
| Gate key (Ed25519, public) | `N4D/99OCV7Wq1sEsgkmHFDJOkuzehmY/nGW831/3Hjw=` |

No chip and no robot were involved, and nothing was broadcast: the relayer's pending nonce on Arc stayed at 5 before
and after the run (`eth_getTransactionCount(relayer, "pending")` on `https://rpc.mainnet.arc.io`). The requests were
sent from a Bun script (plain `fetch` + WebCrypto); each step below shows its equivalent `curl` and what it returned.
Signatures are summarised, not pasted.

## API

| Step | Request | Result |
| --- | --- | --- |
| health | `curl $APP/api/health` | 200, `release` = `b342dc2…` |
| catalogue | `curl $APP/api/merchants/duck-cafe/items` | 200: chai `100000`, samosa `250000`, cigarettes `500000` `restricted:true`; `payTo` = the merchant payee only (the restricted payee does not appear) |
| invoice | `curl -X POST $APP/api/merchants/duck-cafe/invoices -d '{"itemId":"chai"}'` | 201: `id` `hii53ccex7ybkvbtmd3lnoo6n4`, `url` `$APP/api/i/hii53ccex7ybkvbtmd3lnoo6n4`, `amount` `100000`, `expiresAt` `1793926932` (+600 s), `invoiceHash` `0xe45948e106a2d283f82c3493681c7d30a3ec318795ab8d894db2075a870e3cfa`, `restricted:false` |
| x402 | `curl -i $APP/api/i/hii53ccex7ybkvbtmd3lnoo6n4` | 402; `PAYMENT-REQUIRED` base64-decodes to exactly the body; `accepts[0]` = `exact` / `eip155:5042` / USDC `0x3600…0000` / `payTo` merchant / `amount` `100000` / `maxTimeoutSeconds` 120 / `extra` `{assetTransferMethod:"erc7710", invoiceHash, invoiceId, expiresAt, delegationManager:"0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3", facilitators:["0x404b09F43db64fB08f70b0b3e2b785bC312D6fDb"], paymentIdentifier}` |
| header payment | `curl -H 'PAYMENT-SIGNATURE: x' $APP/api/i/<id>` | 415 `{"error":"use POST /api/invoices/:id/pay"}` |
| garbage payment | `curl -X POST $APP/api/invoices/<id>/pay -d '{"paymentPayload":{"x402Version":2,"accepted":<accepts[0]>,"payload":{"delegationManager":"0xdb9B…7dB3","permissionContext":"0x00","delegator":"0x…c0de"}}}'` | 400 `{"success":false,"errorReason":"context is leaf → grant","checks":[scheme/network/method ✓, asset is Arc USDC ✓, accepted == requirements ✓, delegationManager allowlisted ✓, context is leaf → grant ✗ "0 delegations"]}`; relayer nonce still 5 |
| gate key | `curl $APP/api/merchants/duck-cafe/gate-key` | 200 `{"alg":"ed25519","publicKey":"N4D/…Hjw="}` |
| gate status | `curl "$APP/api/invoices/<id>/status?nonce=evidence1793926337083"` | 200 `{"invoiceId":"hii53ccex7ybkvbtmd3lnoo6n4","status":"pending","nonce":"evidence1793926337083","expiresAt":1793926932,"sig":<64-byte Ed25519, base64>}`; WebCrypto `verify(Ed25519, gateKey, sig, "hii53…|pending|evidence1793926337083|1793926932")` = true; the same signature over `…|paid|…` = false |
| bad nonce | `curl "$APP/api/invoices/<id>/status?nonce=a|b"` | 400 `{"error":"nonce must be 1-32 characters of [A-Za-z0-9_-]"}` |

## Virtual gate page (Playwright, headless Chromium)

`/gate/duck-cafe` → 200. After ~8 s on the page: the light reads CLOSED, the page shows its own fresh invoice
(`nuiqyp2rtfc2f4xsvftqggbz7y`), its payment URL `$APP/api/i/nuiqyp2rtfc2f4xsvftqggbz7y`, price 0.10 USDC and "Waiting
for payment…"; no alert (every status signature verified in the browser). It made 6 status reads in 8 s, all for that
invoice, all HTTP 200, 6 distinct nonces. The only failed request on the page is the shell's
`GET /api/auth/session` → 401 (signed-out visitor; expected).

## Not covered here

Paying the invoice (the chip leaf + settle, then the gate's `paid` → OPEN and `used` on the next read) needs a paired
chip and a grant: that is the Lead's end-to-end run, which covered it from run 4 on (`2026-11-06-deployed-e2e.md`).
