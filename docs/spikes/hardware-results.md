# Hardware bench results

Results of the hardware spikes H1 to H6 and C1, one section per spike.

Status, 7 Nov: later work overtook parts of H2, H5 and H6 in code, not as bench results. Camera frames go to the
Worker over HTTPS instead of a WebSocket: the chip signs each frame and posts it, and the owner's chat shows it live
(0efdb5d, b97d0a4). The counter screen routes that give the ESP32 the invoice to show exist (61a9a41), and the chip's
scan route is documented with exact request/response pairs (f10e56d). The sections below stay as measured on 6 Nov.

## H1 Radxa health and inventory (2026-11-06, MacBook agent): partial
Setup: Radxa Zero 3W booted from a 64 GB microSD (`radxa-zero3_bookworm_kde_b1`, 7.7 GiB image), 5 V from a Mac USB-C port (left corner,
"5V IN / USB_OTG"). This board has no eMMC fitted (empty BGA pads); the card is its only storage. Pi Camera Module 2 (IMX219) on the CSI ribbon.
Numbers:
- OS Debian 12 bookworm (Radxa OS), kernel `6.1.84-10-rk2410-nocsf`, 4 cores, 1.9 GiB RAM (about 1.6 GiB available idle), root 59 GB with 5.8 GB used.
- Temperature: 48 C idle, 54 C one minute after a reboot, 57 C right after a 45-frame 1080p capture, 55 C a minute later. No heatsink.
- Camera: after enabling the `radxa-zero3-rpi-camera-v2` overlay, `dmesg` shows `imx219 2-0010: Model ID 0x0219`. `/dev/video0` to `video9` are the Rockchip ISP
  nodes (`rkisp_mainpath`, `rkisp_selfpath`, ...), not a UVC webcam, so there is no MJPEG mode. GStreamer NV12 to JPEG at 1920x1080 produced 45 frames of about 170 KB.
