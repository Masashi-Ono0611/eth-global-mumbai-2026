# Hardware handoff: ESP32 gate, Radxa chip, bench network

For the MacBook agent and the teammates building the physical duck. The Worker does not change for hardware (spec §8):
the ESP32 is a client of the merchant API, the Radxa runs the same chip client as the laptop mock chip. No secrets
here: the only key a device holds is the chip's own, generated on the Radxa.

**Deployed app** (`$APP`): <https://vitaquack.com> from the cutover on 6 Nov (before it, and in the recorded runs
below, <https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev>; `curl $APP/api/health`). A chip
paired with the old origin must pair again with `--server https://vitaquack.com`. Every example below is from the deployed run recorded in
`docs/evidence/2026-11-06-deployed-merchant.md`, unless it says "shape".

## 1. ESP32 gate

Loop: fetch the gate key once → mint an invoice → draw its `url` as a QR → read the signed status every second with a
fresh random nonce → verify → show PAID / open on the first verified `paid` → mint the next invoice. With the café
till driving the screen, the ESP32 pulls the invoice to show instead of minting (§6); the status checks stay the same.

| Call | Example |
| --- | --- |
| `GET $APP/api/merchants/duck-cafe/gate-key` | `{"alg":"ed25519","publicKey":"N4D/99OCV7Wq1sEsgkmHFDJOkuzehmY/nGW831/3Hjw="}` (32 raw bytes, base64; may be hard-coded) |
| `POST $APP/api/merchants/duck-cafe/invoices` with `{"itemId":"chai"}` (JSON, no auth, no Origin needed) | 201 `{"id":"hii53ccex7ybkvbtmd3lnoo6n4","url":"$APP/api/i/hii53ccex7ybkvbtmd3lnoo6n4","merchantId":"duck-cafe","payTo":"0x2845D56f584c5f38d1f0f4B3C1A0A28cf55397F5","asset":"0x3600000000000000000000000000000000000000","amount":"100000","expiresAt":1793926932,"linesHash":"0x4155…84ef","rulesHash":"0x5186…3d70","invoiceHash":"0xe459…3cfa","restricted":false}` (amount in USDC base units: 100000 = 0.10; payable for 600 s) |
| `GET $APP/api/invoices/<id>/status?nonce=<nonce>` | 200 `{"invoiceId":"hii53ccex7ybkvbtmd3lnoo6n4","status":"pending","nonce":"evidence1793926337083","expiresAt":1793926932,"sig":"<base64, 64 bytes>"}` |

- **Signed message:** the UTF-8 bytes of `<invoiceId>|<status>|<nonce>|<expiresAt>`, with `expiresAt` in decimal
  unix seconds, e.g. `hii53ccex7ybkvbtmd3lnoo6n4|pending|evidence1793926337083|1793926932`. `status` is one of
  `pending`, `paid`, `used`, `expired`. The nonce must be 1 to 32 characters of `[A-Za-z0-9_-]` (anything else is 400).
- **Verify with Monocypher's `crypto_ed25519_check(sig, public_key, message, message_size)`** from the optional
  `monocypher-ed25519.c` (SHA-512 Ed25519, what WebCrypto signs). It returns 0 when valid. Do **not** use
  `crypto_eddsa_check`: that is BLAKE2b and never verifies these signatures.
- Then check that `nonce` and `invoiceId` in the answer are the ones you sent. A recorded old answer carries an old
  nonce, so it fails.
- **The first read that sees `paid` gets `paid`; every later read gets `used`.** Act on that one read: show PAID, move
  the servo, mint the next invoice. Treat `used` and `expired` as "mint a new one".
- **Run one gate at a time.** A chai errand pays the counter's newest open chai invoice. With the web gate
  (`$APP/app/gate/duck-cafe`) and the ESP32 both open, the robot pays whichever minted last. Close the browser tab when
  the ESP32 is the gate.

**QR payload:** the invoice's `url`, byte for byte: `$APP/api/i/<id>` (with `/api/`; the H2 bench brief's
`…/i/<id>` predates the spec). The chip refuses any other form (`bad_invoice_origin`). On vitaquack.com that is **54
bytes** (`https://vitaquack.com/api/i/` + 26), which the H2 settings hold (version 4, ECC M, 62 bytes, 3 px per module). The
workers.dev origin was **107 bytes**, which they cannot. The options:

