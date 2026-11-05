# Research: bench spikes on the real hardware (Radxa Zero 3W, ESP32 gate, on-chip signing)

Written 2026-11-06 from the MacBook bench session. Everything here was run on the boards on the desk
at the venue unless marked otherwise. Companion notes: `robots-and-embedded.md` (hardware research),
`reference-additions.md` (clones), `../bench-answers.md` (QR and endpoint proposal), `../plan.md`
(spikes S1-S8, decisions D1-D14).

**Confidence:** high = measured or read on the device today; medium = one observation or reading of a
photo; low = my inference.

## TL;DR

1. **The Radxa Zero 3W boots Radxa Debian 12 from a microSD, joins Wi-Fi headless, and its Pi Camera v2
   works.** Kernel `6.1.84-10-rk2410-nocsf`; the kernel found `imx219 2-0010` after one overlay was
   enabled, and GStreamer captured 1920x1080 frames. This answers plan unknown "which OS is on the
   Radxa" (D14): it is whatever we flash, and the image below works. (high)
2. **The chip can generate its own key and sign what Arc USDC accepts.** One JSON request, one
   keypair made on the Radxa, an EIP-3009 `transferWithAuthorization` signature that viem recovers
   to the chip's address and that the live Arc USDC contract treats as valid. (high, see section 4)
3. **The spike signs EIP-3009 directly, which is not the plan's flow.** The plan has the robot sign
   an ERC-7710 voucher under a sub-grant (D3). The typed-data, policy-before-signing and key handling
   carry over; the signed struct does not. The next spike should sign the real voucher. (high)
4. **Venue Wi-Fi is the biggest risk found so far, and it bears on S7.** The Radxa joined
   `ETHGlobal` and the Mac reaches it over SSH, so there is no client isolation, but throughput to the
   Radxa was a few KB/s. `apt update` never finished. Plan around a private network. (high)
5. **The ESP32 gate hardware works for display; servo and QR are not done.** (medium)

## 1. What is on the bench

| Part | State |
| --- | --- |
| Radxa Zero 3W (RK3566), Pi Camera v2 | Boots, SSH, camera frames, key + signing. QR decode not installed (link too slow). |
| ESP32 dev board (ESP32-D0WD-V3 rev v3.1, 4 MB flash, CP2102 USB-UART) | Flash backed up, display firmware runs. No servo yet, no network code yet. |
| 1.8 in ST7735 128x160 SPI TFT | Works with Adafruit ST7735, `initR(INITR_BLACKTAB)`, `setRotation(1)`. |
| Mac | Runs esptool, PlatformIO, viem verifier. Reaches the Radxa over Wi-Fi. |

ESP32 wiring in use: SCK to D18, SDA (MOSI) to D23, A0 (DC) to D26, RESET to D25, CS to D27, LED
and VCC to 3V3. D18 and D23 are the hardware SPI pins. Through the USB-C hub, reading the flash
(for the backup) failed with serial noise at 460800 baud and worked at 230400; PlatformIO uploads
at 230400 were fine.

## 2. Radxa Zero 3W bring-up recipe (what worked)

1. **Image.** `radxa-build/radxa-zero3` release `rsdk-b1`, `radxa-zero3_bookworm_kde_b1.output_512.img.xz`
   (1,454,086,428 bytes). SHA-512 matched Radxa's `.sha512sum`. It expands to 7.7 GiB, so an 8 GB
   card is too small: use 16 GB or more.
2. **Write.** `xz -dc image.img.xz | dd of=/dev/rdiskN bs=4m`, 299 s at about 27 MB/s on a 64 GB card.
   Guard the disk number: it changed twice when hardware was replugged.
