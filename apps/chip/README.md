# Vitaquack chip client (`@ethmumbai/chip`)

The robot's chip: it holds the robot's secp256k1 key, long-polls the app for sign requests, checks every request against
its own policy and only then signs the one-time payment voucher (a delegation leaf) with viem. The same code runs as the
**mock chip** on a laptop and on the duck's **Radxa Zero 3W** (spec §8). Nothing in the Worker changes for hardware.

```sh
bun apps/chip/src/main.ts --server <URL> [--pair CODE] [--state DIR] [--local-port N]
```

| Flag             | Meaning                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--server`       | The app origin, e.g. `https://vitaquack.com` (only the origin is used). Every invoice the chip signs must live under it: `invoice.url == <origin>/api/i/<id>`.                |
| `--pair CODE`    | The 8-character code from the wallet's **+ Robot** (`/app/wallet/robots`) (valid 10 minutes, single use). Omit it on later starts: `pairing.json` remembers the robot.        |
| `--state DIR`    | State directory, default `~/.vitaquack-chip`.                                                                                                                                 |
| `--local-port N` | Optional, off by default: the scan listener `POST http://127.0.0.1:N/scan`, bound to 127.0.0.1 only (see below). The Worker answers 404 unless `APP_SCANS_ENABLED` is `true`. |

## State directory (created 700)

| File                 | Content                                                                                                                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key.json`           | `{"privateKey":"0x…"}`, generated once, **mode 600** (an existing file is tightened to 600 on start). Never printed, never copied off the chip (decisions: the key is generated on the duck's brain and never leaves it); only the address leaves. Lost key = add a new robot and grant again. |
| `pairing.json`       | `{server, robotId, chipToken}`; the chip token is the bearer for poll/responses (the Worker stores only its SHA-256).                                                                                                                                                                          |
| `used-invoices.json` | invoice hashes already signed (replay guard).                                                                                                                                                                                                                                                  |
| `spent.json`         | `{day, total}`: USDC base units signed in the current UTC day.                                                                                                                                                                                                                                 |

Delete `pairing.json` to pair again (a robot's code works once; a revoked robot answers 401). Keep `key.json`: the
grant's delegate is this address.

## Scan listener (`--local-port N`)

The camera process on the same board posts the QR crop it read. The chip refuses to sign more than a JPEG crop of at most
64 KB (spec rule 4: no scene frames leave the chip). It computes the crop's SHA-256 and signs, EIP-191 with its key,
`vitaquack-scan:v1|<invoiceId>|<0x sha256>|<capturedAt ms>|<robotId>`. It then posts
`{invoiceId, capturedAt, frame: {mime, sha256, bytes, b64}, sig}` to `POST <server>/api/chips/<robotId>/scans` with its
chip token, and answers with the Worker's status and JSON.

```sh
curl -s http://127.0.0.1:8787/scan -H 'content-type: application/json' \
  -d "{\"invoiceId\":\"<invoiceId>\",\"jpegBase64\":\"$(base64 -w0 crop.jpg)\",\"capturedAt\":$(date +%s%3N)}"
# 201 {"episodeId":"…","state":"signing","observationId":"…"}
```

The gate's QR carries `vq1:<invoiceId>`: send the id after `vq1:`. `capturedAt` (unix ms) is optional; the chip's
clock is used when it is absent, and the Worker accepts ±120 s. Local 400s (never signed):
`expected {"invoiceId", "jpegBase64", "capturedAt"?}`, `jpegBase64 is not base64`, `crop is larger than 64 KB`,
`crop is not a JPEG`. Answers 502 when the Worker does not answer within 60 s. Every other status is the Worker's own
(`docs/hardware-handoff.md`). Repeating a scan of the same invoice gets 200 with the same errand. The crop is stored
owner-private in R2 and never sent to 0G; the episode evidence carries only its hash and the chip's signature.

## Log lines (one per event)

| Line                                                     | Meaning                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `chip 0x… (new key)`                                     | started; the address the owner grants to (`(new key)` on the first run).                                              |
| `paired <robotId>`                                       | `POST /api/chips/pair` accepted (EIP-191 proof of the key).                                                           |
| `lease ok`                                               | a poll succeeded after the chip had no lease (first poll, or after a STOP).                                           |
| `signed <invoiceId>`                                     | every policy check passed; the leaf was signed and the spend recorded.                                                |
| `refused <invoiceId> <code>: <detail>`                   | a policy check failed; the key was not touched.                                                                       |
| `payment settled 0x<tx>` / `payment failed: <reason>`    | the Worker's answer after it settled (or not) on Arc.                                                                 |
| `STOP motors (lease expired)`                            | no successful poll for 35 s: stop moving; every request is answered `no_lease` until the next good poll (`lease ok`). |
| `poll failed: …`                                         | first network error of a streak (retries every 2 s, silently).                                                        |
| `chip token rejected (401): pair again with --pair CODE` | the robot was revoked or re-paired: exits.                                                                            |
| `pairing refused (404\|409\|401): …`                     | unknown/expired code, code already used or chip already paired, or a bad signature.                                   |
| `scan listener on http://127.0.0.1:N/scan`               | `--local-port N` given: the scan listener is up.                                                                      |
| `scan <invoiceId> 0x<first 8 hex>… → <status>`           | a scan was signed and forwarded; the Worker's status (201 new errand, 200 repeat, 4xx refused).                       |
| `scan failed: …`                                         | the Worker did not answer the forwarded scan (the listener answered 502).                                             |

