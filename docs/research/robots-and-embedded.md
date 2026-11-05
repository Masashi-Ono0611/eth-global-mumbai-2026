# Research: robot hardware, embedded QR/servo and on-device signing

Written 2026-11-05 for the duck payment gate (see `../bench-answers.md`, `../decisions.md`,
`../brainstorm-chatgpt-robot-payments.md`). Clones are in `../../references/` (table at the end).
**Confidence:** high = read in the official docs or the source; medium = forum or third-party
source, or one source only; low = my inference.

## TL;DR

1. **The Pollen Microduck runs on a Radxa Zero 3W.** Its brain is the same board as the one on our
   bench, with a Pi Camera v2 (IMX219) on the CSI port. The board on the bench may be a Microduck
   brain. Open Duck Mini v2 runs on a Raspberry Pi Zero 2W. (high, `pollen-robotics_microduck/scripts/setup-board.sh`,
   `docs/design/updater-design.md:424`)
2. **Pick Microduck if we have one.** It is a $399 product that ships assembled, with policies
   already trained. It has a velocity API (`robot.move {vx,vy,vyaw}` over JSON-RPC on
   `/run/robotd.sock`), odometry, a MuJoCo sim running the same daemons, and a camera frame
   endpoint (`GET :8080/frame`). Open Duck Mini is a DIY 3D-printed build (about $400 BOM) driven
   by a Python script with an Xbox pad. Neither has "walk to X" out of the box. We build it as a
   small loop over `robot.move` (or `last_commands`).
3. **The overheating is a known Zero 3W problem.** Some batches shipped with a bottom-contact CSI
   connector where Radxa specifies top-contact. A ribbon in the wrong orientation reverses the
   pins, so 3V3 lands on GND. Users report more than 8 W draw and a board that "burned my hand
   within 2 seconds" (medium-high, forum). **USB-C 1 (OTG) is power; USB-C 2 is USB 3 host.**
   Checklist below.
4. **QR scan on the Radxa:** use `zxing-cpp` (pip has aarch64 wheels), with OpenCV
   `wechat_qrcode` as the fallback. `pyzbar` also works but needs the `libzbar0` apt package. On a
   Microduck, read frames from `mediad`. Don't open `/dev/video*` yourself.
