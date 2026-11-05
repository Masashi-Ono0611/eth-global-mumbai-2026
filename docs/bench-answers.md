# Bench answers: duck payment gate

> **Historical (5 Nov 2026).** Written for the first bench session; the plan has moved on (no session keys, the chip signs leaves under a grant, HTTPS long-polling). The invoice/status endpoint shapes in §1 survive in `docs/spec.md` §7. Build from `docs/spec.md`.


Answers for the MacBook bench session (ESP32 gate + ST7735 TFT + servo, Radxa Zero 3W + camera).
Written 2026-11-05 from `coding-agent-brief.md`, `foundation.md`, `decisions.md` and
`brainstorm-chatgpt-robot-payments.md`.

**Legend:** **Docs say** = written in the repo docs. **Proposal** = not specified anywhere yet. Treat
proposals as the default for the bench, and they become product decisions once Kris confirms.

---

## 1. QR payload and merchant/gate endpoints

**Docs say:** no QR format and no endpoints are defined. The docs only give rules:

- The QR is an **untrusted request**, not executable code. Do not sign raw transactions taken from QR contents.
- The QR may carry only a **short invoice id**. The full payment details come from elsewhere.
- Invoices have an **expiry and a nonce**, and are single-use.
- The gate gets an invoice from the backend. The backend verifies payment, and **only then** does the gate open.
- The gate must receive a **verified, invoice-specific** authorisation, never the duck's own "I paid".
- In the product, "paid" is decided by reading **Arc**. A database row never authorises a payment.

**Proposal:** make the bench nonce the product's invoice id, so only the source of "paid" changes later.

### QR payload

```
https://<merchant-origin>/i/<invoiceId>
```

- `invoiceId`: 128-bit random, base32 lowercase without padding (26 chars), single-use.
- Use a plain URL so a phone can open it too. The duck only follows **allowlisted origins**. On the
  bench, that's one origin: the Mac server.
- The QR carries **no amount and no payTo**. The duck fetches those from the server and checks
  them against its own policy before paying.
- Fit for 128×160: keep the payload under ~50 chars, ECC level M, QR version ≤ 4 (33 modules), 3 px
  per module, a 4-module quiet zone, black on white. On the bench, use the server's LAN IP and port
  as the origin, e.g. `http://192.168.1.20:8787/i/...`.

### Endpoints

| Who | Call | Bench | Product |
| --- | --- | --- | --- |
| Gate | `POST /invoices` → `{ invoiceId, url, amount, currency: "USDC", payTo, expiresAt }` | amount can be a constant | amount comes from the merchant's price |
| Duck | `GET /invoices/:id` → same body + `status` | used to show what it's paying | duck checks amount/payTo/expiry against its policy before signing |
| Duck | `POST /invoices/:id/payments` | empty body; server sets the flag | `{ txHash }` (or a signed session-key payment handed to the relayer); server verifies the USDC transfer to `payTo` for this invoice **on Arc** |
| Gate | `GET /invoices/:id/status` → `{ status: "pending" \| "paid" \| "expired" }` | plain flag | `paid` only after the server has seen it on-chain |

This replaces the bench's `GET /status/<nonce>`, so the path already matches the product.

Rules that apply to both bench and product:
- `POST .../payments` is **idempotent**. A second POST for the same invoice returns the same result
  and never pays twice.
- An invoice past `expiresAt` turns `expired`. The gate drops it and requests a new one.
- After the gate opens, it requests a fresh invoice. It never reuses an id.

**Product gap to remember:** a gate polling plain HTTP will believe anyone on the LAN who answers
`paid`. Before this guards anything real, the status response must be authenticated: HTTPS plus a
per-gate credential, or a server-signed `{invoiceId, status, expiresAt}` that the ESP32 verifies.
The brainstorm's "signed OPEN (invoice + expiry)" is the same idea. Not needed on the bench.

---

## 2. Is the ESP32 only the gate? Where does the robot key live?

**Docs say:**
- `decisions.md` was updated on 2026-11-05. The old row "Plain key on ESP32" is gone. The robot
  wallet is now a **session key on the owner's EIP-7702 smart wallet**, generated on the robot,
  never leaving it.
- The brainstorm already put the gate on the ESP32 and the duck brain on a Pi-class Linux board.
- The coding-agent brief: the "duck key never leaves the device" and "gate ESP32 must not trust an
  unverified 'I paid' claim from the duck".

**Answer:** yes. **The ESP32 is the gate/merchant side only and never holds a spending key.**
- The duck brain (now the **Radxa Zero 3W**, standing in for the Pi Zero 2W) generates and holds the
  robot's session key.
- In the product, the gate may later hold a **device credential** so it can authenticate to the
  merchant server. That isn't a wallet key and can't spend.
- The bench, with no key on the ESP32, matches the product.

**Docs still out of date:** README, vision and the brainstorm still say "Pi Zero 2W" and, in places,
"key on ESP32". Treat `decisions.md` as current. The Radxa swap isn't recorded yet.

---

## 3. Constraints on the camera/QR scan step

**Docs say:** almost nothing.
- The brainstorm lists OpenCV / zbar on Linux as options. No library is chosen.
- The QR is an untrusted request, and the duck must not sign raw transactions from it.
- No image format, resolution or error handling is specified.

**Proposal (Radxa, Linux):**
- **Library:** zbar (`pyzbar` or `zbarimg`) first, with OpenCV `QRCodeDetector` as a fallback.
  Language: Python, matching the Open Duck runtime. Still unconfirmed.
- **Strict parsing:** accept only `^https?://<allowlisted-origin>/i/[a-z2-7]{26}$`. Ignore anything
  else silently. Never open other URLs, and never execute or sign anything from the payload.
- **De-duplication:** after a successful POST, ignore the same id for 30 s. Many frames will decode
  the same QR.
- **Errors:**
  - Server unreachable: retry with backoff for ≤ 10 s, then give up on that id.
  - `expired`: drop it and wait for a new QR.
  - Any 4xx: log and drop.
  - Never retry a payment for an id the server already marked `paid`.
- **Logging:** log invoice ids and statuses only. Never log keys or signatures.
- **Mac webcam stand-in:** use the same parser and the same calls. Only the frame source changes.

---

## Radxa safety note (not in the docs, but please read)

Keeping it unpowered until the cause is known is right. Things to check before the wall supply goes on:

- **Camera ribbon orientation and seating.** A reversed or skewed FPC is a common way to short the
  camera's power on these boards. That would fit "hot and burnt smell, with the ribbon attached".
  Compare the contact side against Radxa's camera docs before reconnecting.
- **Which USB-C port.** Check in Radxa's docs which port is power / OTG and which is host on the
  Zero 3W. A shared hub can backfeed power. Use the wall supply only, and no hub.
- **First power-on:** use a USB power meter if you have one. Ribbon off. Hand on the board for the
  first 30 s. Unplug at the first sign of heat.
- Look closely around the PMIC and the camera connector for discoloured or bulging parts.

I can't verify Radxa's port layout or the camera pinout from here. Use Radxa's official docs for both.