## Policy (spec §8, in this order, before the key is used)

`no_grant` (the grant is not addressed to this chip, not our caveat shape, or expired) · `wrong_network` (not chain
5042 / not the DelegationManager `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`) · `wrong_asset` (not Arc USDC
`0x3600…0000`) · `over_per_payment_cap` (amount 0, or above the per-payment cap without a valid approval) ·
`over_daily_cap` (above what is left today, approval or not: Arc's period cap applies anyway) · `payee_not_allowed`
(payee off the allowlist without a valid approval) · `bad_invoice_origin` · `invoice_expired` · `expiry_too_far` (more
than 15 minutes ahead) · `replayed_invoice` · `leaf_mismatch` (the invoice hash or the leaf the server sent is not the one
the chip derives from the invoice) · `no_lease`.

Limits come from the grant's signed caveat terms, not the server's mirror fields. An approval counts only when it is for
this invoice hash, payee and amount, unexpired, and signed by the approver named in the grant. A grant with only the
three stock caveats (no RobotPaymentPolicyEnforcer yet) takes the per-payment cap and allowlist from the request,
never above 2 USDC.

## On the Radxa (linux-arm64)

The venue Wi-Fi moved about 3 KB/s at the bench (H4), so do not install anything over it: use the phone hotspot, or
copy a single file from the Mac.

**Option A, one file, no Bun on the Radxa (preferred):** on the Mac, from the repo root,

```sh
bun build --compile --target=bun-linux-arm64 apps/chip/src/main.ts --outfile vitaquack-chip   # ≈ 110 MB, verified to build
scp vitaquack-chip radxa@radxa-zero3.local:~/
ssh radxa@radxa-zero3.local './vitaquack-chip --server https://<app origin> --pair <CODE>'
```

**Option B, Bun on the Radxa:** `curl -fsSL https://bun.sh/install | bash` (needs a real network), then copy a 0.6 MB
bundle: `bun build apps/chip/src/main.ts --target bun --outfile chip.js` on the Mac, `~/.bun/bin/bun chip.js --server …`.

Run it under the robot's own user so `~/.vitaquack-chip` stays private; for a permanent start use a user systemd unit
with `Restart=always` (the lease makes a restart safe: motors stop, then resume on `lease ok`).

**Python fallback** (bench C1, `docs/research/spikes/radxa-voucher-spike-chip_voucher.py.txt` with
`radxa-wallet-spike-chip.py.txt`): it proved the chip can hash the invoice and sign a leaf Arc accepts, but it speaks
the bench protocol. To point it at the same endpoints it needs: (1) pairing: `personal_sign` of
`Vitaquack pair <CODE> <address lowercase> 5042` → `POST /api/chips/pair {pairingCode, address, sig}`; (2) the loop
`GET /api/chips/<robotId>/poll` with `Authorization: Bearer <chipToken>` and `POST /api/chips/<robotId>/responses`;
(3) the spec's leaf, not the spike's: caveats ExactExecution(USDC ‖ 0 ‖ transfer(payTo, amount)) · Id(invoiceHash) ·
Timestamp(0, expiresAt) · Redeemer(relayer), salt = `keccak256(invoiceHash)` as a uint256, authority = the grant's
delegation hash, delegate `0x…0a11`; (4) the invoice hash from `linesHash`/`rulesHash` as sent (the request carries the
hashes, not the lines). Its pure-Python recovery took 187 ms per signature (H3); fine for a payment, slow for a benchmark.

## Tests

`apps/chip/test/policy.test.ts` (every refusal code) runs in `bun run test:unit`; the native suite runs the real CLI
against a stand-in Worker (`packages/server/test/ChipAcceptance.ts`: paired, lease ok, signed, payment settled, STOP
motors, key.json 600). It also runs the CLI against the real local Worker with `--local-port`
(`packages/server/test/ScanAcceptance.ts`: pairs, refuses a non-JPEG locally, forwards a crop → 201 `signing`).
