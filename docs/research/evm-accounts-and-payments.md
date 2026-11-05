# EVM smart accounts, session keys and offline payments (research, 2026-11-05)

What this answers: which 7702 + session-key stack to use for robot spending allowances on **Arc mainnet**
(chainId 5042), and how offline / micro / x402 payments fit. Read with `decisions.md`, `open-questions.md`
#8–9.

Method: read the code in `references/` (shallow clones, below), checked deployments with `eth_getCode` /
`eth_call` against `https://rpc.mainnet.arc.io` (returns `0x13b2`) on 2026-11-05, and used web sources
(cited inline). "Live on Arc" below means bytecode exists at that address on 5042. It does **not** prove
that the bytecode matches the repo source; verify that on the explorer before trusting funds.

## TL;DR

- **Arc is a good 7702 chain.** Osaka baseline with EIP-7702 "behave as on Ethereum"
  ([Arc EVM differences](https://docs.arc.io/arc/references/evm-differences)). The **P-256 precompile at
  `0x100` is live**: an `eth_call` with a Daimo test vector returned `1`, and the source is
  `circlefin_arc-node/crates/precompiles/src/precompile_provider.rs:72-75`. EntryPoint v0.6, v0.7, v0.8 and v0.9 are
  all deployed. **Pimlico's public bundler answers for 5042** with all four EntryPoints
  (`https://public.pimlico.io/v2/5042/rpc`).
- **Gas in USDC is not a separate problem on Arc.** Native gas *is* USDC (18 decimals), and it shares one balance with
  the ERC-20 at `0x3600…0000` (6 decimals). A relayer, a robot EOA, or a 4337 account prefund all pay gas in USDC.
  "Users never see gas" only means *someone else submits*. A paymaster is needed only if we want to
  sponsor gas inside 4337. Circle Paymaster's Base/Arbitrum addresses have **no code on Arc**.
- **MetaMask Delegation Framework v1.3.0 is already deployed on Arc**: the DelegationManager, the
  `EIP7702StatelessDeleGator` and all ~38 caveat enforcers (`broadcast/*/5042/`). It has the most audits and
  it is ERC-7710. It gives us daily (periodic) caps, expiry, revoke and target/calldata pinning out of the
  box. Through a two-hop delegation chain to `ANY_DELEGATE` it also gives **offline signing by a plain EOA robot
  key, submitted by anyone later, with the root caps checked at landing**, using only stock contracts.
- Gaps we must write ourselves (small and isolated): **per-payment ERC-20 cap**, **multi-merchant
  allowlist** (one enforcer, not N `LogicalOr` groups), **approver co-signature above $X / for restricted
  merchants**, and **passkey owner**, because the stock 7702 delegator only accepts the EOA key.
- **No stack does everything natively.** Ithaca/Porto is the only one with built-in Day/Week spend periods
  plus multisig plus WebAuthn. Porto was sunset in Aug 2026, the `account` repo has been idle since Jan 2026, and it is
  not deployed on Arc.
- **Stateful daily caps cannot be enforced through EIP-3009 / Permit2 + ERC-1271.** `isValidSignature` is
  reached via `staticcall` (`circlefin_stablecoin-evm/contracts/util/SignatureChecker.sol:43-64`,
  `Uniswap_permit2/src/libraries/SignatureVerification.sol:26-45`). It can enforce stateless rules (per-tx cap,
  allowlist, expiry) but not "spent today". Any x402 `exact`/`upto` flow paid **from the owner's 7702
  account** therefore bypasses the daily cap unless it goes through a stateful contract.
- **For guaranteed offline acceptance** (merchant offline too, merchant must know it will be paid), the only
  fit already on Arc is **x402 `batch-settlement`** (`x402BatchSettlement` at
  `0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003`, Cantina-audited Feb, Mar and May 2026). It is a per-merchant pre-funded
  channel where the robot key is `payerAuthorizer` and signs cumulative vouchers with plain ECDSA.

## Cloned repos

All live under `references/` (git-ignored; shallow, `GIT_LFS_SKIP_SMUDGE=1`). Commit = clone HEAD on
2026-11-05. `references/README.md` was **not** updated: only this note was allowed to change. Copy the rows
there if wanted.

| Path | Upstream | Commit (date) | Licence | Why | Read first |
|---|---|---|---|---|---|
| `MetaMask_delegation-framework` | https://github.com/MetaMask/delegation-framework | `b4b8c41` (2026-10-22) | Apache-2.0 / MIT | **Primary candidate.** ERC-7710 delegations, 7702 delegator, caveat enforcers; v1.3.0 live on Arc | `src/DelegationManager.sol:126-309` (redeem; `ANY_DELEGATE` at 155, 1271 vs ECDSA at 163-180, chain check 184-203), `src/EIP7702/EIP7702StatelessDeleGator.sol:54-58`, `src/EIP7702/EIP7702DeleGatorCore.sol` (execute 180-278, 4337 287-299, prefund 504-511), `src/enforcers/ERC20PeriodTransferEnforcer.sol`, `AllowedCalldataEnforcer.sol`, `TimestampEnforcer.sol`, `ExactExecutionEnforcer.sol`, `IdEnforcer.sol`, `RedeemerEnforcer.sol`, `ValueLteEnforcer.sol`, `LogicalOrWrapperEnforcer.sol`, `src/HybridDeleGator.sol` (P256 pattern), `documents/Deployments.md`, `audits/` |
| `zerodevapp_kernel` | https://github.com/zerodevapp/kernel | `c960b42` (2026-10-03) | MIT (SPDX; no repo licence file) | Kernel v4 (released 2026-10-05) with a dedicated 7702 contract; per-permission nonce spaces | `src/Kernel7702.sol:14-33`, `src/core/ValidationManager.sol:462-467` (per-policy sig slot), `releases/v0.4.0.json` |
| `zerodevapp_kernel-7579-plugins` | https://github.com/zerodevapp/kernel-7579-plugins | `332deed` (2026-04-21) | MIT | Signers and policies. v3 CallPolicy, TimestampPolicy and RateLimit were removed from master; see commit `00746ff` | `src/signers/WeightedECDSASigner.sol:59-82`; at `00746ff`: `CallPolicy.sol:120-175`, `TimestampPolicy`, `RateLimitPolicyReset` |
| `erc7579_smartsessions` | https://github.com/erc7579/smartsessions | `f5aaf86` (2025-08-04) | AGPL-3.0 (SPDX) | Rhinestone Smart Sessions (7579 validator, used by Nexus and Safe7579) | `contracts/SmartSession.sol:99-112`, `contracts/external/policies/{ERC20SpendingLimitPolicy,UniActionPolicy,ArgPolicy,TimeFramePolicy,UsageLimitPolicy,ValueLimitPolicy}.sol`, `audits/` |
| `bcnmy_nexus` | https://github.com/bcnmy/nexus | `9007ba1` (2026-08-07) | MIT | Nexus 1.2.1, 7702-capable 7579 account | `contracts/Nexus.sol:305-333` (7702 init), `contracts/lib/NonceLib.sol`, `audits/` |
| `alchemyplatform_modular-account` | https://github.com/alchemyplatform/modular-account | `ab9c0c2` (2025-12-18) | GPL-3.0 | MAv2 `SemiModularAccount7702`, live on Arc | `src/account/SemiModularAccount7702.sol:31-61`, `src/modules/permissions/{AllowlistModule,NativeTokenLimitModule,TimeRangeModule}.sol`, `deployments/v2/Deployments.md` |
| `OpenZeppelin_openzeppelin-contracts` | https://github.com/OpenZeppelin/openzeppelin-contracts | `efaa6f7` (2026-11-02) | MIT | 5.7 Account building blocks to write our own 7702 account (if the Arc Studio route wins) | `contracts/account/Account.sol`, `contracts/utils/cryptography/signers/{SignerEIP7702,SignerWebAuthn,SignerP256,MultiSignerERC7913Weighted}.sol`, `contracts/account/utils/draft-ERC4337Utils.sol`, `PaymasterERC20.sol`, `audits/2026-02-v5.6.pdf` |
| `Vectorized_solady` | https://github.com/Vectorized/solady | `258f67c` (2026-10-20) | MIT | Gas-lean P256/WebAuthn libs, `EIP7702Proxy`, ERC7821 | `src/utils/P256.sol`, `src/utils/WebAuthn.sol`, `src/accounts/{EIP7702Proxy,LibEIP7702,ERC4337,ERC7821}.sol` |
| `Uniswap_calibur` | https://github.com/Uniswap/calibur | `3f16977` (2026-10-21) | MIT | **Fallback candidate.** Singleton 7702 wallet, live on Arc, native WebAuthn/P256 keys, per-key expiry and hooks, relayed `SignedBatchedCall` | `src/Calibur.sol` (137 expiry, 157 root, 246-247 relayed exec), `src/libraries/{KeyLib,SettingsLib,SignedBatchedCallLib}.sol`, `src/interfaces/IValidationHook.sol:19-33`, `src/hooks/example/GuardedExecutorHook.sol` (unaudited), `audits/` |
| `ithacaxyz_account` | https://github.com/ithacaxyz/account | `767e973` (2026-01-04) | MIT | Porto account: the reference design for per-key Day/Week spend limits, call checkers and multisig. **Sunset**; read only for patterns | `src/GuardedExecutor.sol` (SpendPeriod 38-46, setSpendLimit 420, accounting 217-311, reset 589), `src/MultiSigSigner.sol:42-93`, `src/IthacaAccount.sol`, `src/Orchestrator.sol` |
| `coinbase_spend-permissions` | https://github.com/coinbase/spend-permissions | `e0004e6` (2026-03-24) | MIT | Periodic allowance primitive (live on Arc) | `src/SpendPermissionManager.sol:29-48,246-249,516-553,730-766`, `src/SpendRouter.sol:98-106` |
| `base_eip-7702-proxy` | https://github.com/base/eip-7702-proxy | `80a4cd2` (2026-07-14) | MIT | Coinbase's safe 7702 upgrade-to-CBSW proxy (live on Arc) | `src/EIP7702Proxy.sol:74-140`, `src/NonceTracker.sol` |
| `eth-infinitism_account-abstraction` | https://github.com/eth-infinitism/account-abstraction | `1c6b669` (2025-12-17) | GPL-3.0 | EntryPoint 0.9 reference, `Simple7702Account`, reference paymasters | `contracts/core/EntryPoint.sol`, `contracts/accounts/Simple7702Account.sol` |
| `x402-foundation_x402` | https://github.com/x402-foundation/x402 | `6a773db` (2026-11-05) | Apache-2.0 | x402 specs and SDK (Linux Foundation since 2026-04). Schemes `exact`, `upto`, `batch-settlement`, `auth-capture`; Arc is in default assets | `specs/schemes/*/scheme_*_evm.md`, `contracts/evm/src/x402BatchSettlement.sol`, `typescript/packages/mechanisms/evm/src/shared/verifySignature.ts:136-160`, `.../defaultAssets.ts:309-326`, `contracts/evm/audits/` |
| `circlefin_stablecoin-evm` | https://github.com/circlefin/stablecoin-evm | `fc85788` (2026-08-12) | Apache-2.0 | Arc's USDC is `NativeFiatTokenV2_2`: EIP-3009 and 2612 with `bytes` signatures (ERC-1271) | `contracts/v2/NativeFiatTokenV2_2.sol`, `contracts/v2/EIP3009.sol:84-104,276-324`, `contracts/util/SignatureChecker.sol:43-64` |
| `circlefin_evm-gateway-contracts` | https://github.com/circlefin/evm-gateway-contracts | `c21d2d2` (2026-09-29) | Apache-2.0 | Gateway (unified balance, delegates, burn intents) behind Nanopayments | `src/modules/wallet/{Deposits,Withdrawals,Delegation,Burns}.sol`, `src/lib/{TransferSpec,BurnIntents}.sol` |
| `circlefin_arc-nanopayments` | https://github.com/circlefin/arc-nanopayments | `a29f920` (2026-04-04) | Apache-2.0 | Circle's x402 + Gateway batched nanopayment sample on Arc | `lib/x402.ts:23-63` |
| `circlefin_arc-node` | https://github.com/circlefin/arc-node | `6e76402` (2026-09-25) | Apache-2.0 | Ground truth for Arc precompiles, blocklist, native USDC | `crates/precompiles/src/precompile_provider.rs:72-75`, `native_coin_authority.rs`, `native_coin_control.rs`, `call_from.rs`, `crates/execution-validation/src/denylist.rs`, `assets/mainnet/genesis.json` |
| `Uniswap_permit2` | https://github.com/Uniswap/permit2 | `cc56ad0` (2023-09-29) | MIT | SignatureTransfer + witness (x402 `upto`); canonical on Arc | `src/SignatureTransfer.sol:32-150`, `src/libraries/SignatureVerification.sol:26-45` |
| `daimo-eth_p256-verifier` | https://github.com/daimo-eth/p256-verifier | `607d3ec` (2024-05-31) | MIT | Fallback P256 verifier (also deployed on Arc at `0xc2b78104907F722DABAc4C69f826a522B2754De4`); test vectors | `src/P256.sol`, `src/WebAuthn.sol`, `test-vectors/` |

Not cloned, but read or referenced: [MetaMask/smart-accounts-kit](https://github.com/MetaMask/smart-accounts-kit)
(viem toolkit; 7715 types; `delegation-deployments` lists `arcMainnet`),
[zerodevapp/sdk](https://github.com/zerodevapp/sdk), [rhinestonewtf/module-sdk](https://github.com/rhinestonewtf/module-sdk),
[pimlicolabs/permissionless.js](https://github.com/pimlicolabs/permissionless.js), [wevm/viem](https://github.com/wevm/viem)
(huge), [base/webauthn-sol](https://github.com/base/webauthn-sol) (covered by OZ and Solady),
[thirdweb-dev/contracts](https://github.com/thirdweb-dev/contracts) (**archived**), and
[ithacaxyz/porto](https://github.com/ithacaxyz/porto) (**archived 2026-08-19**). `coinbase_x402` in `references/` was cloned by
someone else; it is the older home of x402.

## Arc facts that shape the design (verified 2026-11-05)

| Fact | Evidence |
|---|---|
| EIP-7702 supported, Osaka baseline | [docs.arc.io EVM differences](https://docs.arc.io/arc/references/evm-differences) |
| USDC: native 18-dec + ERC-20 `0x3600000000000000000000000000000000000000` 6-dec, **one balance** | same page; [contract addresses](https://docs.arc.io/arc/references/contract-addresses); `NativeFiatTokenV2_2.sol` |
| USDC EIP-712 domain `name="USDC"`, `version="2"`; 3009 (vrs + bytes), 2612, `cancelAuthorization` present | `eth_call name()/version()`, selector scan of impl `0xc6ad664a…3ca6` |
| P256VERIFY at `0x100` live | `eth_call` returned `…01` for a valid vector and `0x` for an invalid one |
| EntryPoint 0.6 `0x5FF1…2789`, 0.7 `0x0000…a032`, 0.8 `0x4337…f108`, 0.9 `0x4337…D009` live | `eth_getCode` |
| Pimlico bundler supports 5042 | `eth_supportedEntryPoints`, `pimlico_getUserOperationGasPrice` OK; unknown chain IDs are rejected |
| Permit2, Multicall3, Arachnid CREATE2 and Safe singleton factory live | contract addresses page and `eth_getCode` |
| Min base fee 20 gwei (lower ⇒ silently dropped); base fee not burned; instant finality; runtime **blocklist** (transfers to/from listed addresses revert); `PREVRANDAO=0` | EVM differences page; `arc-node` denylist |
| Native-value sends to contracts "aren't guaranteed to succeed" ⇒ **move money via the ERC-20 `transfer`, not `value`** | EVM differences page |
| ERC-8004 Identity, Reputation and Validation registries live on Arc mainnet (`0x8004A169…a432` etc.) | contract addresses page (optional robot identity) |
| Circle Gateway on Arc: GatewayWallet `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`, GatewayMinter `0x2222222d…C205` | contract addresses page |

**Deployed on Arc 5042 (code present):** MetaMask DF v1.3.0 (DelegationManager
`0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`, EIP7702StatelessDeleGator `0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B`,
ERC20PeriodTransferEnforcer `0x474e3Ae7E169e940607cC624Da8A15Eb120139aB`, and all enforcers in `documents/Deployments.md`);
Kernel v3.3 7702 delegation `0xd6CEDDe84be40893d153Be9d467CD6aD37875b28`; Alchemy SemiModularAccount7702
`0x69007702764179f14F51cdce752f4f775d74E139`; Calibur `0x000000005c84F8Fd50b21CAC312528A64437030e`; Coinbase
SpendPermissionManager `0xf85210B21cC50302F477BA56686d2019dC9b67Ad` and EIP7702Proxy `0x7702cb554e6bFb442cb743A7dF23154544a7176C`;
x402 BatchSettlement `0x4020074e…0003`, x402 UptoPermit2Proxy `0x4020A4f3…0002`, and the x402 `auth-capture` escrow (`0xBdEA0D1b…`; address from x402 constants, not independently re-checked).
**Not deployed:** Kernel v4 Kernel7702 `0x3631…9b59`, SmartSessions (`0x00000000002B0e…37DE` and
`0x00000000008bDABA…4bDA`), Safe7579 adapter, x402 ExactPermit2Proxy `0x402085c2…0001`, Circle Paymaster.

## Candidate stacks against our policy list

Legend: ✅ stock / 🔧 small custom contract / ❌ not possible or large work.

| Need | **MetaMask DF v1.3 (7702 Stateless)** | **Calibur 1.1** | Kernel v3.3 / v4 | Nexus or Safe + SmartSessions | Alchemy MAv2 7702 | Coinbase SpendPerm + 7702Proxy | Ithaca/Porto | Own OZ 5.7 account |
|---|---|---|---|---|---|---|---|---|
| Daily cap (periodic) | ✅ `ERC20PeriodTransferEnforcer`: fixed windows from `start`, unused allowance forfeited | 🔧 hook | 🔧 (RateLimit counts calls, not amount) | 🔧 (spending limits are one-off totals) | 🔧 (one-off) | ✅ period allowance | ✅ `SpendPeriod.Day` | 🔧 |
| Per-payment cap | 🔧 ~20-line enforcer on `calldata[36:68]` (two copies of the period enforcer share storage, so that trick fails) | 🔧 hook | ✅ v3 CallPolicy arg rule | ✅ UniActionPolicy arg rule | ❌ | ❌ | 🔧 call checker | 🔧 |
| Expiry | ✅ `TimestampEnforcer` | ✅ per-key `expiration` | ✅ TimestampPolicy | ✅ TimeFramePolicy | ✅ TimeRangeModule | ✅ `end` | ✅ | 🔧 |
| Merchant allowlist (ERC-20 `to`) | ✅ for one merchant (`AllowedCalldata`); several merchants via `LogicalOrWrapper` or 🔧 one set-enforcer | 🔧 hook | ✅ CallPolicy ONE_OF | ✅ ArgPolicy OR | ❌ (target only) | ❌ (spender receives funds; `SpendRouter` has one fixed recipient) | 🔧 call checker | 🔧 |
| Co-signer above $X / restricted merchant | 🔧 enforcer reads approver sig from caveat `args` (args are not in the signed hash, so a relayer can attach them) | 🔧 hook gets unsigned `hookData` | 🔧 policy has its own sig slot; WeightedECDSASigner exists | 🔧 | ❌ | ❌ | ✅ MultiSigSigner (all-or-nothing, not amount-conditional) | 🔧 `MultiSignerERC7913Weighted` |
| Revoke | ✅ `disableDelegation` (1 SSTORE); `NonceEnforcer` for bulk | ✅ `revoke(keyHash)` | ✅ uninstall | ✅ remove session | ✅ | ✅ `revoke` | ✅ | 🔧 |
| Robot key | plain secp256k1 EOA (delegate) | secp256k1 key registered on the account | ECDSA signer module | ECDSA session signer | SingleSigner | spender EOA (must send tx) | secp256k1 key | any |
| **Offline signing, relayer submits** | ✅ robot signs leaf delegation to `ANY_DELEGATE` (see below) | ✅ `SignedBatchedCall{executor=0}` keyed nonces | ✅ userOp (gas fields frozen) | ✅ userOp | ✅ userOp | ❌ `spend` needs `msg.sender==spender` | ✅ Intent | 🔧 |
| Gas in USDC, user sees none | ✅ relayer pays native USDC; or 4337 via EP 0.7 + Pimlico | ✅ relayer, or EP 0.8 | ✅ EP 0.7 / 0.9 | ✅ EP 0.7 | ✅ EP 0.7 | relayer | own Orchestrator | ✅ |
| Passkey owner | 🔧 extend `EIP7702DeleGatorCore` with a P256/WebAuthn branch (pattern in `HybridDeleGator`) — **unaudited** | ✅ WebAuthnP256 key (EOA stays root) | ✅ WebAuthn validator | ✅ module | ✅ WebAuthnValidation | ✅ CBSW passkey owners (via 7702Proxy) | ✅ | ✅ SignerWebAuthn |
| ERC-7710 / 7715 | ✅ native | ❌ | partial | partial | ❌ | ❌ | ❌ | 🔧 |
| Audited | **many**: Diligence ×5, Cyfrin ×9 (2024-06 → 2026-10); stateless delegator and period enforcer in scope | Cantina 04/2025, OZ 05/2025 (pre-v1.1; example hook unaudited) | v3.3 ChainLight/Kalos; v4 ToB (report removed) | ChainLight, Cantina 08/2026 | ChainLight, Quantstamp 12/2024 | Cantina 2024-25 | individual researchers | OZ 02/2026 (library) |
| Live on Arc | ✅ full set | ✅ | v3.3 ✅ / v4 ❌ | ❌ | ✅ | ✅ | ❌ | n/a |
| Maintenance | active (2026-11-04) | active (2026-10) | active | Smart Sessions quiet since 2025-08 | low (2025-12) | low (2026-03) | **sunset** | active |

Note on Coinbase: through `EIP7702Proxy` the EOA becomes a CoinbaseSmartWallet (passkey owners supported); the spend-permission model still cannot do allowlists, per-tx caps, co-signing or relayed offline spend.

### Notes per stack (from reading code)

- **MetaMask DF.** `redeemDelegations` accepts `delegate == msg.sender || ANY_DELEGATE (0xa11)`
  (`DelegationManager.sol:155`). EOA delegators are checked with ECDSA and contract or 7702 delegators with ERC-1271
  (163-180). A chain requires `delegations[i].delegator == delegations[i+1].delegate` unless that is `ANY_DELEGATE` (193-197).
  Caveat hooks run for **every** delegation in the chain (before/after, leaf↔root, 207-296), so the owner's root
  caveats always apply. Execution happens on the root delegator via `executeFromExecutor`. The stateless delegator's
  signature check is only `ECDSA.recover(hash,sig)==address(this)` (`EIP7702StatelessDeleGator.sol:54-55`): the owner
  EOA key, no passkey. The `DelegationManager` is `Pausable` by MetaMask's owner key, which gives MetaMask a central kill switch.
  ERC-7715 `wallet_grantPermissions` in the MetaMask UI needs MetaMask Flask ≥13.5 / stable ≥13.23. We do not need it:
  we sign the delegation ourselves with `smart-accounts-kit`.
  ([docs](https://docs.metamask.io/smart-accounts-kit/), [ERC-7710](https://eips.ethereum.org/EIPS/eip-7710), [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715); both still Draft.)
- **Calibur.** Keys carry `{admin, expiration, hook}` settings (`SettingsLib.sol:11-55`) and are registered by an
  on-chain call from the account. The hook runs at validation and before and after execution and receives `hookData`
  *not* covered by the key's signature, which is exactly where an approver co-signature would go. All cap logic would be our own
  hook. The repo's `GuardedExecutorHook` is marked "unaudited… do not use in production".
- **Kernel.** Master is v4 (`Kernel7702.sol`, EP 0.9), which is **not on Arc**. The v3 policy set that does what we want
  (CallPolicy arg rules plus Timestamp) lives at plugins commit `00746ff`. v3.3's 7702 address is live on Arc.
- **SmartSessions / Nexus / Safe7579.** These have the richest policy language (UniActionPolicy, ArgPolicy), but the
  spending limits are lifetime totals, and nothing from it is deployed on Arc.
- **Ithaca.** `GuardedExecutor` has the design we want to copy: per-key, per-token spend limits with calendar
  periods. It counts `max(decoded transfer amount, balance drop)`, so both the native and the ERC-20 path are counted
  (`:217-311`). The project is dead, so treat it as a pattern only.
- **All stacks: close the native-value path.** USDC can leave as native `value` or as ERC-20 `transfer`. Cap
  native value to 0 (`ValueLteEnforcer(0)`, or a policy) whatever we pick.
- **Gas griefing.** In a 4337 design the *account* prefunds gas from the owner's USDC, outside the daily cap. A leaked
  session key can burn USDC through high `maxFeePerGas`. The MetaMask relayer path avoids this because the relayer or delegate pays
  gas. Under 4337, add a gas policy or use a paymaster we control.

## Offline payment design options

| Option | Robot offline at signing | Merchant verifies locally | Caps enforced on-chain at landing | Double-spend / merchant risk | Fits our stack |
|---|---|---|---|---|---|
| **A. Leaf delegation (MetaMask DF).** Robot signs `robot→ANY_DELEGATE` with `authority = hash(owner→robot)`, caveats `ExactExecution(USDC.transfer(merchant, amt))` + `IdEnforcer` (single use) + `TimestampEnforcer` (deadline). Merchant or our relayer submits `[leaf, root]` later | ✅ pure EIP-712 ECDSA | ✅ signature + chain; cap headroom only from a cached state | ✅ **all root caveats** (daily, per-tx, allowlist, expiry, revoke, co-sign) | Robot can sign more than the remaining cap; extra vouchers **revert** when they land, and the merchant is unpaid. A third party who sees the voucher can only pay *that* merchant *that* amount | ✅ stock contracts plus our custom enforcers |
| **B. 4337 userOp or Calibur `SignedBatchedCall` pre-signed by the session key** | ✅ (per-robot nonce key; gas fields frozen at signing) | ✅ signature only | ✅ | Same as A, plus stale gas price ⇒ stuck. Sequential nonce per key means an out-of-order submission blocks later payments (use unordered or keyed nonces) | Calibur / Kernel |
| **C. EIP-3009 `transferWithAuthorization` from the owner's 7702 account (x402 `exact`)** | ✅ random nonce, long `validBefore` | ✅ | ❌ **only stateless checks** (1271 is `staticcall`), **no daily cap** | High | ❌ for a capped robot; fine for the **owner** paying |
| **D. Permit2 witness / x402 `upto`** | ✅ (`upto` must name the facilitator) | ✅ | ❌ same 1271 limitation | High | ❌ same |
| **E. x402 `batch-settlement` channel.** The owner's account deposits into `x402BatchSettlement` (per robot×merchant channel), robot key = `payerAuthorizer`, robot signs cumulative `Voucher(channelId, maxClaimableAmount)` | ✅ | ✅ **funds are escrowed** (merchant caches the channel balance) | Escrow size is the hard cap; receiver fixed per channel; no daily or expiry rule inside | Low: payer can only pull funds after `withdrawDelay` (15 min–30 days); unclaimed vouchers do not reserve funds | ✅ live on Arc; channel funding can itself be a capped delegation |
| **F. Robot hot float.** Owner tops up a robot-owned EOA daily; robot signs plain 3009 from it | ✅ | ✅ | Float size only | Robot can overspend float; float is lost if key leaks | trivial, weakest |
| **G. Circle Gateway delegate / Nanopayments** | ✅ (3009 under the `GatewayWalletBatched` domain, ≥3-day window) | ❌ needs Circle API / TEE | ❌ no per-delegate limits; `addDelegate` is a full allowance and revoking does not void already-signed intents | Circle ledger | ❌ for robot caps; EOA only (no 1271) per [Circle docs](https://developers.circle.com/gateway/nanopayments). Good for the **merchant-side x402 story** if Arc mainnet is supported (unverified) |
| **H. Coinbase SpendPermission** | ❌ spender must send the tx | ❌ | ✅ periodic | Low | ❌ |

Recommendation for offline: **A for the demo** (it reuses the online path; one code path for online and
offline, since our relayer always submits). Mention **E** as the "merchant must be guaranteed" upgrade for recurring
merchants and micropayments (x402 batch settlement: one deposit, many vouchers, one claim).

**x402 status** ([specs](https://github.com/x402-foundation/x402/tree/main/specs/schemes)): `exact` (3009 default,
Permit2, and an ERC-7710 delegation variant for smart accounts, which fits our MetaMask DF account directly), `upto`
(Permit2 only, spec 2026-03), `batch-settlement` (merged 2026-04-15, replaced the "deferred" proposals; Dhali deferred
PR #1302 still open), `auth-capture` (commerce-payments escrow). `eip155:5042` is in the SDK default assets
(`defaultAssets.ts:309-326`). The only Arc facilitator listed is the third-party "TRDEFI Arc Facilitator"
(`docs/dev-tools/facilitators.md:40`, unvetted), so plan to **run our own facilitator** (the SDK has one) or settle directly.

## Passkeys on Arc

- Precompile `0x100` (RIP-7212 / EIP-7951) is live, so WebAuthn verification costs ~3.5k gas for P256 plus the
  WebAuthn parsing. Libraries: OZ `SignerWebAuthn` / `WebAuthn.sol`, Solady `WebAuthn.sol` / `P256.sol` (precompile with
  fallback), Daimo `P256Verifier` (also deployed at `0xc2b7…De4`), and MetaMask `P256VerifierLib` + `HybridDeleGator`.
- 7702 itself still needs an **EOA private key** to sign the type-4 authorization. A "passkey-only" owner means:
  generate an EOA key in the browser, sign the 7702 authorization plus one `addPasskey` call, then keep the key only as
  recovery (or discard it, accepting that the EOA key remains root forever in every 7702 design here: Calibur root key,
  Stateless delegator, Kernel7702).

## Recommended stack

**Primary: MetaMask Delegation Framework v1.3.0 on Arc, plus two or three small custom enforcers, plus our own relayer.**

1. Owner EOA → 7702 authorization to `EIP7702StatelessDeleGator` `0x63c0…E32B` (already on Arc, audited).
2. Robot registration = owner signs **one delegation** `owner → robotEOA` with caveats:
   `AllowedTargetsEnforcer[USDC 0x3600…]`, `AllowedMethodsEnforcer[transfer]`, `ValueLteEnforcer(0)`,
   `ERC20PeriodTransferEnforcer(USDC, $10, 1 day, start)`, `TimestampEnforcer(expiry)`, and ours:
   **`RobotPaymentPolicyEnforcer`** (per-tx cap, merchant allowlist (Merkle root or set), and "amount > X or
   merchant ∈ restricted ⇒ require approver ECDSA signature over `(delegationHash, merchant, amount, nonce, deadline)`
   in caveat `args`"). The approver key is held by our backend and signs only after a World ID Agent Pass verification
   (IDKit, server-side verify). The denied path is simply "no approver sig ⇒ revert".
3. Every payment, online or offline, is the same artifact: the robot signs a **leaf delegation**
   (`robot → ANY_DELEGATE`, `ExactExecution` + `IdEnforcer` + `TimestampEnforcer`) and hands it over by QR, BLE or HTTP. Our
   relayer (an EOA holding a little native USDC) calls `redeemDelegations([leaf, root], …)`. The robot never needs gas or
   network, and the user never sees gas.
4. Revoke = owner calls `DelegationManager.disableDelegation(root)` (from the dashboard, passkey-gated if we add 5).
5. Stretch: an `EIP7702PasskeyDeleGator` extending `EIP7702DeleGatorCore` with a WebAuthn branch, so the owner signs
   delegations with a passkey. Write it in Arc Studio if the Arc prize needs a Studio artifact; it is unaudited, so keep it small.
6. x402: support `exact` with the ERC-7710 delegation variant, or plain settlement by our relayer. Add `batch-settlement`
   for repeated micropayments later.

Why: everything except the custom enforcers is audited and **already on Arc**. The policy surface maps one-to-one to
the product. Offline needs no extra contracts. The relayer model makes gas invisible without a paymaster.

**Fallback: Uniswap Calibur 1.1 (live on Arc) plus our own validation hook.** Register the robot's secp256k1 key with
`expiration` and our hook. The hook implements the daily, per-tx, allowlist and co-sign rules, with the approver sig in
`hookData`. Offline uses `SignedBatchedCall{executor: 0}` with keyed nonces, relayed by us. It is better for a passkey owner
(native WebAuthn keys), but all the cap logic is ours and unaudited, and there is no 7710 / x402-delegation story.

## Open questions and unverified points

1. **Bytecode provenance.** Code exists at all the addresses listed, but nobody has diffed it against the repo source.
   Check verified source on `explorer.arc.io` (the explorer is "permissioned") or compare `extcodehash` with a
   local build.
2. **"Arc Studio" requirement** (`prizes.md`): does using MetaMask's pre-deployed contracts count, or must our custom
   enforcer or delegator be built and deployed from Studio? This decides whether step 5 is mandatory.
3. **World approval: hard or soft gate** (`open-questions.md` #8). This design makes it hard on-chain via an approver
   key. Is there a World ID verifier contract on Arc for a fully on-chain proof? Not found; assumed not.
4. **Per-tx cap and allowlist enforcer**: custom, unaudited. Keep it under ~100 lines with Foundry tests.
   `ERC20PeriodTransferEnforcer` uses fixed windows aligned to `start` (not rolling 24h) and forfeits unused allowance;
   confirm that is acceptable product-wise.
5. **Leaf-delegation offline flow** is reasoned from `DelegationManager.sol:155-203`, not yet run. Write one Foundry
   fork test on Arc (`--fork-url https://rpc.mainnet.arc.io`) before building on it.
6. **MetaMask `DelegationManager` is pausable** by MetaMask's owner key: a liveness dependency on MetaMask.
7. **Arc blocklist and the native-value path.** USDC transfers can revert for blocklisted addresses with no receipt. The
   relayer must handle silent drops (min 20 gwei base fee) and reverts.
8. **Nanopayments on Arc mainnet** and Gateway delegate signing for nanopayments: unverified. Circle's docs list Arc
   ambiguously.
9. **Robot hardware signing.** EIP-712 + secp256k1 on ESP32 (micro-ecc is in `references/kmackay_micro-ecc`) vs on the
   Pi / Radxa. Leaf delegations are larger to hash than a 3009 struct but still tiny.
10. **Kernel v4 Kernel7702 and SmartSessions are not on Arc.** We would deploy them ourselves if chosen (the CREATE2
    factory is present).
11. **x402 facilitator for Arc.** Only a third-party one is listed. We probably run our own.
12. ERC-7715 and 7710 are still **Draft** (checked in `ethereum/ERCs` 2026-11-05); ERC-7913 is Final.

## Sources

- Arc: https://docs.arc.io/arc/references/evm-differences · https://docs.arc.io/arc/references/contract-addresses ·
  https://docs.arc.io/arc/tools/account-abstraction · https://www.arc.io/blog/sponsored-transactions-on-arc-with-usdc-as-gas ·
  https://xroot.dev/blog/arc-chain-in-numbers · https://github.com/circlefin/arc-node
- Ithaca sunset: https://ithaca.xyz/ · https://ithaca.xyz/updates · https://paradigm.xyz/2025/10/ithaca-x-tempo
- x402: https://github.com/x402-foundation/x402 · https://dexter.cash/press/dexter-upto-usage-based-billing
- Circle Nanopayments / Gateway: https://developers.circle.com/gateway-nanopayments ·
  https://developers.circle.com/gateway/nanopayments/concepts/batched-settlement ·
  https://www.circle.com/blog/nanopayments-powered-by-circle-gateway-is-now-live-on-mainnet
- MetaMask: https://github.com/MetaMask/delegation-framework/blob/main/documents/Deployments.md ·
  https://github.com/MetaMask/smart-accounts-kit
- Kernel 7702 address: https://github.com/zerodevapp/sdk/blob/main/packages/core/constants.ts
- World: https://ethglobal.com/events/mumbai/prizes · https://techcrunch.com/2026/03/17/world-launches-tool-to-verify-humans-behind-ai-shopping-agents/
- ERC status: https://github.com/ethereum/ERCs (erc-7715, 7710, 7579, 7913)
