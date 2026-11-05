# Spike S2: our own x402 ERC-7710 facilitator on Arc (grant path)

**2026-11-06.** Plan v3.1 §5 spike S2, simulation half. Script: `spikes/s2-facilitator-spike.ts.txt` (facilitator + harness,
rerun instructions in its header). Scratch workspace: `~/code/eth-global-mumbai-2026-spikes/s2-facilitator`.
No transaction was broadcast. No funds, no testnet: every Arc call is `eth_call` / `eth_estimateGas` against live
mainnet state (chain 5042, `https://rpc.mainnet.arc.io`) with state overrides.

## What was proven

A facilitator we wrote (~125 lines, viem + the MetaMask kit's codecs) takes the x402 `exact`/`erc7710` payload
`{delegationManager, permissionContext, delegator}` and settles it. The payment is a voucher the chip signs, under a
grant the owner's passkey signs, and the facilitator simulates it **from the relayer EOA** against live Arc state.
Everything is enforced by the deployed DF contracts on Arc mainnet:

- owner = passkey-only `HybridDeleGator` through `SimpleFactory` (software P-256 authenticator, as in the wallet spike);
- grant = owner → chip EOA with `ValueLte(0)`, `ERC20PeriodTransfer(USDC, 5 USDC per day)`, `AllowedTargets(USDC)`,
  `AllowedMethods(transfer)` and `Timestamp(expiry +7 d)`. The passkey signature is 544 B;
- leaf = chip → `ANY_DELEGATE`, using C1's `build_leaf` caveats (`AllowedTargets`, `AllowedMethods`, `ValueLte`,
  `ExactExecution(USDC.transfer(merchant, 1.50))`, `Id(invoiceHash)`, `Timestamp`, `LimitedCalls(1)`) plus
  `Redeemer(relayer)`. The leaf the chip builds is byte-identical to the kit's `createOpenDelegation` output (same hash);
- the happy path is valid. `settle()` in simulation mode returns the exact tx it would send. All 13 negative and control
  cases fail with the expected enforcer revert reason. The script exits 0 with "ALL CASES PASSED" on three consecutive runs.

The chip here is a **virtual chip** (a viem EOA in the script) that signs the C1 leaf format. The Radxa was not used.
C1 already showed the real chip produces this format, with an identical delegation hash and EIP-712 digest.

## Method: why `eth_call` and not an anvil fork