- Not measured: `v4l2-ctl --list-formats-ext`, fps, a 2-minute streaming temperature.
Pass/fail: partial. OS, kernel, camera device known and the board stayed at or below 57 C in a short capture; the 2-minute streaming temperature is not measured.
Surprises / decisions needed: (1) The first power-ups with the ribbon attached overheated the board until the ribbon was reseated (striped face up, as in Radxa's photo);
several power-ups since have stayed cool. (2) The frame came out upside down and green-tinted (no ISP tuning), so the scanner has to rotate. (3) A test frame showed
bystanders and was deleted; decide a policy for frames that leave the chip (see `../research/bench-spikes.md` section 5).

## H2 can the duck's camera read the ESP32's QR? (2026-11-06, MacBook agent): NOT DONE
Reason: the Radxa could not install `zxing-cpp` or `opencv`. Venue Wi-Fi gave it about 3 KB/s (see H4). The ESP32 side also does not draw a QR yet; it
runs a colour and text test on the ST7735 (Adafruit ST7735, `initR(INITR_BLACKTAB)`, rotation 1; wiring in `../research/bench-spikes.md` section 1).
Pass/fail: not run. The camera path to feed it is verified (H1).

## H3 Bun on the Radxa, and signing on the chip (2026-11-06, MacBook agent): signing done in Python, Bun NOT tested
Setup: Bun was not installed (same download problem). The chip's own Python 3.11 with `python3-cryptography` 38 was used instead: ECDSA by OpenSSL,
Keccak-256 and public-key recovery in pure Python. The key is generated on the chip and stored at mode 600; only the address leaves it.
Numbers (100 signatures on the Radxa):
- OpenSSL ECDSA alone: 2.55 ms per signature.
- Sign plus finding the recovery id with my pure-Python recovery: 187 ms per signature. The recovery code dominates; libsecp256k1 or viem would remove it.
- Pure-Python Keccak-256 of 300 bytes: 10 ms.
- Signed a real EIP-3009 `TransferWithAuthorization` (USDC `0x3600…0000`, chain 5042): viem recovers the chip's address, the domain separator equals the live
  contract's `DOMAIN_SEPARATOR()`, an `eth_call` of `transferWithAuthorization` reverts with `ERC20: transfer amount exceeds balance` (signature accepted, address unfunded),
  and the same call with the value changed by one unit reverts with `FiatTokenV2: invalid signature`.
Pass/fail: fails the brief's pass line: Bun was not run, and the 20 ms target is not met (187 ms) by this implementation. The chip does generate a key, sign typed data
that viem recovers and the live contract accepts, and the key file is mode 600.
Surprises / decisions needed: using libsecp256k1 (a 1.5 MB `coincurve` wheel) or Bun with viem on the chip is needed before this is a performance claim.
Sources: `../research/spikes/radxa-wallet-spike-*.txt`, write-up `../research/bench-spikes.md` section 4.

## C1 (added): the chip signs the plan's payment voucher; checked against the MetaMask kit and live Arc (2026-11-06, MacBook agent): PASS, 20 of 20 checks
Setup (plan v3 topology): owner = HybridDeleGator with a software passkey, grant = owner to the chip, then a one-time leaf voucher to `ANY_DELEGATE`. An earlier run with an
AI-client hop between owner and chip (plan v2) also passed 20 of 20, and there the chip verified the hop's EOA signature itself. The chip stores its grant, recomputes the
invoice hash, builds the leaf delegation itself from the invoice and only then signs. The Mac builds the same leaf independently with `@metamask/smart-accounts-kit` 2.0.0 and compares. Every Arc call is `eth_call` with state
overrides on mainnet (chain 5042). No transaction was broadcast, no funds or testnet were used; the owner balance in the simulation is an override.
Numbers: one `sign-voucher` call 1.8 s end to end over venue Wi-Fi (mostly the SSH round trip).
Checks that passed:
- chip invoice hash equals viem's EIP-712 hash; chip leaf caveats (enforcer addresses and terms, same order), delegation hash and EIP-712 digest equal the kit's and viem's;
  viem recovers the chip as signer.
- Live Arc: the voucher as signed pays the merchant; a different amount or payee fails `ExactExecutionEnforcer:invalid-execution`; a replay fails
  `IdEnforcer:id-already-used` and the merchant is paid once; after the deadline `TimestampEnforcer:expired-delegation`; a tampered signature `InvalidEOASignature`.
- Chip policy refused 8 bad requests before using the key: duplicate invoice id, payee not allowlisted, amount over the sub-grant cap, wrong asset, wrong network,
  unknown origin, expired invoice, expiry a day ahead.
Pass/fail: pass for the voucher mechanics.
Surprises / decisions needed:
- Two conventions in the merchant note are unspecified and I had to choose them: `merchantId` (bytes32) as `keccak256(utf8(merchantId))`, and `invoiceId` (bytes16) as
  the first 128 bits of the 26-character base32 id; `linesHash` and `rulesHash` as keccak of canonical JSON (sorted keys, no spaces). The chip and viem agree because I wrote both.
  The merchant implementation must match, so pin them in `merchant-and-agent-commerce.md` 2.3.
- Not tested: a real `redeemDelegations` broadcast, a funded owner, a real-device passkey, the x402 `PAYMENT-SIGNATURE` envelope, `HumanApprovalEnforcer`, and the
  robot's own `redeem` path. The chip replay guard is a plain JSON file, not tamper-resistant. The chip cannot check the owner's passkey (WebAuthn P-256, ERC-1271) signature on
  the grant, so it stores the grant as delivered after checking that its delegate is the chip; Arc verifies the signature at redeem time.
Sources: `../research/spikes/radxa-voucher-spike-*.txt`.

## H4 venue-style network through the Mac (2026-11-06, MacBook agent): NOT DONE, partial findings
What was measured on the real venue network (`ETHGlobal`, Mac on the same Wi-Fi, Radxa joined headless via `before.txt`): no client isolation (SSH and ping from the Mac work);
ping averaged 137 ms with spikes to 365 ms, later 0.4 to 2.5 s; `apt-get update` moved about 3 KB/s; a 1 MB `scp` did not finish in 40 s; the first `curl` probes of
github, pypi and npm returned 200 but an 8 MB pypi sample gave 0 bytes in 9 s.
Not done: Internet Sharing from the Mac; the ESP32 has not joined any Wi-Fi.
Decision needed and in progress: the demo cannot rely on the venue Wi-Fi. A Pixel phone as a dedicated 2.4 GHz WPA2 hotspot (name `duckbench`) is being set up as the shared network
for the Mac, the Radxa and the ESP32; the Mac Internet Sharing route from this brief is the alternative.

## H5 camera frames over a WebSocket (2026-11-06, MacBook agent): NOT DONE
Blocked by the network (H4) and not started.

## H6 bench payment loop with real devices (2026-11-06, MacBook agent): NOT DONE
Not started. Prerequisites that exist now: ESP32 display works, the Radxa camera works, the chip signs a voucher that Arc accepts (C1). Missing: a network all three share,
the bench server, the QR drawing on the ESP32, the scanner on the Radxa, Ed25519 verification on the ESP32.