3. **First-boot Wi-Fi.** The card has a 16 MB FAT `config` partition holding `before.txt` and
   `config.txt`. Add `connect_wi-fi SSID PASSWORD` to `before.txt`. The first boot runs it and then
   deletes the file.
   - On this Mac the FAT driver (`msdosfs.kext`) refused to load ("Bad code signature"), so nothing
     FAT would mount. Workaround: dump partition 1 to a file, patch the file's data and its size
     field in place (the long-file-name entry stays untouched), write it back and compare. `mtools`
     rewrote the directory entry in a different style, and `pyfatfs` could not rewrite the file at all.
4. **Headless.** With no display attached the first boot enables SSH. Defaults are `radxa/radxa` and
   `rock/rock`: change the first, lock the second, install a key. Done and verified.
5. **Camera.** Overlays ship disabled. For the Camera Module 2: rename
   `/boot/dtbo/radxa-zero3-rpi-camera-v2.dtbo.disabled` to `.dtbo`, run `u-boot-update` (adds one
   `fdtoverlays` line to `/boot/extlinux/extlinux.conf`), reboot. `dmesg` then shows
   `imx219 2-0010: Model ID 0x0219` and `/dev/video0` onwards appear.
   Capture: `gst-launch-1.0 v4l2src device=/dev/video0 io-mode=4 ! video/x-raw,format=NV12,width=1920,height=1080 ! videoconvert ! jpegenc ! multifilesink location=f_%02d.jpg`.
6. **Observed.** The frame was upside down and greenish (no ISP tuning), so the scanner must rotate.
   Temperature was 48 C idle and 57 C while capturing, without a heatsink. (medium: one run)
7. **Overheating incident (earlier).** Fading power LED and rapid heating whenever the ribbon was
   connected, until the ribbon was reseated to match Radxa's reference photo (striped face up, latch
   closed). Several power-ups since have stayed cool, including the camera capturing. Root cause was
   not instrumented. See `robots-and-embedded.md` for the reversed-pin explanation. (medium)

## 3. The Wi-Fi finding

On the venue network `ETHGlobal`, with the Mac on the same network:

- The Radxa joined and answered ping and SSH from the Mac, so there is no client isolation. (high)
- Ping round trip averaged 137 ms with spikes to 365 ms. (high)
- `apt-get update` moved about 3 KB/s and had not finished after five minutes. A 1 MB `scp` to the
  Radxa did not finish in 40 s. A 20 MB copy did not finish in two minutes. (high)
- Small things work: SSH commands, a 9 KB script copy, the first `curl` probe of github, pypi and npm
  (all returned 200), and the signing calls. A later 8 MB sample download from the pypi CDN returned
  0 bytes in 9 s.

Consequences: (a) installing packages on the Radxa needs a better link; (b) JPEG streaming from the
duck (plan S7) will not survive this network as it is; (c) every demo must have its own network.
Options in order of preference: a dedicated phone hotspot (2.4 GHz, WPA2, auto-off disabled), the Mac
sharing its Ethernet over Wi-Fi, or a USB gadget network over the Radxa's USB-C OTG port (untested).

## 4. Wallet spike: generate a key on the chip and sign

Sources: `spikes/radxa-wallet-spike-chip.py.txt` (runs on the Radxa), `spikes/radxa-wallet-spike-verify.ts.txt`
(runs on the Mac), `spikes/radxa-wallet-spike-result.json.txt` (the signed result, no secrets).

**What it does.** The Radxa creates a secp256k1 key on first use (OpenSSL via Python `cryptography`,
already installed, no download), stores it in `~/.duck/spike-key.pem` with mode 600 and never prints it.
`chip.py sign` reads a JSON request on stdin, applies a local hard policy, signs the EIP-712 digest
of an EIP-3009 `TransferWithAuthorization` and prints the signature. Policy before the key is touched:
chain id must be 5042, the verifying contract must be `0x3600…0000`, value must be in (0, 0.10 USDC],
`validBefore` must lie within the next hour of the chip's own clock, `validAfter` must not be in the
future.