- `anvil --fork-url https://rpc.mainnet.arc.io` (anvil 1.8.3) can read Arc USDC: `balanceOf` returns the native
  balance correctly. **It cannot move it:** `USDC.transfer` reverts. The trace shows the call into Arc's native-coin
  precompile `0x1800…0000` (`transfer(from, to, amount·10¹²)`) failing with `OpcodeNotFound`, because plain anvil
  does not have Arc's precompiles. The same transfer on live Arc with a balance override succeeds. That rules out a
  plain anvil fork for any payment test; `arc-anvil` (Arc's Foundry fork) was not tried.
- **Fallback, as in the wallet spike:** `eth_call` plus state overrides on live Arc. Two changes from the wallet spike:
  1. **The owner is pre-deployed by override.** anvil deploys it on a fork (this involves no USDC). The script reads its code
     and 6 storage slots with `debug_traceTransaction` (prestateTracer, diffMode) and injects them into every live-Arc call,
     together with a 50 USDC native balance. The facilitator's simulation is then a real
     `eth_call(from: relayer EOA, to: DelegationManager, redeemDelegations(...))`. That is the tx it would send, and
     `eth_estimateGas` measures exactly that tx.
  2. **History is simulated with a prelude.** For replay, cumulative cap and revocation, earlier transactions have to
     have happened. The simulation overrides the relayer address's code with Multicall3's code and runs
     `[earlier txs..., the settle tx]` in one call. `msg.sender` is still the relayer for every call, so `Redeemer`
     holds.
- Time travel uses `eth_call` block overrides (`time`); Arc's RPC honours them.
- Arc's public RPC returns "method not supported" for `eth_simulateV1` and `debug_traceCall`. So **logs cannot be
  observed**: no `UsedId` log, and no check of EIP-7708's two `Transfer` logs. viem's `retryCount: 12` plus a pause of
  about 1.2 s between cases was enough to stay under the throttle.

## The facilitator (`verify` / `settle`)

`verify(payload, requirements)` runs every check and always runs the simulation, unless the manager is unknown. It
reports both, so a bad payload is rejected off-chain and the enforcer's reason is recorded as well.

1. `scheme == exact`, `network == eip155:5042`, `assetTransferMethod == erc7710`; `accepted` equals the requirements.
2. `delegationManager` is on the allowlist (the canonical DF DM `0xdb9B…7dB3`). If not, the payload is refused and **not
   simulated**, as in Fireblocks' `Erc7710Mechanism`.
3. `decodeDelegations(permissionContext)` decodes leaf → root. Then:
   - `root.delegator == payload.delegator`, and `root.authority == ROOT_AUTHORITY`;
   - links: each `authority` is the parent's hash, and each `delegator` is the parent's `delegate`;
   - the leaf's `delegate` is `ANY_DELEGATE` or the relayer.
4. Leaf binding:
   - the `ExactExecution` (or `ExactCalldata`) terms equal `USDC ‖ 0 ‖ transfer(payTo, amount)`, built from the requirements;
   - `IdEnforcer == extra.invoiceHash`;
   - `Redeemer` contains our relayer;
   - `Timestamp` is present and not expired;
   - the invoice has not already been settled by this facilitator (a local guard; Arc's `IdEnforcer` is the real one);
   - the chip's ECDSA leaf signature recovers to `leaf.delegator` (off-chain).
5. Simulation: `eth_call` from the relayer, 1.5 M gas cap, followed by `eth_estimateGas`. Revert data is decoded with
   the kit's `decodeRevertData`.

`settle(payload, requirements, "simulate" | "send")` re-verifies, then builds the transaction:
- `to = DM`, gas limit = 1.2 × the estimate;
- `maxFeePerGas = 40 gwei`, `maxPriorityFeePerGas = 1 gwei` (Arc drops anything below the 20 gwei floor).

In `simulate` mode it returns that tx with the gas estimate and the cost at the floor. `send` mode
(`sendTransaction` + receipt) is written but **not exercised**: no anvil fork that can move USDC, and no broadcast.

## Results (run 2026-11-06, live Arc state)

| # | Case | Off-chain checks | Simulation on Arc (revert reason) | Result |
|---|---|---|---|---|
| H1 | Voucher as signed, 1.50 USDC to merchant | all pass | ok, gas 663,241 | ✅ valid; `settle` returns the tx |
| N1 | Wrong amount: settle 2.00 for a 1.50 voucher | `accepted == requirements`, `ExactExecution` mismatch | `ExactExecutionEnforcer:invalid-execution` | ✅ rejected |
| N2 | Wrong payee (`0x…dEaD`) | same two | `ExactExecutionEnforcer:invalid-execution` | ✅ rejected |
| N3 | Replay: same voucher after one settle | `invoice not already settled here` | `IdEnforcer:id-already-used` | ✅ rejected |
| N3b | Replay with a **new** leaf (other salt, fresh chip signature) for the paid invoice | `invoice not already settled here` | `IdEnforcer:id-already-used` | ✅ rejected: one payment per invoice even if the chip signs twice |
| N4 | Expired voucher (block time = leaf expiry + 1) | `Timestamp … not expired` | `TimestampEnforcer:expired-delegation` | ✅ rejected |
| N4b | Expired **grant** (time = grant expiry + 1, leaf still valid) | none (not checked off-chain) | `TimestampEnforcer:expired-delegation` | ✅ rejected by Arc only |
| N5 | Over the cap: one 6.00 voucher against 5/day | none | `ERC20PeriodTransferEnforcer:transfer-amount-exceeded` | ✅ rejected |
| N5b | Over the cap cumulatively: 3 × 1.50 settled, 4th 1.50 | none | `ERC20PeriodTransferEnforcer:transfer-amount-exceeded` | ✅ rejected |
| N5c | Control: 3rd 1.50 of the day (4.50 ≤ 5.00) | all pass | ok | ✅ valid |
| N6 | Revoked grant: the owner's one-time `disableDelegation(grant)` (passkey → relayer, `ExactExecution` + `LimitedCalls` + `Redeemer`) settled first | none | `CannotUseADisabledDelegation()` | ✅ rejected |
| N7 | Another relayer (front-runner) submits the voucher | `Redeemer includes relayer` | `RedeemerEnforcer:unauthorized-redeemer` | ✅ rejected |
| N8 | Tampered chip signature | signature does not recover to the chip | `InvalidEOASignature()` | ✅ rejected |
| N9 | Unknown `delegationManager` in the payload | DM not allowlisted | not simulated (refused) | ✅ rejected |

Over-cap, expiry of the grant and revocation are invisible to the off-chain checks. Only the simulation catches them,
so `/verify` must never skip it.

## Gas and cost

`eth_estimateGas` for the settle tx, from the relayer EOA, on live Arc state. Arc `eth_gasPrice` was 20.001 gwei.
1 gas at 20 gwei costs 2×10⁻⁸ USDC.

| Transaction | Gas | USDC at 20 gwei |
|---|---|---|
| **Settle: 2 hops (passkey grant with 5 caveats + chip leaf with 8)** | **663,241** | **0.0133** |
| Same, leaf without `Redeemer` | 640,202 | 0.0128 |
| Leaf trimmed to `ExactExecution`, `Id`, `Timestamp`, `Redeemer` (4 caveats), same grant | 553,918 | 0.0111 |
| Trimmed leaf + grant with only `ValueLte`, `ERC20Period`, `Timestamp` | 504,804 | 0.0101 |
| Owner one-time action (1 hop, WebAuthn root, 3 caveats: the revoke) | 427,876 | 0.0086 |
| Plain `USDC.transfer` from a funded EOA, for scale | 74,609 | 0.0015 |
| Owner deploy via `SimpleFactory` (anvil fork `gasUsed`, once at signup) | 259,722 | 0.0052 |

- **A payment costs about $0.013, two to three times the plan's figure.** `plan.md` §2.3 says "$0.004–0.008" and
  `merchant-and-agent-commerce.md` estimates "150–250k gas".
- The cross-check with the wallet spike's method agrees: a Multicall3 estimate of [deploy + settle] minus [deploy] is
  609k gas. The wallet spike's 316k was for a 2-hop chain with one caveat per hop.
- What drives the cost:
  - **The WebAuthn verification of the root.** A 1-hop owner action alone is 428k gas. The P-256 check itself is cheap:
    the RIP-7212 precompile at `0x…0100` is live on Arc and returns `1`, and DF's `P256SCLVerifierLib` uses it. The
    rest is DM work and WebAuthn parsing in Solidity.
  - About 13 cold enforcer calls with their storage writes (`Id`, `LimitedCalls`, `ERC20Period`).
  - Calldata is 5,028 B; at 4/16 pricing that is only about 31k gas.
- The four leaf caveats that duplicate others (`AllowedTargets`, `AllowedMethods`, `ValueLte` and `LimitedCalls`, already
  covered by `ExactExecution` and `Id`) cost about 110k gas, about $0.002 per payment. Dropping them would need a change
  to the chip's `build_leaf`.
- A 7702 owner with an ECDSA root was about 180k for 1 hop in the wallet spike. That is the only way to a big cut.
- The `permissionContext` is 4,544 B: the 544 B WebAuthn signature plus the caveat terms, ABI-encoded. As hex inside
  base64 JSON, the x402 `PAYMENT-SIGNATURE` header comes to about 12 KB.

## Still unproven

- **A real broadcast.** Nonce handling and the 20 gwei floor on a sent tx; real `gasUsed` against the estimate (the
  facilitator sets a 1.2× limit); the receipt; the `UsedId` log and the two EIP-7708 `Transfer` logs (6-decimal from
  `0x3600…`, 18-decimal system log). Plan S2's "$0.01 real" step is still open, and so is `settle("send")`.
- **The x402 HTTP envelope.** Not tested: `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`, `/supported`
  with `extra.facilitators`, the `@metamask/x402` client and server scheme talking to our facilitator, header size limits
  (Workers, proxies), and the `payment-identifier` echo.
- **The Circle path** (S2b float: pull to the chip, then EIP-3009 through Circle's facilitator). Out of scope here.
- **The real chip, a real-device passkey, and a facilitator running in a Worker or DO** (not as a script). A funded owner
  rather than an override. Concurrency: two settles racing for the same invoice (Arc would revert the second, at a gas cost).
- **A grant expiry vs leaf expiry precheck.** The facilitator does not yet check the root `Timestamp` or the period cap
  off-chain. The simulation catches both.

## Known / Uncertain / Unknown

| Item | Status | Evidence |
|---|---|---|
| Our facilitator verifies and simulates an `exact`/`erc7710` payload (passkey grant → chip leaf) from the relayer EOA | **Known** | H1, on live Arc state |
| Each failure mode reverts with the enforcer's own reason: amount/payee (`ExactExecution`), replay (`Id`), expiry of leaf and grant (`Timestamp`), cap per payment and per day (`ERC20Period`), revocation (`CannotUseADisabledDelegation`), other redeemer, bad signature | **Known** | N1–N8 |
| `IdEnforcer` makes an invoice payable once, even if the chip signs a second leaf | **Known** | N3b |
| Plain anvil forks cannot test Arc USDC payments (missing `0x1800` precompile); `eth_call` + overrides can | **Known** | step 0 trace |
| Arc's public RPC lacks `eth_simulateV1` and `debug_traceCall`, so logs cannot be seen in simulation | **Known** | probe |
| Settle gas ≈ 663k (≈ $0.013) with this caveat set; ≈ 505k with redundant caveats removed | **Known** (estimate) | §Gas |
| Real `gasUsed`, inclusion at 20–40 gwei, receipt logs (`UsedId`, EIP-7708 pair) | **Uncertain**: one real $0.01 settle settles it | — |
| `arc-anvil` (Arc's Foundry fork) can replace overrides for stateful tests and the `send` path | **Uncertain** | not tried |
| The ~12 KB `PAYMENT-SIGNATURE` header passes Cloudflare Workers and the client stack | **Uncertain** | not tried |
| `@metamask/x402` client and server interop with our `/verify` and `/settle` | **Uncertain** | not tried |
| Who pays relayer gas at about 0.9% of a 1.50 payment (absorb, or a fee leg counted against the grant) | **Unknown**: product decision | — |
| Whether to drop the redundant leaf caveats (saves ~$0.002 per payment; needs a chip `build_leaf` change) | **Unknown**: decision | §Gas |
