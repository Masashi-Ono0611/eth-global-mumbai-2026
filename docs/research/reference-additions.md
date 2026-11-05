# Research: reference additions, gap round (2026-11-05)

Added by the MacBook bench session. 28 shallow, read-only clones in `references/` (listed in
`references/README.md`, under "Added 2026-11-05"). Chosen as **gaps** against the 98 repos already
there. Not committed: `references/` stays gitignored, only the README rows and this note are tracked.

Metadata (size, last push, licence) was checked with `gh api` before cloning. Sparse clones keep only
the listed paths. Clone with `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1`, never edit in place.

## Cloned, and why

| Group | Clone | Why it is here |
| --- | --- | --- |
| Radxa bring-up | `rockchip-linux_rkdeveloptool` | Rockchip's USB flasher (Linux/macOS). Radxa's docs use it to write an image over Maskrom. GPL-2.0, last push 2025-03. |
| Radxa bring-up | `radxa-pkg_radxa-overlays` | Device-tree overlay sources, including the Zero 3 camera overlays (`rsetup` enables them). |
| Radxa bring-up | `radxa-docs_docs` (sparse) | English Zero 3 docs and the shared snippets they import: camera, Maskrom, eMMC/microSD install. Full repo is 480 MB, sparse is 11 MB. |
| Radxa bring-up | `rockchip-linux_rkbin` (sparse, `bin/rk35`) | RK35xx DDR/BL31 blobs. **Does not contain the `rk356x_spl_loader` that rkdeveloptool needs**: download that from Radxa (below). |
| QR scan | `paulmillr_qr` | Zero-dependency TypeScript QR encoder **and decoder**; runs on Bun. Candidate for the TS runtime's `scan()`. |
| QR scan | `mchehab_zbar` | The maintained zbar fork (LGPL). Fallback: Bun shells out to `zbarimg` behind `scan()`. |
| ESP32 gate | `kaiaai_arduino_128x160_display` | 128x160 ST7735S on ESP32, matches our panel. |
| ESP32 gate | `yoprogramo_ESP_QRcode` | QR drawing on TFT/OLED for ESP32 (stale since 2022, read for the draw loop only). |
| Signing | `paulmillr_micro-eth-signer` | Offline secp256k1 tx signing, EIP-7702 authorizations, EIP-191/712. Host-side reference and verifier. |
| Signing | `bitcoin-core_secp256k1` | Reference C library to compare against `micro-ecc` already cloned. |
| Signing | `0xOucan_LeekWallet`, `This-Is-Captain-Code_shrikevault` | ESP32-S3 Ethereum signers (EIP-1559, RFC6979; LeekWallet also renders EIP-712). **Unvetted hobby code**, read for structure only. |
| Accounts | `wevm_viem` (sparse, `src/`) | Runtime and server client library. Checked in the clone: `src/experimental/erc7821` and `src/experimental/erc7715` exist, and 7702 authorization code is present. |
| Accounts | `MetaMask_smart-accounts-kit` | SDK for ERC-7710 delegations and ERC-7715 permissions, per its README; complements `MetaMask_delegation-framework`. |
| Accounts | `pimlicolabs_permissionless.js`, `zerodevapp_sdk` | Bundler/paymaster and account SDKs, next to the ZeroDev contracts already cloned. Session-key and 7702 support is claimed upstream but **not checked in these clones**. |
| Accounts | `erc7579_erc7579-implementation` | ERC-7579 reference modules. |
| Identity | `erc-8004_erc-8004-contracts`, `sudeepb02_awesome-erc8004` | ERC-8004 agent identity/reputation registries (Draft). Nothing robot-specific; relevant only if we register the duck as an agent. |
| Payments | `brtvcl_eip-3009-transferWithAuthorization-example` | Smallest working EIP-3009 `transferWithAuthorization` example (ethers). Basis of x402 "exact" on USDC. |
| Arc | `circlefin_arc-stablecoin-fx` | Official Circle sample: USDC/EURC swaps on Arc. |
| Arc | `l0vvkey_awesome-arc` | Community index of Arc resources (CC0). |
| Arc | `Salado210102_arc-smart-orders` | Community: signed EIP-712 intents with Permit2 witness plus a keeper, on Arc. |
| 0G / physical AI | `alexandre-mrt_0g-agent-kit` | TS SDK for agents on 0G (memory, compute inference). Small and unvetted. |
| 0G / physical AI | `ddiddi_solo-router`, `OakandSparrowSystemsEnterprises_AI-Infra-Hackathon`, `IntelligentSystemsLabUTV_hackathon-physical-ai` | Pattern references for "model proposes, deterministic gate decides, log every decision" (ALLOW/HOLD/DENY, safety envelope, per-step `[Decision]` log). None use 0G. |
| Open Duck | `apirrone_Open_Duck_reference_motion_generator` | Gait reference generator that feeds the playground; completes the Open Duck set. |