**A bug found while writing this up.** The first version skipped the validity check whenever
`validAfter` was 0, so a request with a far-future expiry would have been signed. Fixed, redeployed to
the chip and retested: far-future, 24 h, already-expired and future-start requests are all refused;
only the 1 h request is signed. The committed result was regenerated with the fixed code and verified
again. The chip's clock was 3 s ahead of the Mac's; a real deployment needs a trusted time source,
because the window is only as good as the chip's clock.

**Results.**

| Check | Result |
| --- | --- |
| Known-answer tests on the Radxa (keccak256, address of key 1, sign + recover) | pass |
| Domain separator computed on the chip equals `DOMAIN_SEPARATOR()` from the live Arc USDC | pass |
| viem `recoverTypedDataAddress` returns the chip's address | pass |
| `eth_call` of `transferWithAuthorization` as signed | reverts `ERC20: transfer amount exceeds balance` (signature accepted, address unfunded) |
| Same call with the value changed by one unit | reverts `FiatTokenV2: invalid signature` |
| Chip refuses: 5 USDC, chain 1, unknown token, zero value | all four refused, exit 3, before using the key |
| Chip refuses (after the fix): far-future expiry, 24 h expiry, already expired, `validAfter` in the future | all four refused; the 1 h request is signed |
| Time for one signing call including interpreter start | 1.3 s |

Token facts re-confirmed live: Arc chain id 5042, USDC `0x3600…0000`, `name()` "USDC", `version()` "2".
Nothing was broadcast. The committed signature expires one hour after creation and the address holds nothing.

**What the spike does not prove.**

- **It is not the plan's signing flow.** Plan flow E and D3: the robot signs only invoices it scanned,
  under its sub-grant, through an ERC-7710 voucher that the relayer redeems with `redeemDelegations`.
  The spike signs EIP-3009 with the chip's own key as `from`, which is how an EOA holding USDC would
  pay. The typed-data plumbing, policy-before-sign and on-device key carry over. The struct changes.
  See `spikes/wallet-accounts-v2-spike.ts.txt` for the delegation shapes and redeem path.
- **The crypto here is spike-grade.** `hashlib` has no Keccak-256, so Keccak and public-key
  recovery are pure Python (known-answer tested and cross-checked by viem, but not hardened and not
  constant time). ECDSA itself is OpenSSL. The product should use libsecp256k1 or viem on the chip.
- **The key is a plain file.** Anyone with root on the board can read it. No secure element, no
  encryption, no attestation. "Key never leaves the device" holds only in that weak sense.
- **No funds, no relayer, no 7702, no passkey, no session key tested.**

Cleanup on the Radxa: `rm -rf ~/.duck ~/duck-spike`.

Candidate wheels for aarch64 CPython 3.11 if the link improves: `coincurve` 1.53 MB, `pycryptodome`
2.39 MB, `zxing-cpp` 0.98 MB (the plan names zxing for scanning).

## 5. On the chip versus on the server (brainstorm that matches the architecture page)

On the chip: the robot key and signing, a hard policy check before signing (allowed origin, caps,
invoice binding), QR decode, the deadman and safe-stop, cheap motion detection, a local append-only
audit buffer. On the server: the 0G decision, invoices, Arc verification, relayer, World approval,
ledger, revocation. Authority only narrows: the chip can always refuse, the server can veto but never
approve beyond the chip's limits, and Arc caps are final.

**One conflict to decide.** The plan streams JPEG frames from the duck to RobotSession so a human can
drive and the AI can `look`. A test frame from the bench showed bystanders (deleted). At a venue,
frames going to the cloud are a privacy cost. Options: stream only on explicit driver sessions, blur
or downscale before upload, or keep scanning local and send the QR string only.

## 6. Open items

- QR decode on the Radxa (zxing-cpp wheel, or `zbar-tools`): blocked on the network.
- ESP32: join Wi-Fi, ask the server for an invoice, draw its QR, poll status, drive the servo. The
  servo is not wired yet (pin undecided).
- A bench server with the four endpoints in `../bench-answers.md`.
- Re-run the signing spike against the real voucher / delegation struct.
- Pick and test the private network for the demo.
