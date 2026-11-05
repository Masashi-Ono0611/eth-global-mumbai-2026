# Hardware bench spikes H1–H6 (for the MacBook agent)

> **Historical for H4/H5.** Venue network is now a dedicated phone hotspot (not Mac Internet Sharing) and no camera frames leave the chip (H5 is out of scope). H1–H3 and H6 still apply; the chip protocol the Radxa implements is `docs/spec.md` §8.


Written 2026-11-05 on netcup for the agent on Kris's MacBook, where the hardware is plugged in:
- Radxa Zero 3W (the duck's chip) with its camera
- classic ESP32 with the 1.8" ST7735 128×160 screen

Background: `docs/plan.md` (plan v3), `docs/decisions.md`, `docs/bench-answers.md`,
`docs/research/robots-and-embedded.md`. Run the spikes in order; each has a **pass** line.

**Rules**
- Put spike code in a throwaway `bench/` folder **outside this repo**. Only results come back: append them to
  `docs/spikes/hardware-results.md` and commit with `git commit -m … -- docs/spikes/hardware-results.md`.
- Never print or commit private keys. H3's key is a throwaway with no funds.
- **Radxa safety first.** The board overheated once with the camera attached (a known Zero 3W fault: some camera
  connectors are wired the opposite way). Power it only from a 5 V / 2 A+ supply on **USB-C 1**. If it gets hot within
  seconds, unplug it and use a USB webcam on USB-C 2 instead of the ribbon camera (`robots-and-embedded.md` §2).
- Measure and write down numbers. "It works" isn't a result.

---

## H1: Radxa health and inventory

```sh
# on the Radxa (ssh or serial)
cat /etc/os-release; uname -a; nproc; free -h; df -h /
for z in /sys/class/thermal/thermal_zone*/temp; do echo "$z $(cat $z)"; done      # millidegrees
sudo apt-get install -y v4l-utils >/dev/null 2>&1 || true
v4l2-ctl --list-devices
v4l2-ctl -d /dev/video0 --list-formats-ext | head -60                                # MJPEG? 640x480 fps?
```

- Repeat the temperature reading after 2 minutes of camera streaming (H2 running).
- If `/dev/video*` is missing on Armbian, the camera overlay needs the `rk3568` prefix (`robots-and-embedded.md`,
  Pollen's `setup-board.sh` `configure_camera()`).

**Pass:** we know the OS and kernel, the camera device and its formats; the board stays under ~70 °C with the camera
streaming.

## H2: can the duck's camera read the ESP32's QR? (the biggest physical unknown)

**ESP32** (Arduino via PlatformIO; libraries `adafruit/Adafruit ST7735 and ST7789 Library` + nayuki `qrcodegen` C):
- Show a QR for a realistic invoice URL: `http://192.168.2.1:8787/i/abcdefghijklmnopqrstuvwxyz`. That's the bench
  origin plus a 26-character id.
- Settings: ECC level M, version ≤ 4, **3 px per module**, a 4-module white quiet zone, black on white, centred.
- Don't use TFT_eSPI (crashes on new cores) or ricmoo/QRCode (header clash).
- Also try 2 px per module, and the largest that fits.

**Radxa:**

```sh
python3 -m venv ~/bench/venv && . ~/bench/venv/bin/activate
pip install zxing-cpp opencv-python-headless numpy   # aarch64 wheels exist
```

Then a ~40-line script that:
- opens `cv2.VideoCapture('/dev/video0', cv2.CAP_V4L2)` with MJPG at 640×480
- grabs frames for 20 s
- runs `zxingcpp.read_barcodes(frame)` on each frame
- logs: frames per second, decode success rate, milliseconds per decode, the decoded text, and the QR position
  (position is what steering needs)

**Test matrix** (one row per case in the results):
- distance 10 / 20 / 30 / 40 cm
- angle 0° / 30°
- room light vs dim
- 3 px vs 2 px per module

**Pass:** ≥ 90 % of frames decode at the distance the duck will actually stand (probably 20–30 cm). Write down the
maximum reliable distance.

## H3: Bun on the Radxa, and signing on the chip

```sh
curl -fsSL https://bun.sh/install | bash && ~/.bun/bin/bun --version     # linux-arm64
mkdir -p ~/bench/sign && cd ~/bench/sign && ~/.bun/bin/bun init -y && ~/.bun/bin/bun add viem
```

`sign.ts`:
- `generatePrivateKey()`, written to `~/bench/sign/key.hex` with mode 600
- `privateKeyToAccount`
- `signTypedData` of a MetaMask Delegation Framework delegation:
  - domain `{ name: "DelegationManager", version: "1", chainId: 5042, verifyingContract: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3" }`
  - types `Delegation { address delegate; address delegator; bytes32 authority; Caveat[] caveats; uint256 salt }` and
    `Caveat { address enforcer; bytes terms }`
  - any dummy values
- Time 100 signatures.
- Also `recoverTypedDataAddress` to confirm the signature verifies.

**Pass:** Bun runs on the Radxa; one signature takes ≤ ~20 ms; the recovered address matches; the key file is mode 600.
Report the address only.

## H4: venue-style network through the Mac

1. On the Mac, connect to the internet over **Ethernet** (or another uplink that isn't the Wi-Fi radio).
2. System Settings → General → Sharing → Internet Sharing:
   - share from Ethernet, to Wi-Fi
   - **channel 6**
   - security **WPA2/WPA3 Personal** (not WPA3-only)
   - short network name, password with no symbols
3. Run `caffeinate -dis`.
4. Radxa: `nmcli dev wifi connect <name> password <pw>`, then
   `nmcli connection modify <name> wifi-sec.key-mgmt wpa-psk && nmcli connection up <name>`. Check `ping -c3 1.1.1.1`
   and `curl -sI https://eth-mumbai-site.kristjan-grm11775.workers.dev`.
5. ESP32: `WiFi.setMinSecurity(WIFI_AUTH_WPA2_PSK)`, join, then an HTTPS GET to the same site and print the status.
6. From the Mac: `arp -a`, find the Radxa, `ssh` in.

If the channel menu comes up blank: move `/Library/Preferences/SystemConfiguration/com.apple.nat.plist` aside and reboot.

**Pass:** the Radxa and the ESP32 both reach the Cloudflare site through the Mac; the Mac can SSH to the Radxa.

## H5: camera frames from the chip over a WebSocket

- **Mac:** a Bun WebSocket server (`Bun.serve` with `websocket`) that receives binary JPEG frames, timestamps them,
  and serves the latest one at `GET /frame.jpg`.
- **Radxa:** Python or Bun reads MJPEG frames and sends each JPEG as one binary message, at 5 and 10 fps.
  - Python: OpenCV `imencode` at quality 70.
  - Bun: `ffmpeg -f v4l2 -input_format mjpeg …` piped in.
- Each message includes the capture time (8-byte prefix), so the Mac can compute the delay.
- Run it over the H4 network.

**Pass:** report frame size, achieved fps, median and p95 delay over 2 minutes, and Radxa CPU % and temperature. This
predicts the Robot Agent camera view (frames go to a Cloudflare DO instead of the Mac).

## H6: the bench payment loop with real devices, no money yet

**Mac:** a Bun server on `0.0.0.0:8787` (LAN only, behind the Mac's own network). It holds an **Ed25519** key
(WebCrypto) and implements the endpoints from `docs/bench-answers.md`:
- `POST /invoices` → `{ invoiceId (26 chars), url, amount: "1.50", currency: "USDC", expiresAt }`
- `GET /invoices/:id` → the same + `status`
- `POST /invoices/:id/payments` → bench: marks the invoice paid (later this becomes the x402 payment)
- `GET /invoices/:id/status?nonce=<gate nonce>` → `{ invoiceId, status, nonce, expiresAt, sig }`
  - `sig` = Ed25519 over the UTF-8 string `invoiceId|status|nonce|expiresAt`
  - the status becomes `used` after the first `paid` response is read

**ESP32:**
1. Fetch the Ed25519 **public key** once (or hard-code it).
2. `POST /invoices` → draw the QR (H2 settings).
3. Poll the status every 1 s with a fresh random nonce.
4. **Verify the signature with Monocypher's `crypto_ed25519_check`.** Use the optional `monocypher-ed25519.c`;
   `crypto_eddsa_*` uses BLAKE2b and will NOT verify WebCrypto signatures.
5. Check that the nonce matches, then show **PAID** (and move the servo if one is wired).
6. Show a fresh QR.

**Radxa:** the H2 scanner. On the first decode of a URL from the allowlisted origin, call `POST /invoices/:id/payments`
once. Before that, call H3's signer on the invoice fields, to prove the chip signs what it scanned.

**Pass:**
- 10 loops in a row without a human touching anything
- time from the QR appearing to PAID: median and max
- a tampered status (flip one byte of `sig` on the server) is rejected by the ESP32
- a replayed old status (wrong nonce) is rejected

---

## Results template (append to `docs/spikes/hardware-results.md`)

```
## H<n> <name> (date, who)
Setup: …
Numbers: …
Pass/fail: …
Surprises / decisions needed: …
```
