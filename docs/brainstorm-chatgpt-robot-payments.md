# Brainstorm: robotic payments PoC (ChatGPT session)

> **Historical (5 Nov 2026).** The original ChatGPT brainstorm. Superseded by `docs/spec.md` and `docs/decisions.md` (Pi Zero, BLE/offline and x402-on-Base ideas are not the plan).


Captured from Kris’s Mac brainstorming session (pasted into eth-global-mumbai-2026 docs 2026-11-05).  
This is **exploratory product/hardware design**, not a locked architecture. Where it conflicts with `decisions.md` (Arc mainnet, MetaMask delegation, Open Duck Mini on Pi Zero 2W, World/0G prizes), **decisions.md wins** until we deliberately reopen them.

---

## Kris’s framing

- Hardware on hand: something that can control the Hugging Face RoboDuck (likely Raspberry Pi–class with camera), plus a separate ESP32.
- Want a wallet / private key on the duck side that can sign messages.
- Second ESP32 on Wi‑Fi runs a “server” / gate: after payment is received, move a servo to open a gate.
- Flow: duck scans an Ethereum payment QR (x402-style or a normal contract call), signs payment; gate device learns payment succeeded and opens.
- Bonus: duck works without internet (Bluetooth / offline signed payment).
- Question: best design, and how to start from the MacBook.

---

## ChatGPT proposed architecture (summary)

Machine-to-machine payments: robot has its own wallet, pays another machine, that machine performs a physical action after **verified** payment.

Suggested split:

1. **RoboDuck** — camera + wallet + signer
2. **Payment QR** — payment request + invoice ID
3. **ESP32 gate** — Wi‑Fi + servo; does **not** decide payment success from the duck’s word alone
4. **Backend / verifier** — issues invoices, verifies payment, authorises the gate
5. **Chain** — ChatGPT suggested Base / USDC / x402; **eth-global-mumbai-2026 target is Arc mainnet USDC** (see decisions)

Happy path (online):

1. Gate requests an invoice from the backend
2. QR shown at the gate
3. Duck scans QR
4. Duck signs payment authorisation with its key
5. Networked component submits / verifies
6. Backend authorises ESP32 to move servo
7. Gate opens

Important rule (agreed with our docs): ESP32 must receive a **verified, invoice-specific** authorisation, not a raw claim from the duck.

Build online first, then offline signing + Bluetooth transport.

---

## Hardware table from the brainstorm

| Capability | Pi Zero–class Linux | ESP32 MCU |
| --- | --- | --- |
| Python | Yes | MicroPython, limited |
| Node / TS | Often | Not native |
| EVM signing | Straightforward | Embedded crypto libs |
| Camera QR | OpenCV / zbar | ESP-IDF decoder |
| BLE / Wi‑Fi | Model-dependent | Usually available |

- **Duck:** if Linux, small Python (or similar) service for camera + signing beside existing robot firmware.
- **Gate:** ESP32 ideal — Wi‑Fi, authenticated backend channel, PWM servo. Do not power servo from GPIO alone.

Open Duck Mini research elsewhere in eth-global-mumbai-2026 points to **Pi Zero 2W + camera** for walking; treat that as the duck brain unless hardware photos say otherwise.

---

## Payment modes (from brainstorm)

- **Mode A — Online duck:** scan, sign, submit on Wi‑Fi; backend verifies settlement; open gate. Best first prototype.
- **Mode B — Offline duck, online gate:** duck signs offline; BLE (or similar) to ESP32; ESP32 relays to backend. Strong demo.
- **Mode C — Both offline:** local verify + later settlement. Needs pre-funding / trust model; a bare signature ≠ funds later.

Prefer Mode A then Mode B. QR may only carry a short invoice id; full payment requirements over BLE if payloads are large.

---

## Wallet / safety ideas from brainstorm

- Locally generated EVM keypair on the duck; never log or transmit the private key.
- Demo: encrypted key on device + tiny balances + caps.
- Policies: max per payment, max per day, allowlisted chain / token / recipients, invoice expiry + nonce.
- Treat QR as **untrusted request**, not executable code.
- Prefer not signing arbitrary raw txs from QR contents — structured payment / voucher / x402-style auth is safer.

**Project note:** owner passkey wallet grants an on-chain capped delegation to the duck EOA (MetaMask Delegation Framework on Arc). That replaces “trust the duck’s self-reported balance” for the main prize story. Gate invoice flow can still sit on top.

---

## Gate firmware sketch (brainstorm)

ESP32 boots → Wi‑Fi → subscribe `gate/{deviceId}/commands` → receive signed OPEN (invoice + expiry) → check → servo open → wait → close.  
Backend only sends OPEN after required payment state. Prefer confirmed settlement for a physical gate.

---

## MacBook start checklist (brainstorm)

1. Identify RoboDuck controller and existing firmware
2. Connect to Mac; inspect serial / SSH (`ls /dev/cu.*`, USB profile)
3. Back up firmware / config before flashing
4. Create wallet; test local EIP-712 (or chosen) signing
5. Read a QR from the duck camera
6. Build invoice + settlement backend
7. Flash ESP32; test servo
8. Wire confirmed payment → gate open
9. Add offline signing + BLE relay

Tools mentioned: `brew install python git picocom`; ESP-IDF / esptool only after confirming it is an ESP32 you intend to flash; do not brick robot motor firmware.

References cited in the session: Coinbase x402, Cloudflare x402 docs, ESP-IDF, viem.

---

## Ask left open in the brainstorm

Photo of the RoboDuck controller (chip markings / connectors) **or** exact Hugging Face / Open Duck Mini repo link — to decide “sidecar service on Linux” vs “extend MCU firmware”.

*(Open Duck Mini v2 is documented in our earlier research as Pi Zero 2W–based; still confirm the board Kris has in hand.)*

---

## How this maps into eth-global-mumbai-2026 next steps

| Brainstorm piece | Where it lives in this project |
| --- | --- |
| Duck wallet + QR pay | Robot / firmware + Arc delegation |
| Gate ESP32 + servo | Separate PoC peripheral; great physical demo of “payment → action” |
| Backend invoice + verify | Effect API on the styldappv2 foundation |
| Offline / BLE | Bonus after online path works |
| Base / x402 default | Prefer **Arc mainnet** + our delegation/voucher design; x402 only if it fits Arc sponsors |

Keep this file as the hardware/PoC narrative for the coding agent; keep prize and chain locks in `decisions.md` / `prizes.md`.