5. **ESP32 gate:** Adafruit_ST7735 or LovyanGFX for the TFT, nayuki `qrcodegen` (C) for the QR,
   ESP32Servo 3.x, Arduino via PlatformIO. Avoid TFT_eSPI on arduino-esp32 ≥ 2.0.15 (open crash
   reports), and avoid ricmoo/QRCode (its `qrcode.h` clashes with the core's own header).
6. **Signing:** Python `eth-account` on the Radxa (all native deps have aarch64 wheels), key in an
   encrypted keystore file. The RK3566 has no secure element we can use quickly. For the ESP32 to
   verify a "paid" status, the server signs with **Ed25519** and the gate verifies with
   **Monocypher**, so the gate holds only a public key. secp256k1 `ecrecover` via trezor-crypto is
   the "Ethereum-flavoured" alternative.

---

## 1. Microduck vs Open Duck Mini

| | **Pollen Microduck** | **Open Duck Mini v2** |
| --- | --- | --- |
| Status | Commercial product. Pre-orders opened 2026-08-27 at **$399**, sold assembled with gamepad and battery ([pollen-robotics.com/microduck](https://pollen-robotics.com/microduck)). Software Apache-2.0. The hardware files are not public | Open-source DIY: 3D-printed, BOM "under $400" ([BOM sheet](https://docs.google.com/spreadsheets/d/1gq4iWWHEJVgAA_eemkTEsshXqrYlFxXAPwO515KpCJc/edit), [Tnkr build guide](https://tnkr.ai/explore/docs/open-duck-mini/open-duck-mini-v2#home)) |
| Size | ~25 cm, ~800 g | Larger (BDX-style, about 40 cm, medium) |
| Compute | **Radxa Zero 3W (RK3566)** on Armbian (Debian trixie) with a custom HAT ("zero3"). A custom "beta" RK3566 board is coming (`docs/design/updater-design.md:424-460`) | **Raspberry Pi Zero 2W**, Raspberry Pi OS Lite 64-bit. A prebuilt image (v0.2.3) is tested only on the Pi Zero 2W (`Open_Duck_Mini_Runtime/README.md`) |
| Servos | 15 × **Dynamixel XL330**, IDs 20–24 / 30–34 / 10–14, on one UART (the RK3566's uart2), powered straight from a 2S pack (`docs/design/robotd-design.md` §2.5, `docs/policy-manifest.md`) | **Feetech STS3215** serial bus servos through a USB bus adapter (`/dev/ttyACM0`, `rustypot`), same joint ID scheme (`rustypot_position_hwi.py`) |
| Sensors | IMX219 camera (Pi Cam v2), BMI088 IMU (head) plus a body IMU, VL53L5CX/L8CX 8×8 ToF, ST25R100 NFC, AIC3104 audio codec, BLE | BNO055 IMU, foot contacts, optional Pi camera (`picamzero`), antennas, eyes, speaker |
| Battery | NP-F550 (2S), 6.6–8.2 V; `robotd` sits the robot down and powers off when the pack is empty | Battery pack in the body (see the assembly guide) |
| Runtime | Rust workspace with 7 daemons. `robotd` runs the 50 Hz loop, safety and ONNX policies (`duck-control`). Also `configd`, `updaterd` (signed A/B releases), `btd`, `padd`, `mediad`, `tofd`. JSON-RPC 2.0 on Unix sockets (`docs/design/architecture.md`) | One Python process, `scripts/v2_rl_walk_mujoco.py`: ONNX inference (`onnx_infer.py`) and an Xbox controller feeding `last_commands` (7 floats) |
| Policies | Trained in `microduck_rl` (mjlab / MuJoCo Warp, PPO, BAM actuator models). ONNX: walk, velstand, sit/stand, standup, ground pick, kick, roulade, rollers. Shipped and swappable (`robotctl policy`) | Trained in `Open_Duck_Playground` (MuJoCo Playground / JAX), with reference motions from `Open_Duck_reference_motion_generator`. `BEST_WALK_ONNX*.onnx` is in the main repo |
| Control API | `{"jsonrpc":"2.0","method":"robot.move","params":{"vx":0.2,"vy":0,"vyaw":0.4}}` as a notification (last writer wins, deadman timeout). Also `robot.head`, `robot.look`, `robot.do {skill}`, `robot.stop`, `robot.enable`, `robot.subscribe` (state with `requested`/`applied`/`limited_by`), `robot.health`. Reachable over ssh (`robotctl`), BLE (`duckctl`, `uvx duckctl`), UDP pad (`netpadd`) and WebRTC (`mediad`) | None as such: edit the script and replace the Xbox input with your own command source |
| Camera access | `mediad` owns the camera. `robotctl frame --output f.uyvy`, or `GET http://<robot>:8080/frame` (PNG, already upright). Camera is mounted at 90° | `picamzero` straight from Python |
| Sim | `scripts/duck-sim`: `robotd --sim` against a MuJoCo `duck-body` from `microduck_rl`, with the same daemons and API. Browser sandbox: [HF space](https://huggingface.co/spaces/pollen-robotics/microduck-simulator) (MuJoCo WASM + onnxruntime-web, legs and rollers variants, WASD) | `v2_rl_walk_mujoco.py` naming aside, it runs on the robot. Sim lives in `Open_Duck_Playground` |
| Lineage | Same author family: Antoine Pirrone (apirrone, Open Duck) works at Pollen. The joint IDs are identical | — |

**Easier to get walking:** Microduck, by far. It walks out of the box with a gamepad.
`robotctl health` and `robotctl monitor` show what the robot is doing. Open Duck Mini needs
printing, motor ID configuration (`configure_all_motors.py`), offsets and IMU calibration first.

**"Walk to X":** neither has it. Microduck has the parts for it:
- `robot.move` velocity intents
- odometry (`odometry/`, which also drives the `monitor` path map)
- ToF obstacle points
- an NPU duck detector (`duck-detect`, `docs/project/npu-bringup.md`)
- The autonomous behaviour stack is still "to port" (`docs/ideas/autonomous_behavior.md`).

Our "walk to the gate" can be a Python sidecar on the robot:
1. Grab a frame from `mediad`.
2. Find the QR's bounding box; zxing-cpp returns its position.
3. Steer with `robot.move` (yaw toward the QR centre, vx until the QR's apparent size reaches a
   threshold).
4. `robot.stop`, then pay.

Develop it against `duck-sim`, which renders a head-camera image (`mediad --sim-camera`).

**Can either run on a Radxa Zero 3W?**
- Microduck: yes, natively. It *is* a Zero 3W.
- Open Duck Mini runtime: probably, with work (medium). It is plain Python, ONNX Runtime and
  `rustypot` over USB serial, all of which have aarch64 wheels. You must replace `picamzero` and
  Pi-specific I2C/GPIO (BNO055 on I2C, buttons, eyes) with Radxa equivalents (`rsetup` overlays,
  `/dev/i2c-*`). The prebuilt image is Pi-only.

## 2. Radxa Zero 3W: power and camera facts

| Fact | Source | Confidence |
| --- | --- | --- |
| **USB-C 1 = USB 2.0 OTG + power input. USB-C 2 = USB 3.0 host only** | [docs.radxa.com hardware interface](https://docs.radxa.com/en/zero/zero3/hardware-design/hardware-interface) | high |
| 5 V input only; ≥ 5 V/2 A adapter recommended. PD is not needed (the board takes 5 V) | same + [product brief PDF](https://dl.radxa.com/zero3/docs/hw/3w/radxa_zero_3w_product_brief.pdf) | high (5 V) / medium (PD) |
| It can be powered from GPIO pins 2/4 (5 V); pin 6 is GND. There is no statement on dual-source backfeed: never power from GPIO and USB-C at once | product brief | high / low |
| USB 3 host port limited to 500 mA | [FCC manual](https://fcc.report/FCC-ID/2BC6T-RADXAZERO3W/6914352.pdf) | medium |
| Normal draw about 2–3 W. More than 8 W means a fault | [forum t/21588](https://forum.radxa.com/t/zero-3w-1gb-manufacturing-error-burned-my-hand/21588) | medium |
| Camera: **22-pin 0.5 mm FPC, 4-lane MIPI CSI**. Pin 22 = VCC_3V3, 20/21 = I2C2 SCL/SDA, 17 = PDN, 1/4/7/10/13/16/19 = GND. Same layout as the Pi 22-pin | [hardware interface](https://docs.radxa.com/en/zero/zero3/hardware-design/hardware-interface), [RPi camera docs](https://www.raspberrypi.com/documentation/accessories/camera.html) | high / medium-high |
| **Zero 3W is specified top-contact.** Some batches (Arace 2024, 1 GB; AliExpress June 2025, 8 GB) shipped **bottom-contact**: the ribbon is flipped, 3V3 meets GND, and the board gets hot within seconds. Radxa said it "fixed the issue with fpc" (Jan 2025) and asked affected users to email support. There was no recall | [t/21588](https://forum.radxa.com/t/zero-3w-1gb-manufacturing-error-burned-my-hand/21588), [t/22617](https://forum.radxa.com/t/zero-3w-camera-8m-doesn-t-work/22617), [t/28045](https://forum.radxa.com/t/can-t-use-camera-connector-for-8m-219/28045) | high that the issue exists; medium on the mechanism |
| Supported cameras: Pi Cam v1.3 (OV5647), Pi Cam v2 (IMX219), Radxa Camera 8M (IMX219). Enable the overlay with `rsetup`. Pi Cam v3 (IMX708) is **not** listed | [Radxa camera docs](https://docs.radxa.com/en/zero/zero3/accessories/camera) | high / medium |
| Pi camera modules are 15-pin, so they need a 15→22-pin "Pi Zero" ribbon | [VEYE guide](https://github.com/veyeimaging/rk35xx_radxa/blob/main/How%20to%20use%20VEYE%20%20series%20cameras%20on%20Radxa's%20RK35XX%20board.md) | medium |
| On Armbian the overlay ships as `radxa-zero3-rpi-camera-v2.dtbo` and must be **copied to `rk3568-…` with `overlay_prefix=rk3568`**, or the camera silently does not probe (no `/dev/video*`, nothing in dmesg) | `pollen-robotics_microduck/scripts/setup-board.sh` `configure_camera()` | high |
| OS: Radxa OS Debian 12 bookworm (kernel 6.1, `radxa-zero3_bookworm_kde_b1`), Debian 11 (5.10), [radxa-build releases](https://github.com/radxa-build/radxa-zero3/releases). Armbian: Debian 13 / Ubuntu 26.04, vendor 6.1 or mainline. Microduck uses Armbian. There is no official Ubuntu image | [Radxa download](https://docs.radxa.com/en/zero/zero3/download), [Armbian](https://www.armbian.com/radxa-zero-3/) | high / medium |
| eMMC is optional at purchase. For maskrom: no SD card, hold the Maskrom button, connect over USB, then `rkdeveloptool` with the `rk356x_spl_loader` | [install-os-on-emmc](https://docs.radxa.com/en/zero/zero3/low-level-dev/install-os-on-emmc) | high |
| Thermal: throttles at 70/75 °C, critical at 95 °C (mainline `rk356x` dtsi). Users see about 44 °C idle with a heatsink, about 72 °C under load, up to 85 °C with camera video. Fit a heatsink. The Microduck logs CPU temperature at about 71 °C in its examples | [t/19851](https://forum.radxa.com/t/zero-3w-running-hot/19851), `docs/robot/udp-pad.md:306` | high / medium |
| A USB UVC webcam on USB-C 2 is a safe alternative to CSI (under 500 mA, or use a powered hub) | t/28045 | medium |

### Safety checklist before the board is powered again

1. **Inspect it unpowered**, camera and ribbon removed. Use a magnifier on the CSI connector, the
   PMIC/regulators and the SoC. Look for discolouration, bulging, cracks, a melted ribbon or bent
   pins. Inspect the camera module too.
2. **Identify the connector type.** Open the latch and see which side the contacts are on.
   - Top-contact: correct (the ribbon's contacts face up, away from the PCB).
   - Bottom-contact: a defect batch. Contact Radxa or the seller, and use a USB webcam instead of CSI.
3. Optional multimeter check: measure pin 22 (3V3) to a GND pin on the bare board. Near 0 Ω means
   the rail is damaged. Don't power it.
4. **First power-up with nothing attached.** No camera, no HAT, no GPIO power. 5 V into **USB-C 1
   only**, through a USB power meter, from a known-good 5 V/2–3 A wall supply. No hub. If you have
   a bench supply, use 5 V with a 1 A current limit.
5. **Watch the first 10 s.** Normal is under about 0.6 A. Unplug immediately above about 1.2 A, or
   at any fast heat or smell.
6. If it boots, check `cat /sys/class/thermal/thermal_zone*/temp`. Idle should be about 40–55 °C
   with a heatsink. Fit a heatsink before any load.
7. **Camera only if step 2 passed.** Power off and never hot-plug. Use a supported module (v1.3, v2
   or 8M) and the right 15→22 ribbon, contacts matching the connector. Enable the overlay. Watch
   the meter at power-on; a current jump means unplug.
8. Never feed more than 5 V. Never power from GPIO 5 V and USB-C at the same time.
9. If the board is a Microduck brain on its HAT, the HAT may be powered from the 2S pack. Bench it
   **off the HAT** first.

## 3. QR scanning on the Radxa (Linux, Python)

| Library | Install on aarch64 | Notes | Verdict |
| --- | --- | --- | --- |
| **zxing-cpp** ([zxing-cpp/zxing-cpp](https://github.com/zxing-cpp/zxing-cpp), Apache-2.0) | `pip install zxing-cpp` (3.1.1, manylinux aarch64 wheels: verified on PyPI) | Actively maintained (pushed 2026-11-04). C++ core; `zxingcpp.read_barcodes(numpy_img)` returns text plus a position quad, which we can use for steering. Generally the most robust and fastest open decoder in published comparisons. I did not benchmark it on an RK3566 | **Primary** |
| **OpenCV `wechat_qrcode`** (opencv_contrib) | `pip install opencv-contrib-python-headless` (5.0.0.93, aarch64 wheels) | CNN detector plus super-resolution, so it handles small, far or tilted codes well. Needs its 4 model files (detect/sr `.prototxt` + `.caffemodel`). Heavier per frame | Fallback for far/small codes |
| OpenCV `QRCodeDetector` / `QRCodeDetectorAruco` | `opencv-python-headless` | Built in, no models. Weaker on blur and small codes | Last resort |
| **zbar / pyzbar** ([mchehab/zbar](https://github.com/mchehab/zbar) maintained fork, LGPL-2.1; [pyzbar](https://github.com/NaturalHistoryMuseum/pyzbar), MIT, last release 2022) | `apt install libzbar0` + `pip install pyzbar` (pure Python, ctypes) | Lightweight and fast on clean, upright codes; weaker with blur, skew and low contrast. `zbarimg` CLI is useful for testing | OK, but no better than zxing-cpp |

Practical settings for the duck:
- Decode greyscale at 640×480 (or crop the centre), at 5–10 fps.
- A TFT is emissive: lower the exposure if the QR blows out, and keep the ST7735 backlight
  moderate.
- On a Microduck, take frames from `mediad` (`GET :8080/frame` PNG, or `robotctl frame` UYVY),
  because `mediad` owns the camera. On a bare Zero 3W, use `cv2.VideoCapture('/dev/videoN',
  cv2.CAP_V4L2)`, or GStreamer with `v4l2src`. Rockchip's ISP (rkaiq) affects image quality on CSI;
  see `scripts/setup-rkaiq.sh` in the Microduck repo.
- Keep the strict parser, allowlist and de-duplication from `bench-answers.md` §3.

## 4. ESP32 gate: display, QR, servo, HTTPS

| Need | Pick | Why / caveats |
| --- | --- | --- |
| ST7735 128×160 | **Adafruit_ST7735 + Adafruit_GFX** (1.12.0) or **LovyanGFX** (1.3.0, `Panel_ST7735`/`Panel_ST7735S`) | Adafruit: simplest, `tft.initR(INITR_BLACKTAB)`. If colours are off or there is a 1–2 px garbage edge, try `INITR_GREENTAB`/`REDTAB`. LovyanGFX: fast DMA, configured in code, works on core 3.x and on IDF |
| | TFT_eSPI (2.5.44) only with care | Open crash reports (`StoreProhibited` in `tft.init()`) on arduino-esp32 ≥ 2.0.15 / 3.x, including ESP32 DevKit + core 3.3.2 ([#3332](https://github.com/Bodmer/TFT_eSPI/issues/3332), [#3831](https://github.com/Bodmer/TFT_eSPI/issues/3831), [#3284](https://github.com/Bodmer/TFT_eSPI/issues/3284)). Workarounds: `#define USE_HSPI_PORT`, or pin core 2.0.14. Configured by editing `User_Setup.h` (`ST7735_DRIVER`, tab variant) |
| QR generation | **nayuki `qrcodegen` C** (`c/qrcodegen.{h,c}`, MIT) | Copy the two files into `src/`. `qrcodegen_encodeText(text, tmp, qr, qrcodegen_Ecc_MEDIUM, 1, 4, qrcodegen_Mask_AUTO, true)` caps it at version 4. Then draw `fillRect(x*3, y*3, 3, 3)` per dark module. Header names don't clash |
| | ricmoo/QRCode: avoid | Last commit 2023. Its `qrcode.h` clashes with the core's bundled `espressif__qrcode` header ([ricmoo#35](https://github.com/ricmoo/QRCode/issues/35), [lib-builder#138](https://github.com/espressif/esp32-arduino-lib-builder/issues/138)). It works if renamed |
| Servo | **ESP32Servo 3.2.1** (madhephaestus) | Supports arduino-esp32 3.x (LEDC). Use `servo.setPeriodHertz(50); servo.attach(pin, 500, 2400)`. Power the servo from its own 5 V rail with a common ground, **not** the dev board's 3V3. Add about 470 µF across the servo supply. Or use the core's `ledcAttach`/`ledcWrite` directly |
| HTTP(S) | `HTTPClient` + `WiFiClientSecure` (Arduino), or `esp_http_client` (IDF) | Bench: plain HTTP to the Mac. Product: HTTPS with `setCACert()` (pin the root CA) plus NTP time, or skip TLS and verify a signed body (below) |
| Signed "paid" status | See §5.2 | — |
| Framework | **Arduino on PlatformIO** (`platform = espressif32`, `framework = arduino`) | Fastest for a hackathon, and all the libraries above are Arduino libraries. Move to ESP-IDF only if we need flash encryption with NVS encryption tuned, or TLS details. IDF can also host Arduino as a component |

Pins (classic ESP32, VSPI): SCLK 18, MOSI 23, CS 5, DC 2 (or 16), RST 4, backlight to 3V3 or a
GPIO, servo on 13 (or 25/26). Avoid strapping pins 0/2/12/15 where you can; GPIO 12 high at boot
breaks flash voltage selection. CP2102 boards sometimes need you to hold BOOT while flashing.

## 5. On-device signing and key storage

### 5.1 Duck (Radxa, ARM64 Linux)

| Option | Status on aarch64 | Use |
| --- | --- | --- |
| **`eth-account`** 0.14.0 (Python) | Pure Python; native deps `ckzg`, `pycryptodome`, `pydantic-core`, `coincurve`/`eth-keys` all have aarch64 wheels (checked on PyPI) | `Account.create()`, `sign_typed_data()` (EIP-712), `encrypt()`/`Account.decrypt()` keystore v3 (scrypt). **Recommended**, matching our Python sidecar |
| `coincurve` 21.0.0 | aarch64 wheels for cp39–cp313 only, **no cp314 wheel**, so use Python ≤ 3.13 (Armbian trixie ships 3.13) | Raw secp256k1 if we hand-roll the digest |
| Rust `alloy` (`alloy-signer-local`, `sol!` EIP-712) | Builds for `aarch64-unknown-linux-gnu`; cross-compile from netcup | Fits if the sidecar becomes a Microduck-style Rust daemon |
| viem on Bun | Bun has linux-arm64 builds | Same code as the backend. Heavier on 1–4 GB of RAM |

Key storage on RK3566, in order of effort:
1. **Encrypted keystore file** (eth-account v3 JSON), mode 600, owned by a dedicated user, with the
   passphrase in a root-only systemd credential (`LoadCredentialEncrypted=` / `systemd-creds`).
   This is honest about what it is: anyone with root or the SD card can take the key. The session
   key's on-chain caps, expiry and revocation are the real control.
2. OP-TEE / TrustZone. Rockchip ships a TEE binary in `rkbin`, and U-Boot/ATF for RK356x can load
   OP-TEE. A key-holding trusted application is not a hackathon task. The status for Zero 3W images
   is unverified.
   Details: RK3566 uses rkbin's closed `rk3568_bl32_v*.bin` (OP-TEE 3.13 blob)
   ([rkbin](https://github.com/rockchip-linux/rkbin)). Upstream OP-TEE RK3568 support is an
   unmerged PR ([optee_os#7887](https://github.com/OP-TEE/optee_os/pull/7887)). The Zero 3W lists
   no on-board secure element. Not realistic for the hackathon.
3. An external secure element on I2C.
   - Microchip ATECC608A/B is **P-256 only**
     ([datasheet](https://ww1.microchip.com/downloads/en/DeviceDoc/40001977A.pdf)), so it cannot
     hold an EVM key.
   - NXP SE050 lists secp256k1, but support **depends on the variant**: it failed on C1 and worked
     on C2 ([NXP forum](https://community.nxp.com/t5/Secure-Authentication/ECDSA-secp256k1-curve-key-pair-can-be-stored-in-SE050/m-p/1825755),
     [AN12436](https://www.nxp.com/docs/en/application-note/AN12436.pdf)).

### 5.2 Gate (ESP32): verify a server-signed status

The gate never holds a spending key (`bench-answers.md` §2). It only needs to verify
`{invoiceId, status, expiresAt}` signed by the merchant server.

**Recommendation:** have the server sign `{gateId, invoiceId, status, exp}` with **Ed25519** and
verify it on the gate with **Monocypher** (one C file, BSD-2/CC0). The gate holds only a public key,
so the bench board needs no flash encryption. Use trezor-crypto `ecrecover` only if the demo should
say "the gate checks an Ethereum signature". ESP32 crypto hardware does P-192/P-256 only, never
secp256k1.

| Option | Lib | Effort |
| --- | --- | --- |
| HMAC-SHA256, per-gate shared secret | mbedTLS (`mbedtls_md_hmac`), built into the core | Lowest. The secret is on the gate, so it must not leak: use flash and NVS encryption in the product |
| ECDSA P-256 or Ed25519 server key; gate holds only the public key | mbedTLS `mbedtls_ecdsa_read_signature` (P-256); Ed25519 via Monocypher or rweather/Crypto | Low. The public key is not secret |
| **secp256k1 `ecrecover`** against the server's Ethereum address (EIP-191 / EIP-712) | micro-ecc (`uECC_secp256k1()`, BSD-2) + a keccak implementation; or trezor-crypto (`ecdsa_recover_pub_from_sig`, from `trezor-firmware/crypto`); or Web3E (`Crypto::ECRecover`, MIT, last commit 2023) | Medium. Nice story ("the gate verifies an Ethereum signature"). trezor-crypto (`crypto/` is MIT) has keccak and recover built in. micro-ecc has no keccak and no recover. Web3E is stale (2023). mbedTLS `CONFIG_MBEDTLS_ECP_DP_SECP256K1_ENABLED` is software only: verify against a known public key, no recover |

ESP32 hardening for the product, not the bench:
- Flash encryption plus secure boot v2, and NVS encryption.
- These burn **eFuses irreversibly**. Development mode can be turned off only 3 times
  (`FLASH_CRYPT_CNT`), and losing power during the first encryption pass corrupts flash. NVS is
  not covered by flash encryption, so it needs NVS encryption separately. Use a spare board, never
  the only bench board.
- Docs: [Flash encryption](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/security/flash-encryption.html),
  [Secure boot v2](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/security/secure-boot-v2.html),
  [NVS encryption](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/storage/nvs_encryption.html).

## 6. Related machine-payment projects

Stars as of 2026-11-05. The canonical x402 repo moved to **x402-foundation/x402**;
`coinbase/x402` is now a fork.

| Project | Link | What it is | Reuse for us |
| --- | --- | --- | --- |
| **x402** | [x402-foundation/x402](https://github.com/x402-foundation/x402) (6.8k★, Apache-2.0) | HTTP 402 payment protocol. The `exact` EVM scheme uses EIP-3009 `transferWithAuthorization` (USDC). Python client: `x402[evm]` | The duck could pay x402 endpoints directly. `python/x402/mechanisms/evm/` has `eip712.py`, `erc7702.py` and `signer.py`, which overlap with our 7702 session-key story. Whether Arc has EIP-3009 USDC is still open |
| **mdb-esp32-cashless** | [nodestark/mdb-esp32-cashless](https://github.com/nodestark/mdb-esp32-cashless) (190★, MIT, active) | ESP32-S3 cashless board for real MDB vending machines, with a Supabase backend that includes an **`x402-vend`** function (402 quote → retry with `X-PAYMENT` → vend) | **Closest to our gate.** Server flow: `docker/volumes/functions/x402-vend/index.ts`. Firmware: `mdb-slave-esp32s3/` |
| solana-esp32-x402 | [PlaiPin/solana-esp32-x402](https://github.com/PlaiPin/solana-esp32-x402) (13★) | Solana x402 hackathon winner: an ESP32-S3 signs Ed25519 x402 payments on the device (ESP-IDF) | Firmware structure for a device that pays. Solana only |
| Paybot (ETHGlobal Buenos Aires 2025) | [showcase](https://ethglobal.com/showcase/paybot-q7grd) | x402-gated robot control: commands go through only after a valid payment | Prior art at ETHGlobal, so judges have seen "pay a robot". Our angle is the robot paying, with owner caps |
| OpenMind OM1 | [OpenMind/OM1](https://github.com/OpenMind/OM1) (3k★, MIT) | Robot AI runtime, now Go; the Python branch is deprecated. Its architecture lists a "Wallet" module. The Circle partnership demo had a robot dog paying for charging over x402 on testnet ([BlockEden write-up](https://blockeden.xyz/blog/2026/05/02/openmind-circle-usdc-robot-payments-machine-economy/)) | Narrative and competitor. No payment code found in the public repo (unverified) |
| peaq robotics | [peaq-robotics-ros2](https://github.com/peaqnetwork/peaq-robotics-ros2) (4★), [robot SDK docs](https://docs.peaq.xyz/sdk-reference/robot-sdk/home) | ROS 2 nodes for `did:peaq` robot identity, storage, access control. Payments via Tether WDK | Keystore and identity patterns only |
| Google AP2 + a2a-x402 | [AP2](https://github.com/google-agentic-commerce/AP2), [a2a-x402](https://github.com/google-agentic-commerce/a2a-x402) | Agent payment mandates (intent/cart) | Same shape as owner → robot allowance. Good vocabulary for the pitch |
| Nevermined | [nevermined-io/payments](https://github.com/nevermined-io/payments) | x402 facilitator plus session keys with spending caps | Closest to our "session key with caps" idea, off-device |
| Coinbase AgentKit, Skyfire KYAPay, Fetch.ai uAgents | [agentkit](https://github.com/coinbase/agentkit), [kyapay](https://github.com/skyfire-xyz/kyapay), [uAgents](https://github.com/fetchai/uAgents) | Agent wallets and payments, web/agent-focused | Little to reuse for hardware |
| Small ESP32 x402 experiments | [x402-cpp](https://github.com/merttozer/x402-cpp), [x402-mqtt](https://github.com/thesmithdao/x402-mqtt), [boat-mer](https://github.com/TLAY-IO/boat-mer), [Ros-X402-Node](https://github.com/homebrewroboticsclub/Ros-X402-Node) | ESP32-C6 x402 client; x402 over MQTT; C stablecoin/BLE runtime; ROS paid endpoints (Solana) | Reference only |

No ETHGlobal 2026 project combining an ESP32, USDC and a robot turned up (searched; not
exhaustive).

## 7. Cloned repos

All in `references/`, shallow (`--depth 1`, LFS skipped), read-only.

| Path | Upstream | Commit | Licence | Why | Key paths |
| --- | --- | --- | --- | --- | --- |
| `pollen-robotics_microduck` | https://github.com/pollen-robotics/microduck | c15c237 | Apache-2.0 | Microduck brain (Rust daemons on a Zero 3W) | `docs/design/architecture.md`, `docs/design/robotd-design.md` §3 (API), `docs/robot/cheatsheet.md`, `scripts/setup-board.sh` (camera overlay), `docs/robot/simulation.md`, `scripts/duck-sim`, `duck-ipc-proto/`, `duckctl/` |
| `pollen-robotics_microduck_rl` | https://github.com/pollen-robotics/microduck_rl | bae39f5 | Apache-2.0 (models: `LICENSE-MODELS.md`) | Policy training (mjlab), ONNX export, MuJoCo `duck-body` for sim | `README.md` task table, `scripts/infer_policy.py`, `AGENTS.md` |
| `apirrone_Open_Duck_Mini` | https://github.com/apirrone/Open_Duck_Mini | b23317a | Apache-2.0 | ODM v2 hardware, BOM link, assembly | `README.md`, `docs/assembly_guide.md`, `docs/open_duck_mini_v2_wiring_diagram.png`, `BEST_WALK_ONNX_2.onnx` |
| `apirrone_Open_Duck_Mini_Runtime` | https://github.com/apirrone/Open_Duck_Mini_Runtime | 376de65 | none stated | ODM on-robot runtime (Pi Zero 2W) | `scripts/v2_rl_walk_mujoco.py`, `mini_bdx_runtime/mini_bdx_runtime/{onnx_infer,rustypot_position_hwi,camera,xbox_controller}.py` |
| `apirrone_Open_Duck_Playground` | https://github.com/apirrone/Open_Duck_Playground | b9be205 | none stated | ODM RL envs | — |
| `zxing-cpp_zxing-cpp` | https://github.com/zxing-cpp/zxing-cpp | bae7153 | Apache-2.0 | Recommended QR decoder | `wrappers/python/` |
| `NaturalHistoryMuseum_pyzbar` | https://github.com/NaturalHistoryMuseum/pyzbar | ff28926 | MIT | Lightweight zbar decoder | `pyzbar/pyzbar.py` |
| `adafruit_Adafruit-ST7735-Library` | https://github.com/adafruit/Adafruit-ST7735-Library | d568339 | MIT | Simplest ST7735 driver | `Adafruit_ST7735.cpp` (`initR` tab variants), `examples/graphicstest` |
| `lovyan03_LovyanGFX` | https://github.com/lovyan03/LovyanGFX | dd228d1 | FreeBSD (+ MIT parts) | Fast ST7735 driver that works on core 3.x and IDF | `src/lgfx/v1/panel/Panel_ST7735.hpp`, `examples/HowToUse` |
| `Bodmer_TFT_eSPI` | https://github.com/Bodmer/TFT_eSPI | 16e3759 | FreeBSD/MIT mix | Popular, but has crash issues on core ≥ 2.0.15 | `User_Setup.h`, `User_Setups/Setup2_ST7735.h` |
| `nayuki_QR-Code-generator` | https://github.com/nayuki/QR-Code-generator | bcfe1b0 | MIT | Recommended QR encoder for the ESP32 | `c/qrcodegen.{h,c}` |
| `ricmoo_QRCode` | https://github.com/ricmoo/QRCode | eafbde4 | MIT | Common alternative. The header clash is documented here | `src/qrcode.{h,c}` |
| `madhephaestus_ESP32Servo` | https://github.com/madhephaestus/ESP32Servo | 88be58c | LGPL-2.1+ | Servo PWM on arduino-esp32 3.x | `src/ESP32Servo.h`, `examples/Sweep` |
| `LoupVaillant_Monocypher` | https://github.com/LoupVaillant/Monocypher | 907e90d | BSD-2 / CC0 | Ed25519 verify of server-signed status on the gate | `src/monocypher.{h,c}`, `src/optional/monocypher-ed25519.{h,c}` |
| `kmackay_micro-ecc` | https://github.com/kmackay/micro-ecc | 541b3a7 | BSD-2 | secp256k1 verify on an MCU | `uECC.h` |
| `AlphaWallet_Web3E` | https://github.com/AlphaWallet/Web3E | c19324c | MIT | Arduino Ethereum: keccak, sign, ecrecover (trezor subset). Stale | `src/Crypto.{h,cpp}`, `src/Trezor/` |
| `ApeWorX_eth-account` | https://github.com/ApeWorX/eth-account (was ethereum/eth-account) | b659d04 | MIT | Duck-side signing and keystore | `eth_account/account.py` (`sign_typed_data`, `encrypt`), `eth_account/messages.py` |
| `x402-foundation_x402` | https://github.com/x402-foundation/x402 | 6a773db | Apache-2.0 | Payment protocol and Python EVM client | `specs/schemes/exact/scheme_exact_evm.md`, `python/x402/mechanisms/evm/{eip712,erc7702,signer}.py` |
| `nodestark_mdb-esp32-cashless` | https://github.com/nodestark/mdb-esp32-cashless | 8be3834 | MIT | ESP32 vending with x402 vend flow | `docker/volumes/functions/x402-vend/index.ts`, `mdb-slave-esp32s3/` |
| `PlaiPin_solana-esp32-x402` | https://github.com/PlaiPin/solana-esp32-x402 | 777ad02 | none stated | ESP32 that signs x402 payments (Solana) | `main/main.c`, `components/` |
| `OpenMind_OM1` | https://github.com/OpenMind/OM1 | 2102a49 | MIT | Robot AI runtime and competitor | `docs/developing/2_architecture.md`, `plugins/` |
| `peaqnetwork_peaq-robotics-ros2` | https://github.com/peaqnetwork/peaq-robotics-ros2 | f0d3a19 | Apache-2.0 | Robot DID and keystore patterns (ROS 2) | `peaq_ros2_core/` |

Skipped: `trezor/trezor-firmware` (619 MB; only `crypto/` is relevant, so fetch it with a sparse
checkout if the gate goes the ecrecover route) and `alloy-rs/alloy`.

## 8. Open questions

1. **Which robot is on the bench?**
   - If the Radxa came out of a Microduck, the camera ribbon, HAT and Armbian image are
     Pollen's. In that case, re-provision with their `setup-board.sh` rather than flashing Radxa OS.
   - Check for the HAT, XL330 servos, NP-F550 pack, and hostname `radxa-zero3` / `microduck@…`.
2. **Is the bench board a bottom-contact CSI batch?** (§2, step 2). If it is, use a UVC webcam.
3. **On a Microduck, where should the payment sidecar run?**
   - Python next to the Rust daemons, talking to `/run/robotd.sock` and `mediad`'s `/frame`.
   - Or a Rust crate in their workspace.
   - Does `updaterd`'s release swap leave `/opt` sidecars and `/var/lib` keys alone? (It should,
     since config lives in `/var/lib/robot`.)
4. Does `mediad` `GET /frame` give enough resolution and rate for QR at 0.5–1 m? It is 1280×720
   UYVY with a 90° mount. Or do we need a dedicated capture?
5. **"Walk to X":**
   - Is a camera-servo loop on the QR quad good enough?
   - Should we use Microduck odometry with a fixed offset ("walk 1 m forward, then scan")?
   - Is a fixed scripted path acceptable for the demo?
6. **Gate signature:** Ed25519 (Monocypher, simple) or secp256k1 `ecrecover` (trezor-crypto,
   better "Ethereum" story)?
7. Does Arc mainnet USDC support EIP-3009 (`transferWithAuthorization`)? If it does, x402 `exact`
   could be the duck's payment format, relayed by our server.
8. Python version on the duck image: if it is 3.14, coincurve has no wheel, so pin 3.13 via `uv`.
9. Should the servo get its own 5 V supply on the bench? A micro servo's stall current can brown
   out an ESP32 on USB.
