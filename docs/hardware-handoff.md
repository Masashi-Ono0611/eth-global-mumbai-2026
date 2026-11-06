# Hardware handoff: ESP32 gate, Radxa chip, bench network

For the MacBook agent and the teammates building the physical duck. The Worker does not change for hardware (spec §8):
the ESP32 is a client of the merchant API, the Radxa runs the same chip client as the laptop mock chip. No secrets
here: the only key a device holds is the chip's own, generated on the Radxa.

**Deployed app** (`$APP`): <https://ethmumbai-edge-main-3vwjnhueh7xtsffr.kristjan-grm11775.workers.dev> (release
`b342dc2` at the time of writing; `curl $APP/api/health`). Every example below is from the deployed run recorded in
`docs/evidence/2026-11-06-deployed-merchant.md`, unless it says "shape".

## 1. ESP32 gate

Loop: fetch the gate key once → mint an invoice → draw its `url` as a QR → read the signed status every second with a
fresh random nonce → verify → show PAID / open on the first verified `paid` → mint the next invoice.

| Call | Example |
| --- | --- |
| `GET $APP/api/merchants/duck-cafe/gate-key` | `{"alg":"ed25519","publicKey":"N4D/99OCV7Wq1sEsgkmHFDJOkuzehmY/nGW831/3Hjw="}` (32 raw bytes, base64; may be hard-coded) |
| `POST $APP/api/merchants/duck-cafe/invoices` with `{"itemId":"chai"}` (JSON, no auth, no Origin needed) | 201 `{"id":"hii53ccex7ybkvbtmd3lnoo6n4","url":"$APP/api/i/hii53ccex7ybkvbtmd3lnoo6n4","merchantId":"duck-cafe","payTo":"0x2845D56f584c5f38d1f0f4B3C1A0A28cf55397F5","asset":"0x3600000000000000000000000000000000000000","amount":"100000","expiresAt":1793926932,"linesHash":"0x4155…84ef","rulesHash":"0x5186…3d70","invoiceHash":"0xe459…3cfa","restricted":false}` (amount in USDC base units: 100000 = 0.10; payable for 600 s) |
| `GET $APP/api/invoices/<id>/status?nonce=<nonce>` | 200 `{"invoiceId":"hii53ccex7ybkvbtmd3lnoo6n4","status":"pending","nonce":"evidence1793926337083","expiresAt":1793926932,"sig":"<base64, 64 bytes>"}` |

- **Signed message:** the UTF-8 bytes of `<invoiceId>|<status>|<nonce>|<expiresAt>`, with `expiresAt` in decimal
  unix seconds, e.g. `hii53ccex7ybkvbtmd3lnoo6n4|pending|evidence1793926337083|1793926932`. `status` is one of
  `pending`, `paid`, `used`, `expired`. The nonce must be 1–32 characters of `[A-Za-z0-9_-]` (anything else is 400).
- **Verify with Monocypher's `crypto_ed25519_check(sig, public_key, message, message_size)`** from the optional
  `monocypher-ed25519.c` (SHA-512 Ed25519, what WebCrypto signs). It returns 0 when valid. Do **not** use
  `crypto_eddsa_check`: that is BLAKE2b and never verifies these signatures.
- Then check that `nonce` and `invoiceId` in the answer are the ones you sent. A recorded old answer carries an old
  nonce, so it fails.
- **The first read that sees `paid` gets `paid`; every later read gets `used`.** Act on that one read: show PAID, move
  the servo, mint the next invoice. Treat `used` and `expired` as "mint a new one".
- **Run one gate at a time.** A "buy chai" errand pays the counter's newest open chai invoice. With the web gate
  (`$APP/gate/duck-cafe`) and the ESP32 both open, the robot pays whichever minted last. Close the browser tab when
  the ESP32 is the gate.

**QR payload:** the invoice's `url`, byte for byte: `$APP/api/i/<id>` (with `/api/`; the H2 bench brief's
`…/i/<id>` predates the spec). The chip refuses any other form (`bad_invoice_origin`). On today's workers.dev origin
that is **107 bytes**, which the H2 settings (version ≤ 4, ECC M, 62 bytes) cannot hold:

| Option | Modules | Fits the 128 px side of the ST7735? |
| --- | --- | --- |
| version 7, ECC M (122 B), 2 px per module, 4-module quiet zone | 45 | 90 + 16 = 106 px: yes |
| version 6, ECC L (134 B), 2 px, 4-module quiet zone | 41 | 82 + 16 = 98 px: yes |
| version 6 or 7 at 3 px | 41–45 | 147–159 px: no |
| a short custom domain (`https://<≤ 20 chars>/api/i/<26>` ≤ 62 B): version 4, ECC M, 3 px | 33 | 99 + 24 = 123 px: yes (the H2 setting) |

Whether the duck's camera reads 2 px modules is H2, not yet run. If it doesn't, the short domain is the fix (ask Kris).

## 2. Radxa chip

The Radxa runs `apps/chip` unchanged: build a single arm64 binary on the Mac (`bun build --compile
--target=bun-linux-arm64 apps/chip/src/main.ts --outfile vitaquack-chip`, ≈ 110 MB, verified to build), copy it
over the hotspot, run `./vitaquack-chip --server $APP --pair <CODE>`. Flags, state files, log lines, refusal codes
and the Python fallback are in `apps/chip/README.md`.

Chip protocol (spec §8). Shapes, with values from the native tests:

1. **Pair** (the code comes from `/wallet/robots` → Add robot; 8 characters of `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, 10
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
   (`no_lease`). On the next good poll it logs `lease ok`. The owner's console shows the robot online while
   `now < lease_until`.

Not yet proven on the deployed edge: a 25 s long-poll through `$APP` (the local dev proxy reset such long responses;
the Lead's end-to-end run checks the deployed one). If the deployed edge resets them too, point the chip at the API
Worker's own origin instead (a config change, not code).

## 3. Network (bench H4)

- The venue Wi-Fi is unusable for devices: about 3 KB/s, pings of 0.4–2.5 s, 8 MB downloads stalled. Do not install
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
3. On `$APP/wallet/robots` choose Add robot and note the code. On the Radxa run
   `./vitaquack-chip --server $APP --pair <CODE>`. Expect `chip 0x… (new key)`, `paired <robotId>`, `lease ok`.
   Check `stat -c %a ~/.vitaquack-chip/key.json` → `600`.
4. Grant the robot a tiny budget (daily 1.00, per payment 0.30, allowlist = the merchant payee prefilled). On
   `$APP/robot/<id>` click "buy chai". Expect `signed <invoiceId>`, then `payment settled 0x<tx>` (on
   <https://explorer.arc.io>).
5. Network cut: switch the hotspot off. Within 35 s expect `STOP motors (lease expired)`; switch it on, expect
   `lease ok`. Restart the process. It must not pair again (`pairing.json`) and must not re-sign a used invoice
   (`replayed_invoice`).
6. ESP32: join, fetch the gate key, mint an invoice, draw the QR (section 1 settings), poll with fresh nonces, and
   verify with `crypto_ed25519_check`. Run the tamper test (flip one byte of `sig`: rejected) and a replay test (an
   old answer with another nonce: rejected).
7. Then the loop with one gate only: "buy chai" pays the ESP32's invoice, and the ESP32 shows PAID on its next read.