| Option | Modules | Fits the 128 px side of the ST7735? |
| --- | --- | --- |
| version 7, ECC M (122 B), 2 px per module, 4-module quiet zone | 45 | 90 + 16 = 106 px: yes |
| version 6, ECC L (134 B), 2 px, 4-module quiet zone | 41 | 82 + 16 = 98 px: yes |
| version 6 or 7 at 3 px | 41 to 45 | 147 to 159 px: no |
| vitaquack.com (54 B): version 4, ECC M, 3 px | 33 | 99 + 24 = 123 px: yes (the H2 setting) |

On vitaquack.com the 2 px question is moot; whether the duck's camera reads the 3 px version 4 code is H2, not yet run.

## 2. Radxa chip

The Radxa runs `apps/chip` unchanged: build a single arm64 binary on the Mac (`bun build --compile
--target=bun-linux-arm64 apps/chip/src/main.ts --outfile vitaquack-chip`, ≈ 110 MB, verified to build), copy it
over the hotspot, run `./vitaquack-chip --server $APP --pair <CODE>`. Flags, state files, log lines, refusal codes
and the Python fallback are in `apps/chip/README.md`.

Chip protocol (spec §8). Shapes, with values from the native tests:

1. **Pair** (the code comes from the wallet: **+ Robot** (`/app/wallet/robots`), name the robot, **Next**; 8 characters of `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, 10
   minutes, single use). The chip signs the EIP-191 `personal_sign` message
   `Vitaquack pair K7Q2M9XZ 0x<chip address lowercase> 5042` and sends
   `POST $APP/api/chips/pair {"pairingCode":"K7Q2M9XZ","address":"0x…","sig":"0x<65 bytes>"}`.
   It gets back 200 `{"robotId":"<26 chars>","chipToken":"<43 chars base64url>","serverTime":<ms>}`. Errors: 404
   unknown or expired code, 409 code already used or chip already paired, 401 the signature does not recover to
   `address`.
2. **Poll:** `GET $APP/api/chips/<robotId>/poll` with `Authorization: Bearer <chipToken>`. The Worker holds the request
   up to 25 s, or answers as soon as a request is queued, with
   `{"serverTime":<ms>,"lease":{"until":<serverTime + 35000>},"requests":[SignRequest…]}`. 401 means a bad or revoked
   token. The chip re-polls immediately.
3. **SignRequest** (shape): `{"id","kind":"sign-invoice","expiresAt","invoice":<the invoice above>,"grant":{"delegation":
   {…owner → chip, caveats ValueLte · ERC20PeriodTransfer · Timestamp [· RobotPaymentPolicyEnforcer]},"dailyCap",
   "perPaymentCap","allowlist","expiresAt"},"approval":null|{…},"leaf":{delegate 0x…0a11, delegator <chip>, authority
   <grant hash>, caveats ExactExecution · Id · Timestamp · Redeemer, salt},"chainId":5042,"delegationManager":
   "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3"}`. The chip re-derives the leaf from the invoice and signs only if it
   matches.
4. **Respond:** `POST $APP/api/chips/<robotId>/responses` with the same bearer. The body is either
   `{"requestId","ok":true,"signature":"0x<65 bytes>","leafHash":"0x…"}` or
   `{"requestId","ok":false,"refused":{"code":"payee_not_allowed","detail":"…"}}`. The Worker settles on Arc inside this
   request (up to about a minute), then answers 200 `{"accepted":true,"payment":{"status":"settled","txHash":"0x…"}}` or
   `{"status":"failed","reason":"…"}`. A second answer to the same request gets 409.
5. **Lease:** with no successful poll for 35 s the chip logs `STOP motors (lease expired)` and refuses everything
   (`no_lease`). On the next good poll it logs `lease ok`. The robot's conversation (`/app/robot/<id>`) shows it Connected while
   `now < lease_until`.

The 25 s long-poll holds through the deployed edge: two polls through `$APP` answered 200 in 24.8 s and 24.6 s
(`docs/evidence/2026-11-06-deployed-e2e.md`). **Do not point the chip at the API Worker's own origin**: invoice links
carry the public origin, so such a chip refuses every payment with `bad_invoice_origin` (Spike B,
`docs/spikes/sim-results.md`). Always pair against the public app address `$APP`.

## 3. Network (bench H4)

- The venue Wi-Fi is unusable for devices: about 3 KB/s, pings of 0.4 to 2.5 s, 8 MB downloads stalled. Do not install
  anything over it.
- The shared network is a **dedicated phone hotspot**: Pixel, 2.4 GHz, WPA2, name `duckbench`, for the Mac, the Radxa
  and the ESP32. The alternative is macOS Internet Sharing from wired Ethernet to Wi-Fi (channel 6, WPA2/WPA3 Personal,
  not WPA3-only; if the channel menu is blank, move `/Library/Preferences/SystemConfiguration/com.apple.nat.plist`
  aside and reboot). Reverse tethering into the Android hotspot does not route the hotspot's clients.
- Radxa: `nmcli dev wifi connect duckbench password <pw>`, then
  `nmcli connection modify duckbench wifi-sec.key-mgmt wpa-psk && nmcli connection up duckbench`.
- ESP32: call `WiFi.setMinSecurity(WIFI_AUTH_WPA2_PSK)` before joining, and use HTTPS to `$APP` (Cloudflare).
- The venue Wi-Fi had no client isolation, but the hotspot is the plan. Find the Radxa from the Mac with `arp -a`, then
  `ssh radxa@<ip>`.

## 4. When the Radxa arrives: try these first

1. Boot it (5 V on the "5V IN / USB_OTG" port), join `duckbench`, `ping -c3 1.1.1.1`, `curl -s $APP/api/health`.
2. On the Mac, `bun build --compile --target=bun-linux-arm64 apps/chip/src/main.ts --outfile vitaquack-chip`, then
   `scp vitaquack-chip radxa@<ip>:~/`.
3. In the wallet tap **+ Robot** (`$APP/app/wallet/robots`), name it, **Next**, and note the code. On the Radxa run
   `./vitaquack-chip --server $APP --pair <CODE>`. Expect `chip 0x… (new key)`, `paired <robotId>`, `lease ok`.
   Check `stat -c %a ~/.vitaquack-chip/key.json` → `600`.
4. When the page says the robot connected, keep the allowance presets (3.00 a day, 1.00 a purchase, Duck Café,
   1 day) and **Confirm with passkey**. In the robot's conversation that opens (`$APP/app/robot/<id>`) tap **Get me a chai**, then let the duck
   scan the gate's QR (§5). Expect `signed <invoiceId>`, then `payment settled 0x<tx>` (on <https://explorer.arc.io>).
5. Network cut: switch the hotspot off. Within 35 s expect `STOP motors (lease expired)`; switch it on, expect
   `lease ok`. Restart the process. It must not pair again (`pairing.json`) and must not re-sign a used invoice
   (`replayed_invoice`).
6. ESP32: join, fetch the gate key, mint an invoice, draw the QR (section 1 settings), poll with fresh nonces, and
   verify with `crypto_ed25519_check`. Run the tamper test (flip one byte of `sig`: rejected) and a replay test (an
   old answer with another nonce: rejected).
7. Then the loop with one gate only: a chai errand pays the ESP32's invoice, and the ESP32 shows PAID on its next read.

## 5. Scans: the duck pays the QR it read (behind `APP_SCANS_ENABLED`)

The camera reads the gate's QR (`vq1:<invoiceId>`) and sends a JPEG crop of the QR, at most 64 KB. The chip hashes
and signs the crop, and the Worker starts the errand for exactly that invoice (0G decides, then the chip signs the
payment). A scan is how every errand on a real robot starts; a **Get me** pill only records what the owner asked for
(§6.1). The crop is stored in R2 and uploaded plain to 0G Storage as proof of the robot's work (spec rule 4). It never
reaches the 0G decision. The episode evidence (and so the `EpisodeLog` anchor) carries
`{sha256, bytes, capturedAt, chipSig}`, plus `rootHash` once the crop is on 0G Storage. The route exists only while `APP_SCANS_ENABLED` is `true`. Until then it
answers 404, and `GET $APP/api/health` shows `features.scans: false`.

The examples below are exact request/response pairs from the native run on `688209b`, against the local Worker, with
throwaway keys. The ids are local; `<chipToken>` is the `pairing.json` token.

### 5.1 Local listener on the chip (`--local-port N`)

The easiest path from the camera process. Run the chip with `./vitaquack-chip --server $APP --local-port 8787`; it
logs `scan listener on http://127.0.0.1:8787/scan` and binds 127.0.0.1 only. The chip signs, forwards to `/scans`
and returns the Worker's status and JSON unchanged.

```sh
curl -s -w ' %{http_code}\n' http://127.0.0.1:8787/scan -H 'content-type: application/json' \
  -d '{"invoiceId":"2hl53glbtki6ntppjt72xbe4oq","jpegBase64":"/9j/4Gm/ACBR2qAVymzcUtKhNNB5IfsN26fE1n2tHFIoLCvWLGoCrJZUfJZY2tTb2EZDIrSEK1/+JtktVkUjao6jL+gmCjo1TexdsiX2WGNkuWg441fMRwsQ/oA81v/Z"}'
{"episodeId":"zmycnkz4e7zza5y2loctktokcq","state":"signing","observationId":"g6l2aegnkhl6o3ybysbgrkyfbu"} 201
```

`capturedAt` (unix ms) may be sent; when absent the chip uses its own clock. The chip log line is
`scan 2hl53glbtki6ntppjt72xbe4oq 0x<first 8 hex>… → 201`. The chip refuses these locally, before touching the key
(400, nothing is sent):

```text
{"invoiceId":"2hl53glbtki6ntppjt72xbe4oq","jpegBase64":"AQID"}  →  400 {"error":"crop is not a JPEG"}
also: "jpegBase64 is not base64" · "crop is larger than 64 KB" · "expected {\"invoiceId\", \"jpegBase64\", \"capturedAt\"?}"
the Worker did not answer within 60 s  →  502 {"error":"the Worker did not answer the scan"}
```

### 5.2 The Worker route (what the listener sends; for a client of your own)

`POST $APP/api/chips/<robotId>/scans` with `Authorization: Bearer <chipToken>`. The body, with `capturedAt` in unix
ms, `sha256` as `0x` + 64 lowercase hex of the decoded bytes, and `bytes` as the decoded length:

```sh
curl -s -w ' %{http_code}\n' $APP/api/chips/d2ji3kky7sgfbvqzqp6lpkvbdi/scans \
  -H 'authorization: Bearer <chipToken>' -H 'content-type: application/json' -d '{
  "invoiceId": "g2xvzkre5gphl7dwvedzsmchnm",
  "capturedAt": 1793963768769,
  "frame": {
    "mime": "image/jpeg",
    "sha256": "0x6e9de8ddddf31995bd715d2ff31c4f3dcf1376a3400c6abf99bafa16aec487b3",
    "bytes": 96,
    "b64": "/9j/4E0Cmp/TSQzvO62dpUKaPXOGP/xRwPmDTcUstyM5aBTvKAYIkf3lxaULlqbXlWtniPPXdXo2YT8OYBPEBpeeRp86N43+cXITxbAL6EZvesHvhp8sn/VR8HejrP/Z"
  },
  "sig": "0xbc1e39bdd292b09461f03a76cea75e39e786fad12c34eeecef4b22d5498b7e594df8c227276675fa43901a0ea58b7ea775843d8f8ee545771b3960f65e66e0941b"
}'
{"episodeId":"bt4vh5kg7rhsol6uben4kmvepq","state":"signing","observationId":"tt2s377y5mi5nsx4ichlptlrni"} 201
```

`sig` is the chip key's EIP-191 `personal_sign` of the UTF-8 string
`vitaquack-scan:v1|<invoiceId>|<sha256 exactly as sent>|<capturedAt ms>|<robotId>`. To check a signer bit-exactly, use
the golden vector in `packages/protocol/test/fixtures/golden.json` → `scan`. For the message
`vitaquack-scan:v1|lsqaaaaaaaaaaaaaaaaaaaga3y|0x0936618c04c6c867c2b88b42599f873be1586da262bb2afaf127849fd5f873fe|1794000123456|bmdqaaaaaaaaaaaaaaaaadimaa`
its digest is `0x79a9d05f784615f16df3ccf8c0b4e8d282ebd7909876c0378ece6d30f9e4da5b` and its signer
`0xa7c317EFb8892F3da98Daf78Ac6653015be7a17B`. In Python: `Account.sign_message(encode_defunct(text=message), key)`.

The Worker checks in this order and answers with the first refusal. The bodies are the Worker's exact strings. The
201, the 200, the signer 401, the sha256, size and capturedAt 400s, the 404 and the "not open" 409 were captured in the
run above.

| Status | Body                                                                                                                                       | When                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 401    | `{"error":"bad chip token"}`                                                                                                               | missing or wrong bearer, or the robot is not paired                          |
| 400    | `{"error":"expected {\"invoiceId\", \"capturedAt\" (unix ms), \"frame\": {\"mime\", \"sha256\", \"bytes\", \"b64\"}, \"sig\"}"}`           | body does not match the shape                                                |
| 401    | `{"error":"scan is not signed by this robot’s chip"}`                                                                                      | `sig` does not recover to the paired chip address                            |
| 200    | `{"episodeId":"bt4vh5kg7rhsol6uben4kmvepq","state":"signing","observationId":"tt2s377y5mi5nsx4ichlptlrni"}`                                 | a repeat: this robot already scanned this invoice (same errand, current state) |
| 429    | `{"error":"too many scans: at most 10 a minute per robot"}`                                                                                 | more than 10 stored scans in the last minute                                 |
| 400    | `{"error":"capturedAt is more than 120 s from the server clock"}`                                                                          | stale or future capture                                                      |
| 400    | `{"error":"frame is larger than 64 KB"}`                                                                                                    | `bytes` above 65536                                                          |
| 400    | `{"error":"frame.b64 is not base64"}` / `{"error":"frame.bytes does not match the decoded frame"}` / `{"error":"frame is not a JPEG"}`     | decode, length, SOI marker `FF D8 FF`                                        |
| 400    | `{"error":"frame.sha256 does not match the frame"}`                                                                                         | the digest is not that of the bytes                                          |
| 404    | `{"error":"unknown invoice"}`                                                                                                               | no such invoice                                                              |
| 503    | `{"error":"not configured: …"}`                                                                                                             | the deploy lacks a merchant, 0G or relayer binding                           |
| 409    | `{"error":"invoice is not for this merchant"}`                                                                                              | another merchant's invoice                                                   |
| 409    | `{"error":"robot has no signed grant"}`                                                                                                     | no budget granted yet                                                        |
| 409    | `{"error":"invoice is not open for this item"}`                                                                                             | paid, expired, within 60 s of expiry, or claimed by another errand           |
| 409    | `{"error":"this robot already has an errand in progress"}`                                                                                  | finish (or wait out) the current errand                                      |
| 502    | `{"error":"R2 did not store the frame"}`                                                                                                    | storage failed; the errand ends `safe_stop` and the invoice is released      |
| 201    | `{"episodeId":"…","state":"signing","observationId":"…"}`                                                                                   | errand started; `state` is the state after the 0G decision                   |

On 201 the `state` is `signing` (the chip's poll gets the payment to sign), `awaiting_approval` (World approval
needed), `walked_away` or `safe_stop`. On the demo allowance (3.00 a day, 1.00 a purchase) a scanned thali (2.00) is
`awaiting_approval`; once less than its price is left today it is `walked_away`, because no approval lifts the daily
allowance. Follow it on `$APP/app/robot/<robotId>`, or let the gate show PAID. The owner sees
the crop at `/app/wallet/episodes/<episodeId>`. `POST /api/wallet/episodes/<id>/verify` re-reads it from R2 and answers
`observations: [{sha256, hashMatches, signerMatches, zeroG}]`. `zeroG` is the 0G Storage copy downloaded by root and
re-hashed, or `null` until the uploader has put it there. Uploaded episodes are public at `$APP/app/proofs`.

### 5.3 Live camera frames (`POST /frame`, behind `APP_LIVE_ENABLED`)

The owner's conversation shows what the robot sees while it is out, about one frame a second. The camera process posts
one **whole** frame per second to the same local listener as `/scan`. The chip logs
`frame listener on http://127.0.0.1:8787/frame`, signs EIP-191 `vitaquack-frame:v1|<robotId>|<0x sha256>|<capturedAt ms>`
(its own prefix, so a frame can never pass as a scan) and forwards
`{capturedAt, frame: {mime, sha256, bytes, b64}, sig}` to `POST $APP/api/chips/<robotId>/frames`:

```sh
curl -s -w ' %{http_code}\n' http://127.0.0.1:8787/frame -H 'content-type: application/json' \
  -d "{\"jpegBase64\":\"$(base64 -w0 frame.jpg)\",\"capturedAt\":$(date +%s%3N)}"
{"sha256":"0x…","capturedAt":1793990000000} 201
```

- **201**: stored as the robot's latest frame. **202** `{"stored": false, …}`: checked but not kept, because the robot has no open request (the chat only shows frames while the duck is out). **429** `too many frames: at most one per 200 ms per robot` (no
  `Retry-After`; nothing is stored). **404**: `APP_LIVE_ENABLED` is not `true` on this deploy. **400**: local checks
  (`jpegBase64 is not base64`, `frame is not a JPEG`, `frame is larger than 64 KB`) or the Worker's (`capturedAt`
  ±120 s). **401**: wrong chip. **502**: the Worker or R2 did not answer (chip timeout 10 s).