## Considered and not cloned

- **`airockchip/rknn_model_zoo`** (289 MB) and **`radxa/rknpu2`** (294 MB, last push 2022): NPU inference is not in the plan; a CPU QR decoder is enough. No QR model exists in the zoo.
- **`espressif/esptool`**, **`platformio/platformio-core`**: tools we install from a package manager, not reference code.
- **`coinbase/agentkit`**: Base-centred; sponsors are Arc, 0G, World.
- **`AliAkrami1375/esp32-hdwallet`** and the copy under another account: unclear provenance.
- **`worldcoin/world-id-starter`**: archived 2024, World ID 3.0 legacy (we already have `world-id-protocol`).
- **`swiftbotlab/usdc-meter`** ("built with Arc Studio"): repo returns 404.
- **x402 on ESP32:** `nodestark/mdb-esp32-cashless` (already cloned) has an open pull request #78 adding an x402 payment rail. It lives on a PR branch, not in the default clone.
- **Arc Studio:** no official template repo was found. The Arc Studio build must start in Studio itself.

## Radxa Zero 3W facts, read from the cloned docs (verified, not recalled)

- **microSD slot exists**, on the underside; Radxa lists a microSD of **at least 8 GB** as the boot disk (`getting-started/preparation.md`). eMMC is a separate option.
- **Maskrom (ZERO 3W):** remove microSD and power, hold the Maskrom button on the back, connect USB-A-to-USB-C to the PC; the power LED stays on. The OTG port is the USB-C data port.
- **Flash over Maskrom:** `rkdeveloptool db <loader>` then `wl 0 <image>` (image decompressed first). Loader: `rk356x_spl_loader_ddr1056_v1.12.109_no_check_todly.bin` from `https://dl.radxa.com/rock3/images/loader/`.
- **CSI connector:** 4-lane, **22-pin, 0.5 mm**. Schematic: **pin 1 = GND, pin 22 = VCC_3V3** (through a ferrite bead, 1 uF cap), pins 23/24 GND. Supported cameras: Pi Camera V1.3 (OV5647), Pi Camera V2 (IMX219), Radxa Camera 8M (IMX219). Enable the overlay with `rsetup`, then reboot. The docs warn to check the cable direction.
- Radxa's camera page shows the cable going from the camera to the connector but does not state which ribbon face is up. Do not guess it.

## Incident log (bench session, 2026-11-05)

1. Radxa on a shared USB-C hub with the **camera ribbon attached**: board got very hot and smelled burnt. Cooled, no visible damage.
2. Direct to the Mac **without** the camera: board is slightly warm and enumerates as a Rockchip Maskrom device (USB `2207:350a`), i.e. alive, no bootable OS.
3. Camera attached again: power LED fades and the chip heats immediately.

Reading: the fault follows the camera, its ribbon or the connector, not the board's power path. A ribbon fitted the wrong way round puts pins 1 and 22 (GND and 3V3) on each other, which is a direct short of the camera rail. Not confirmed: the actual cause. Keep the camera off until the cable, orientation and camera module have been identified, and the connector shows no short with a multimeter (unpowered).

## Open

- Which camera module is on the ribbon, and is it the Pi-Zero type "Standard to Mini" cable (label seen: `Camera Cable Standard - Mini / 500mm`)?
- Does the duck brain need NPU vision at all? If yes, revisit `rknn_model_zoo`.