- A JPEG of at most 64 KB. The chat shows it up to 384 px wide at its own aspect, so 800×450 at quality ~55 is crisp. The chat reads the latest frame every 500 ms while a request is open, and the Worker accepts up to 5 frames a second.
- The chip reuses its connection for `/frame` (every other chip call still opens a fresh one), so a frame does not pay a new TLS handshake.
- Extra keys (such as `keep`) are ignored. No keyframes are kept today.
- `/frame` never gates `/scan`, and nothing in pairing, polling or `/scan` changed.
- Only the latest frame per robot exists: R2 `live/<robotId>.jpg` is overwritten each time. Only the owner can read it
  (`GET $APP/api/robots/<id>/live` and `/live/frame`, `private, no-store`). The chat stops showing a frame older than
  30 s. Live frames never reach 0G, neither the decision nor storage.

## 6. Counter screen: the till puts the bill up, the ESP32 pulls it

The ESP32 cannot be reached from outside (it sits behind the Mac's NAT), so it pulls what to show. The café owner taps
an item on the till (<https://eth-mumbai-merchant.kristjan-grm11775.workers.dev>, laptop or phone): that mints the bill
exactly as `POST …/invoices` does and puts it on display, replacing the previous one (one displayed invoice per
merchant). `POST …/invoices` (the sim's stalls, the web gate) never changes the display, so they cannot take over the
screen. Displaying does not claim the invoice: the duck's scan (§5) and a chai errand still pay it. Neither route
needs auth or an Origin header, like the mint.

| Call | Answer |
| --- | --- |
| `POST $APP/api/merchants/duck-cafe/counter` with `{"itemId":"chai"}` (or `samosa`, `thali`) | 201 with the invoice mint's body (§1); 404 `{"error":"unknown item"}`; 400 `{"error":"expected {\"itemId\": string}"}` |
| `GET $APP/api/merchants/duck-cafe/counter` | 200 `{"invoice":{"id","itemId","name","amount","expiresAt","status"}}`, or `{"invoice":null}` when nothing is displayed, the displayed invoice is no longer `pending` (paid, used, expired), or it has under 60 s left (the chip and scans refuse those). Compact JSON, keys in this order, numbers unquoted, `cache-control: no-store` |

Exact request/response pairs from the native run on `a98b3e7` (local Worker: the id, the `url` origin and `payTo` are
local; on `$APP` the `url` is `$APP/api/i/<id>`):

```sh
curl -s -w ' %{http_code}\n' $APP/api/merchants/duck-cafe/counter
{"invoice":null} 200

curl -s -w ' %{http_code}\n' $APP/api/merchants/duck-cafe/counter -H 'content-type: application/json' -d '{"itemId":"chai"}'
{"id":"njdayl5o7vyfvvadql7rlscshq","url":"http://localhost:1342/api/i/njdayl5o7vyfvvadql7rlscshq","merchantId":"duck-cafe","payTo":"0x000000000000000000000000000000000000c0de","asset":"0x3600000000000000000000000000000000000000","amount":"100000","expiresAt":1793978503,"linesHash":"0x41552ab61f5ac7450097251d29fe65a0d483d2e95f7a70b94cc17f70376e84ef","rulesHash":"0x518674ab2b227e5f11e9084f615d57663cde47bce1ba168b4c19c7ee22a73d70","invoiceHash":"0x6c63c5d480f640d3ac22b195a8129cc3c14d1809db6de1a63f014f276b3b5348","restricted":false} 201

curl -s -w ' %{http_code}\n' $APP/api/merchants/duck-cafe/counter
{"invoice":{"id":"njdayl5o7vyfvvadql7rlscshq","itemId":"chai","name":"Chai","amount":"100000","expiresAt":1793978503,"status":"pending"}} 200

# after the payment settled (also: under 60 s left, or expired)
curl -s -w ' %{http_code}\n' $APP/api/merchants/duck-cafe/counter
{"invoice":null} 200
```

ESP32 loop with the till: read `GET …/counter` every 1 to 2 s. `null` → show the idle screen. A new `id` → draw its QR
(`VQ1:<ID>`) and read its signed status every second as in §1; the signed status stays the only proof of payment
(the counter read carries no signature, and a QR carries only an invoice id). On the first verified `paid` show PAID;
the counter then answers `null` until the till puts up the next bill. When not `null`, `status` is always `pending`.
The till itself reads `GET …/counter/latest` (the same invoice in any status) and never the signed status, so the
ESP32's read is the one that sees `paid`.

### 6.1 What the owner asked reaches 0G on a real robot

Nothing changes on the Radxa: the chip and its scan (§5) are as before. The owner asks in the robot's conversation
(`$APP/app/robot/<robotId>`: the **Get me a chai / samosa / thali** row, or typed words). That creates an errand
intent, `POST $APP/api/robots/<robotId>/intents {"instruction", "item"?}`, with the owner's passkey session and the
app's Origin (the chip cannot call it). For a `kind=chip` robot the intent only waits for the chip's scan: there are no
navigation turns. The robot's next scan claims it before 0G decides, and `decide` gets `requested` = the item asked
for and `owner: {instruction, item}`. Native results on the demo allowance (3.00 a day, 1.00 a purchase): asked chai,
scanned samosa → `walked_away`; asked thali, scanned thali → `awaiting_approval` (over the 1.00 per-payment cap: World
approval, or a Telegram deny); asked chai, scanned chai → `signing`. Asked chai, scanned thali → `walked_away`: "not
what the owner asked for" comes before the approval row, so for the approval beat the owner asks for a thali.

- **One open intent per robot:** a second `POST …/intents` while one is `running` or `scanned` → 409
  `{"error":"this robot already has an open errand intent"}`.
- **10-minute scan window:** a `running` intent with no scan for 10 minutes ends `expired`, reason
  `no scan within 10 minutes`. Once scanned it follows its errand (also while a World approval waits past 10 minutes)
  and ends `finished` with reason `errand <state>` when the errand ends. The owner's Stop
  (`POST …/intents/<id>/stop`) ends it at once. Without an open intent a scan behaves as in §5.
- The chip may read its open intent with `GET $APP/api/chips/<robotId>/intent` (chip bearer; 204 without one), for
  example to say the instruction aloud. The chip CLI does not call it.

From the same native run (owner calls with the session cookie and Origin; the scan through §5.2):

```text
POST /api/robots/4sai4bguhdynkn7mzretxlyoba/intents {"instruction":"Get me a chai","item":"chai"}
→ 201 {"id":"maedm5dvlb6j6mmt3ukczxtcu4","robotId":"4sai4bguhdynkn7mzretxlyoba","state":"running","instruction":"Get me a chai","item":"chai","episodeId":null,"episodeState":null,"reason":null,"turns":[],"createdAt":1793977903768}
POST /api/robots/4sai4bguhdynkn7mzretxlyoba/intents {"instruction":"and a samosa"}
→ 409 {"error":"this robot already has an open errand intent"}
POST /api/chips/4sai4bguhdynkn7mzretxlyoba/scans (the till's samosa invoice)
→ 201 {"episodeId":"fxqntbk7vbniy2i6xljg2plxhu","state":"walked_away","observationId":"6rnshyzyffyo75beqlziqtoxqq"}
GET /api/robots/4sai4bguhdynkn7mzretxlyoba/intents/maedm5dvlb6j6mmt3ukczxtcu4
→ 200 {"id":"maedm5dvlb6j6mmt3ukczxtcu4","robotId":"4sai4bguhdynkn7mzretxlyoba","state":"finished","instruction":"Get me a chai","item":"chai","episodeId":"fxqntbk7vbniy2i6xljg2plxhu","episodeState":"walked_away","reason":"errand walked_away","turns":[],"createdAt":1793977903768}
```
