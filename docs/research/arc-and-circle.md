# Arc and Circle USDC infrastructure: research note

Researched 2026-11-05 (day 1 of ETHGlobal Mumbai). Scope: everything the robot-allowance
platform needs from Arc and Circle: chain facts, 7702 and P-256, gas, Gateway and CCTP, Arc
Studio prize rules, and sample repos.

**Confidence marks**

- **[V]** verified live today: Arc mainnet RPC call, Gateway API response, or reading the code
  in a cloned repo.
- **[D]** stated in official Arc or Circle docs. Not tested.
- **[S]** secondary source: a third-party doc, a GitHub PR, or a community repo.
- **[?]** unverified, or an inference of ours.

The two doc indexes are https://docs.arc.io/llms.txt and https://developers.circle.com/llms.txt.
Any page in them can be fetched as raw markdown by adding `.md` to its URL.

---

## TL;DR for our build

1. **Arc mainnet is live.** It has been public since 2026-09-16, chain id `5042`, and the RPC
   answers.
2. **EIP-7702 works on Arc mainnet.** Arc targets the Osaka EVM. We found a successful type-4 tx
   on mainnet that delegates to Alchemy's 7702 account through EntryPoint v0.7.
3. **The P-256 precompile at `0x100` works on mainnet.** It returned `1` for a valid signature
   and empty for a tampered one, so a passkey can be checked on-chain cheaply.
4. **Gas is paid in USDC.** USDC is the native coin (18 decimals). The same balance is also
   exposed as an ERC-20 at `0x3600…0000` with 6 decimals. Users never need a second token, so
   "never show gas" is mostly a UI and relayer question, not a token question.
5. **Circle Gateway supports Arc mainnet** (domain 26, live in `/v1/info`). The owner deposits
   USDC on any supported chain, then a signed burn intent mints on Arc in under 500 ms. With
   `enableForwarder=true`, Circle submits the Arc mint itself and charges for it in USDC.
6. **Arc Studio deploys to testnet only.** Every Arc prize must start in Studio and include a
   `https://studio.arc.io/app/<uuid>` URL. For mainnet we pull the code (`arc-studio pull`) and
   deploy it ourselves with Arc Foundry. Another team has already shown this path works.
7. **Circle Paymaster is not deployed on Arc** (no bytecode at its addresses), and Arc does not
   need it. ERC-4337 EntryPoints v0.6 to v0.9 are deployed. Pimlico, Alchemy and ZeroDev list
   Arc mainnet.

---

## Arc facts

| Fact | Value | Source | Conf. |
| --- | --- | --- | --- |
| Mainnet status | Public mainnet live since **2026-09-16**. Before that it was a private mainnet with 100+ builders | https://www.arc.io/blog/arc-mainnet-goes-live-on-september-16-2026 , https://investor.circle.com/news/news-details/2026/Circle-Launches-Arc-Mainnet-an-Economic-Operating-System-for-the-Internet/default.aspx | [V] (RPC live, block ~29.69M today) |
| Chain id | Mainnet `5042` (`0x13b2`). Testnet `5042002` | https://docs.arc.io/arc/references/connect-to-arc.md ; `eth_chainId` returned `0x13b2` | [V] |
| Unrelated chain | Chain id 1243 "ARC Mainnet" is a different chain | https://docs.pimlico.io/guides/supported-chains (via search) | [S] |
| RPC | `https://rpc.mainnet.arc.io` (public). Also Alchemy `arc-mainnet.g.alchemy.com/v2/KEY`, Blockdaemon, dRPC, QuickNode. Testnet: `https://rpc.testnet.arc.io` | connect-to-arc.md | [V] |
| Client | `web3_clientVersion` returns `arc/v1`. Execution is reth-based and consensus is Malachite BFT (repo `circlefin/arc-node`) | RPC; `references/circlefin_arc-node` | [V] |
| Explorer | `https://explorer.arc.io` (Blockscout, behind Cloudflare, so its API is blocked to curl). Testnet: `explorer.testnet.arc.io` | connect-to-arc.md | [V] |
| viem | Built in as `arc` (mainnet) and `arcTestnet` | `references/circlefin_skills/plugins/circle/skills/use-arc/SKILL.md` | [D] |
| Native gas token | **USDC, 18 decimals** native. The ERC-20 interface at **`0x3600000000000000000000000000000000000000`** has **6 decimals** and shares the **same balance**. There is no wrapped USDC. Divide native values by 10^12 | https://docs.arc.io/arc/references/evm-differences.md , https://docs.arc.io/arc/references/contract-addresses.md ; `decimals()` returned 6 | [V] |
| USDC ERC-20 details | `name()` = "USDC", `version()` = "2". EIP-3009 is present (`TRANSFER_WITH_AUTHORIZATION_TYPEHASH` returns). The contract is `NativeFiatTokenV2_2` | eth_call; `references/circlefin_stablecoin-evm/contracts/v2/NativeFiatTokenV2_2.sol` | [V] |
| EURC | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`, 6 decimals | contract-addresses.md | [D] |
| Other tokens | USYC `0x8a5D…F490` (permissioned). cirBTC `0x171A…BAA0` (8 decimals). Bridged WETH `0x128c…4EDB` | contract-addresses.md | [D] |
| Finality | Deterministic BFT finality, **under 1 s**, final on inclusion with no reorgs. Blocks come every ~0.5 s (100 blocks took 50 s today) | https://docs.arc.io/arc/concepts/deterministic-finality.md ; timestamps from RPC | [V] |
| Block gas | 30M gas per block. `block.timestamp` is non-decreasing but not strictly increasing, so order by block number | https://docs.arc.io/arc/references/gas-and-fees.md | [V] (gasLimit `0x1c9c380`) |
| Fee model | EIP-1559 with EWMA smoothing. **Min base fee 20 gwei**, max 20,000 gwei. The base fee goes to the proposer, not burned. The next base fee is published in the parent header's `extraData` (8 bytes). Design target: ~$0.001 per ERC-20 transfer | gas-and-fees.md ; https://docs.arc.io/arc/concepts/stable-fee-design.md | [V] (`baseFeePerGas` = `extraData` = 20 gwei) |
| Fee gotcha | A tx with `maxFeePerGas` under 20 gwei is **silently dropped**: no error and no receipt | evm-differences.md | [D] |
| Real costs | Native transfer: 21k gas × 20 gwei ≈ **0.00042 USDC**. Contract deploy (119k gas at 21 gwei) ≈ 0.0025 USDC | computed; https://github.com/salazarsebas/conciliado/issues/5 | [V]/[S] |
| EVM version | **Osaka** baseline, plus EIP-7708 (native `Transfer` logs) from Amsterdam. `PREVRANDAO` = 0. No blobs (type-3 rejected). EIP-4788 beacon root is not functional. EIP-2935 is present | evm-differences.md | [D] |
| **EIP-7702 (type-4)** | **Supported.** "Arc targets the Osaka hard fork… including EIP-7702". Found on mainnet: tx `0xd37ba4a8c064dca23faadb6887e04cfe2d4781f33e5bd6f70acb3f39f077c95c` (block 29687991), type 0x4, status 1. Its authorization delegates to `0x6900…E139` (Alchemy SemiModularAccount7702), and it was sent through EntryPoint v0.7 by a bundler | evm-differences.md ; https://docs.arc.io/integrate/relayers-and-paymasters.md ; RPC | [V] |
| **P-256 precompile** | **Live at `0x…0100`** (EIP-7212 / EIP-7951 address; Osaka). A valid sig returned `…01` and a tampered sig returned `0x`. Source: `crates/precompiles/src/precompile_provider.rs` (`P256_PRECOMPILE_ADDRESS`) | RPC test (node script in /tmp); `references/circlefin_arc-node` | [V] |
| Post-quantum precompile | Arc also ships a PQ signature precompile (`crates/precompiles/src/pq.rs`). Not relevant to us | https://docs.arc.io/arc/concepts/post-quantum-security.md | [D] |
| Value-transfer rules | Native sends to `0x0` revert. Burns revert. **Blocklisted addresses revert at runtime but still use gas.** A native send to a contract can revert even with enough balance | evm-differences.md | [D] |
| Native Transfer logs | Every native USDC movement emits an ERC-20 `Transfer` from system emitter `0xffff…fffE` (EIP-7708). Watch for double counting with the ERC-20 interface's events | https://docs.arc.io/arc/references/usdc-system-events.md | [D] |
| ERC-4337 EntryPoints | v0.6 `0x5FF1…2789`, v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032`, v0.8 `0x4337084D…F108`, v0.9 `0x43370900…D009`. All have bytecode | eth_getCode | [V] |
| Bundlers / paymasters | Docs list Alchemy, Biconomy, Pimlico, ZeroDev, Thirdweb, Privy, Dynamic, Turnkey, Crossmint, Para, MetaMask Embedded and Circle Wallets. Pimlico lists Arc mainnet 5042 with 7702, bundling for EP v0.6 to v0.9, and paymaster for v0.6 to v0.8 | https://docs.arc.io/arc/tools/account-abstraction.md ; https://docs.pimlico.io/guides/supported-chains | [D]/[S] |
| Paymaster deposits | An EntryPoint deposit is **native USDC in 18-decimal units**: 10 USDC is `10n * 10n**18n` | https://docs.arc.io/integrate/relayers-and-paymasters/deploy-a-paymaster.md | [D] |
| Circle Paymaster | **Not on Arc.** Circle's v0.7 and v0.8 paymaster addresses have no bytecode on Arc, and Arc isn't in its chain list. Not needed, because gas is already USDC | https://developers.circle.com/paymaster/addresses-and-events.md ; eth_getCode | [V] |
| MetaMask delegation framework v1.3.0 | DelegationManager `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`, EIP7702StatelessDeleGator `0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B`, HybridDeleGator, MultiSig, ERC20PeriodTransferEnforcer `0x474e…39aB`, NativeTokenPeriodTransferEnforcer `0x9BC0…6BD9`. All have bytecode at the canonical addresses. Arc mainnet was added to `smart-accounts-kit` in PR #304 (merged 2026-09-28) | eth_getCode; addresses cross-checked in `references/MetaMask_delegation-framework`; https://github.com/MetaMask/smart-accounts-kit/pull/304 | [V] |
| ZeroDev Kernel | Kernel v3.3 implementation `0xd6CEDDe8…5b28` has bytecode. ZeroDev docs list Arc 5042 | eth_getCode; https://docs.zerodev.app/sdk/faqs/chains | [V] code / [S] address |
| Safe 1.4.1 | Safe `0x4167…461a`, SafeL2 `0x29fc…C762` and ProxyFactory `0x4e1D…ec67` all have bytecode | eth_getCode | [V] |
| Others present | Coinbase Smart Wallet factory `0x0BA5…428a`, eth-infinitism Simple7702Account v0.8 `0xe6Ca…555B`, Daimo P256Verifier `0xc2b7…De4`, Permit2, Multicall3, Arachnid CREATE2 | eth_getCode; contract-addresses.md | [V] |
| Memos | Predeployed `Memo` at `0x5294E9927c3306DcBaDb03fe70b92e01cCede505`. `memo(target, data, memoId, memoData)` wraps a call, **keeps the original `msg.sender`** (via the `CallFrom` precompile) and emits `Memo` events. Useful for tagging a robot payment with a merchant order or QR id | https://docs.arc.io/arc/concepts/transaction-memos.md | [D] |
| Batching | `Multicall3From` at `0x522fAf9A91c41c443c66765030741e4AaCe147D0` batches calls and keeps `msg.sender` | https://docs.arc.io/arc/concepts/batched-transactions.md | [D] |
| Privacy | "Arc Privacy Sector" is confidential execution in TEEs. Docs say: **"Privacy features are on the roadmap and not yet available on Arc."** Do not plan on it | https://docs.arc.io/arc/concepts/opt-in-privacy.md | [D] |
| FX | StableFX is RFQ with on-chain settlement through `FxEscrow` (`0xe2E5F173576B513d994073CCbDaCBE027d43DFe6` mainnet) and needs a Permit2 allowance. It's an enterprise product. Swap Kit (App Kit) does USDC/EURC swaps | contract-addresses.md ; https://docs.arc.io/build/stablecoin-fx.md | [D] |
| Agent standards | ERC-8004 registries on mainnet: Identity `0x8004A169…a432`, Reputation `0x8004BAa1…9b63`, Validation `0x8004Cc84…AB58`. The ERC-8183 job/escrow reference implementation is **testnet only** | contract-addresses.md | [D] |
| CCTP on Arc | Domain **26**. TokenMessengerV2 `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`, MessageTransmitterV2 `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`, TokenMessengerWithFees `0x71f5…a408`. Standard transfer fee from Arc is 0 bps. Arc attests in ~0.5 s, so Fast Transfer is "N/A" | contract-addresses.md ; https://developers.circle.com/cctp/concepts/supported-chains-and-domains.md | [D] |
| Gateway on Arc | GatewayWallet **`0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`**, GatewayMinter **`0x2222222d7164433c4C09B0b0D809a9b52C04C205`** (same addresses on every EVM mainnet). Domain 26 supports USDC, EURC and cirBTC. Added 2026-09-16 | `curl https://gateway-api.circle.com/v1/info` ; https://developers.circle.com/release-notes/gateway-2026.md | [V] |

---

## Gateway and CCTP: fund from any chain, spend on Arc

### Concepts

- **Gateway (unified balance).** Deposit USDC into the non-custodial `GatewayWallet` on any
  supported chain. The deposit counts once the source chain finalizes it. After that, a signed
  **burn intent** sent to `POST /v1/transfer` returns an **attestation**. Calling
  `gatewayMint(attestation, sig)` on the destination's `GatewayMinter` mints the USDC. Once
  funds are deposited, a transfer takes under 500 ms. Sources:
  https://developers.circle.com/gateway.md and
  https://developers.circle.com/gateway/references/technical-guide.md.
- **Supported chains (USDC).** Arbitrum, Arc, Avalanche, Base, Ethereum, HyperEVM, OP,
  Polygon PoS, Sei, Solana, Sonic, Unichain and World Chain. [D]
  https://developers.circle.com/gateway/references/supported-blockchains.md
- **Deposit finality** decides how fast a top-up shows in the balance:
  - Arc ~0.5 s, Avalanche / Polygon / Sonic ~8 s, Sei and HyperEVM ~5 s.
  - **Ethereum, Base, Arbitrum, OP, Unichain and World Chain wait ~13 to 19 min** (65 ETH blocks).
  - **Fast deposit** (Unified Balance Kit, `transferSpeed: "FAST"`) routes through CCTP Fast
    Transfer and credits within seconds. Fast-deposit destinations are Arc, Avalanche and
    Polygon. Fast-deposit sources are Arbitrum, Ethereum, OP, Unichain, World Chain, Ink,
    Linea, Plume and Codex. https://docs.arc.io/app-kit/tutorials/unified-balance/use-fast-deposits.md
- **API.** Base URL `https://gateway-api.circle.com/v1` (testnet: `gateway-api-testnet.circle.com`).
  Endpoints: `/info`, `/balances`, `/deposits`, `/estimate`, `/transfer[?enableForwarder=true]`
  and `GET /transfer/{id}`. No API key is needed; Gateway is permissionless.
- **Fees** (https://developers.circle.com/gateway/references/fees.md):
  - Transfer fee: 0.005% on cross-chain transfers, 0 on same-chain.
  - Burn gas fee, by source chain: **Arc $0.0035**, Base $0.01, Ethereum $1.00, OP / Polygon $0.0015.
  - Forwarding: $0.05 service fee plus the destination gas cost.
  - Sizing: `maxFee ≥ gas + forwarding + 0.00005 × amount`.
- **Forwarding Service.** With `enableForwarder=true`, Circle submits the destination mint. The
  caller then needs no wallet and no gas on Arc, and every fee is taken from the burned amount
  in USDC. This is the main way to keep gas out of the owner's sight on the funding leg.
  https://developers.circle.com/gateway/references/forwarding-service.md
- **Delegates.** `addDelegate(token, delegate)` on GatewayWallet, once per source chain. A
  delegate gets a **full allowance** over the depositor's Gateway balance. **Removing a delegate
  does not invalidate burn intents it has already signed.**
  https://developers.circle.com/gateway/howtos/manage-delegates.md
- **ERC-1271.** Send `contractSigner: true` and Gateway validates the contract signature in an
  AWS Nitro TEE by simulating `isValidSignature` against 2 of 3 RPCs.
  - Validation is read-only.
  - The block it simulates against can be up to 5 minutes old, so a revocation may take up to
    5 min to apply.
  - EVM only. **Not available for Nanopayments.**
  - https://developers.circle.com/gateway/references/erc-1271.md
- **Trustless exit.** `initiateWithdrawal`, then `withdraw` after 7 days, if Circle's API is down.
- **SDKs:**
  - `@circle-fin/unified-balance-kit` 1.10.0, or the full `@circle-fin/app-kit` 1.20.0. Both
    have viem / ethers / Solana / Circle Wallets adapters.
  - Bridge Kit is `@circle-fin/bridge-kit`.
  - Nanopayments is `@circle-fin/x402-batching` 4.0.0.
  - These npm packages have **no public source repo**.
  - Contracts: `references/circlefin_evm-gateway-contracts`.
- **CCTP v2** is point-to-point burn and mint. Standard transfers take 15 to 19 min from
  Ethereum and L2s. Fast Transfer takes ~8 to 20 s for a fee. **Hooks** on Arc are documented
  for the "CCTP for non-USDC" (`CrossChainTokenService`, `executeWithCrossChainToken`) path.
  CCTP has its own Forwarding Service.
  https://developers.circle.com/cctp.md and
  https://developers.circle.com/cctp/expanded-assets/concepts/hooks.md

### Recommended flow for us

```
Owner (any chain)                     Circle Gateway                 Arc mainnet
-----------------                     --------------                 -----------
1. deposit USDC to GatewayWallet  --> balance credited after
   (Base/Arb/Eth/... or Arc itself)   source finality (or FAST)
2. owner EOA key signs a BurnIntent   POST /v1/transfer
   (EIP-712), destinationRecipient =  ?enableForwarder=true  -->  GatewayMinter mints USDC
   owner's 7702 account on Arc,                                    into owner 7702 account
   destinationDomain = 26                                          (no Arc gas from owner)
3.                                                                 robot session key spends
                                                                   within on-chain caps
                                                                   (USDC.transfer or native
                                                                   value, optional Memo with
                                                                   QR/order id)
```

- **Why mint into the owner's account rather than spend straight from Gateway.** Gateway's only
  spending controls are a full-allowance delegate and read-only ERC-1271. Neither can hold
  per-robot running totals ("$20 per day"), and revoking is slow (signed intents stay valid,
  ERC-1271 lags up to 5 min). Rule 1 says "on-chain is the authority", so the caps must live in
  the 7702 account on Arc. Gateway is only the top-up rail. [?] (our design inference)
- **"Unified balance" in the UI** = Gateway `/v1/balances` (all chains) + the Arc account's USDC
  balance. A top-up button, or an auto top-up when the Arc balance falls below a threshold,
  spends from Gateway to Arc.
- **Signing the burn intent.**
  - **EOA path:** the owner's secp256k1 key signs off-chain EIP-712. 7702 delegation doesn't
    affect this, because Gateway does a static ECDSA check for EOAs.
  - **Passkey-only owner:** we'd need `contractSigner: true`, and the 7702 implementation would
    have to be delegated on the **source** chain, where Gateway simulates `isValidSignature`.
    That chain also needs P-256 support. Simplest for the demo: deposit on Arc itself (Arc is a
    Gateway source with ~0.5 s finality), or sign with the EOA key once per top-up. [?]
- **Same-chain option.** If the owner already holds USDC on Arc, skip Gateway and fund the 7702
  account directly. Gateway matters for the "from any chain" story and the Continuity /
  advanced-logic pitch.

### Nanopayments / x402 (micropayment product)

- **What it is.** Gateway Nanopayments: the buyer deposits once into Gateway. After that, each
  payment is an **off-chain EIP-3009 authorization** with zero gas and amounts down to
  $0.000001. Circle's TEE batches and settles the net positions on-chain. The seller's Gateway
  balance is credited.
- **Chain support.** Works on all EVM Gateway chains, Arc included. Agent Stack added Arc
  mainnet. SDK: `@circle-fin/x402-batching` (`GatewayClient`, `BatchEvmScheme`).
  https://developers.circle.com/gateway-nanopayments.md and
  https://developers.circle.com/release-notes/agent-stack-2026.md
- **Constraint: EOA signatures only, no ERC-1271.** So a nanopayment can only come from a key
  that is itself a Gateway depositor or a delegate. If the robot key were a Gateway delegate of
  the owner, it would get a full allowance with no cap. The other option is a robot-owned
  Gateway balance, which the owner tops up in small amounts. In that case the cap is "what's
  deposited", not an on-chain rule. That fits the offline voucher idea (sign now, settle later)
  but weakens rule 1. [?]
- **Discovery API.** `GET https://api.circle.com/v2/x402/discovery/resources` lists
  x402 services. It belongs to the *other* Arc prize track (Marketplace Discovery consumer
  agent). https://developers.circle.com/agent-stack/agent-marketplace/discovery-api.md

### Circle Wallets / Modular Wallets / Bridge Kit / App Kit (awareness only)

- **Modular Wallets:** passkey ERC-4337 / ERC-6900 accounts.
  `references/circlefin_arc-p2p-payments` uses them with a bundler and a sponsoring paymaster.
- **Circle Wallets** (dev- or user-controlled) can't sign their own Unified Balance spends as an
  SCA. They use the delegate workflow instead. https://docs.arc.io/app-kit/unified-balance.md
- **App Kits** = Bridge, Swap, Unified Balance, Onramp, Earn and Borrow Kits. A **custom spend
  fee** is possible (90% to us, 10% to Arc). https://docs.arc.io/app-kit.md and
  https://docs.arc.io/app-kit/concepts/unified-balance-fees.md
- We use our own 7702 wallet (decisions.md), so we only need App Kit / Unified Balance Kit with
  the **viem adapter**, plus raw Gateway API calls.

---

## Hiding gas from users on Arc

**The token problem doesn't exist on Arc.** Gas is USDC, so a user holding only USDC can always
transact. What's left:

1. **Who sends the transaction.** A 7702 call still needs some EOA to submit it, and that EOA
   pays gas in native USDC. Options, best first:
   - **(a) ERC-4337 via a bundler** (Pimlico / Alchemy on Arc mainnet, EntryPoint v0.7 or v0.8).
     The robot's session key signs a UserOp for the owner's 7702 account. **No paymaster is
     needed**: the account pays its prefund from its own native USDC balance, the same money it
     spends, so cap checks can include gas. A paymaster is only needed if *we* want to sponsor.
     If so, deploy our own and fund it at 18-decimal units (deploy-a-paymaster.md).
   - **(b) Our own relayer EOA** submits `execute(...)` on the 7702 account with the robot's
     signed permission and is reimbursed in USDC inside the call. This is simple and works with
     the MetaMask DelegationManager `redeemDelegations` pattern.
   - **(c) EIP-3009 relayer.** The robot or owner signs `transferWithAuthorization` and our
     relayer submits it. https://docs.arc.io/integrate/relayers-and-paymasters/eip-3009-relayer.md
     **Gotcha:** once the owner EOA is 7702-delegated it has code. FiatToken's
     `SignatureChecker` then takes the **ERC-1271 path** (`extcodesize > 0`) instead of
     `ecrecover`, so the 7702 implementation must implement `isValidSignature` for the owner
     key. [V] by reading `references/circlefin_stablecoin-evm/contracts/util/SignatureChecker.sol`.
     Permit-based Gateway deposits go through the same check.
2. **Funding leg.** Gateway with the Forwarding Service means the owner signs one EIP-712 burn
   intent and pays fees in USDC out of the amount. They never touch Arc gas.
3. **Display.** Show fees as dollars (≈ $0.0004 to $0.002 per payment). Never show gwei. Native
   values are 18-decimal and ERC-20 values are 6-decimal, so convert with `/1e12`.
4. **Settings to get right:**
   - Always set `maxFeePerGas ≥ 20 gwei`. Lower is silently dropped.
   - Tip 0 to 1 gwei.
   - One confirmation is final. No polling loops.
5. **Cap design gotcha (Arc-specific).** USDC can leave an account as **native `value`** or as
   **ERC-20 `transfer`**: one balance, two exits. A session-key policy must cap **both** paths,
   plus gas. Example with MetaMask caveats: an ERC20 period enforcer, plus
   `NativeTokenPeriodTransferEnforcer` or a value-zero enforcer. Otherwise a robot could drain
   the account through the path that isn't capped. [?] (our inference from the two-interface model)

---

## Arc Studio and what the prize requires

**What Studio is**

- Circle's hosted AI coding agent at https://studio.arc.io.
- You use it through the browser (live preview, code workbench, terminal), the CLI
  (`npm i -g @circle-fin/arc-studio-cli`, v1.2.2), or as a skill/subagent for Claude Code
  (`arc-studio skills install --tool claude-code`).
- Chat modes: Build, Plan and Smart Contract (Solidity writing, auditing and deploying).
- Templates to remix: prediction market, **USDC checkout flow**, cross-chain bridge, on-chain
  profile.
- The sandbox is a Vite + Foundry app: React 18, wagmi 2, viem 2, ConnectKit and Circle SDKs.
  It reaches only allowlisted hosts.
- You can push to GitHub or deploy the frontend to Netlify, Vercel or Hugging Face.
- Sources: https://docs.arc.io/ai/arc-studio.md , https://docs.arc.io/ai/arc-studio-cli.md ,
  https://github.com/salazarsebas/conciliado/issues/5

**Limits**

- **It deploys to Arc testnet only.** It "never deploys to mainnet with its own wallet".
- Usage limits are daily and 30-day (shown as a percentage). There is a cap on running apps
  (`arc-studio pause`). Prompts are capped at 10k characters, so use `--file` for more.
- Contract deploys take 5 to 20 min per turn.
- Billing is in Circle Console.

**Project URL**

- Format: `https://studio.arc.io/app/<appId>`.
- It's in the browser address bar, in the `webUrl` field of `arc-studio run --output json`, or
  via `arc-studio open` / `arc-studio apps --json`.
- Source: https://dorahacks.io/hackathon/arc-microgrants-2 (format), conciliado issue (real
  example).

**ETHGlobal Mumbai Arc prize**

Source: https://ethglobal.com/events/mumbai/prizes, fetched 2026-11-05. Arc's total pool is
**$15k**, split into 5 tracks of $3k each:

- DeFi / on-chain finance built end to end in Studio.
- Mobile web consumer agent using the Marketplace Discovery API (Nanopayments, spend limits,
  approvals).
- **Best Smart Contracts with Advanced Stablecoin Logic, in Arc Studio.** Write, test and deploy
  USDC/EURC contracts with programmable logic and connect them to an app inside Studio. Wanted
  examples: conditional escrow, payroll/vesting, treasury splits, **software-to-software
  payments**, and cross-chain conditional transfers via the **Circle Forwarder**. There is a
  bonus for **contracts other builders can reuse**.
- Bridge Kit for non-USDC assets.
- Continuity track (Continuity participants only).

**Qualification (same for every Arc track):**

- Built in Arc Studio, with a **shareable project URL**.
- **Studio shown in the demo.**
- A working frontend and backend.
- An **architecture diagram**.
- A video demo and presentation covering the Arc and Circle tools used, with docs.
- A GitHub or Replit link.
- Name the one bounty you're entering.

Workshop: "Build Apps Powered by Smart Contracts with Ar[c Studio]", **today 17:00 IST,
Workshop Room 1**.

**Path for us** (proven by conciliado on 2026-10-18):

1. Start the app in Studio, either in the browser or with `arc-studio run --session duck`. Have
   it write the spending-policy contract and tests: a reusable "robot allowance" module or a
   7702 delegate with session keys, plus a minimal frontend. Save the `webUrl`.
2. Run `arc-studio pull`, then `bun install` (pull omits `node_modules`), then
   `arc-forge test` (Arc Foundry: https://github.com/circlefin/arc-foundry ,
   https://docs.arc.io/arc/tutorials/install-arc-foundry.md).
3. Deploy to mainnet ourselves:
   `arc-forge create … --rpc-url https://rpc.mainnet.arc.io --gas-price 25gwei --priority-gas-price 1gwei --broadcast --account <keystore>`.
4. Keep iterating in Studio for the parts judges see, by uploading our repo with
   `--file src/X.sol:contracts/X.sol` or `arc-studio clone <public repo>`.

**Gotchas for that path:**

- Studio's `foundry.toml` uses `evm_version = "paris"` and has no Arc RPC entry.
- For 7702 / transient storage, compile with `cancun`, `prague` or `osaka`. Arc runs Osaka, and
  `arc-ecommerce-payments` deploys a `cancun` build fine.
- `arc-studio pull` once returned a Cloudflare 502 with exit code 0. Always check the files
  actually arrived.

---

## Cloned repos

All clones are in `references/`. Each is shallow (`--depth 1`, LFS skipped) and Apache-2.0
licensed. Total size ~65 MB.

| Path | Upstream | Commit | Licence | Why | Key paths |
| --- | --- | --- | --- | --- | --- |
| `references/circlefin_skills` | https://github.com/circlefin/skills | `1f23655` | Apache-2.0 | Circle's agent skills. The Arc docs tell agents to load `use-arc` first. It also covers Gateway | `plugins/circle/skills/use-arc/SKILL.md`, `use-gateway/SKILL.md` + `references/transfer-evm-delegate.md`, `unify-balance/`, `accept-agent-payments/` |
| `references/circlefin_evm-gateway-contracts` | https://github.com/circlefin/evm-gateway-contracts | `c21d2d2` | Apache-2.0 | Gateway source: burn-intent / attestation encodings, delegates, ERC-1271 signers | `src/GatewayWallet.sol`, `src/GatewayMinter.sol`, `src/lib/{TransferSpec,BurnIntents,Attestations}.sol`, `src/modules/wallet/{Delegation,Deposits,Withdrawals,ContractSignatureSigners}.sol` |
| `references/circlefin_arc-multichain-wallet` | https://github.com/circlefin/arc-multichain-wallet | `17befda` | Apache-2.0 | Reference unified-balance UX on Arc (Next.js + Gateway API) | `lib/circle/gateway-sdk.ts`, `lib/deposit.ts`, `app/api/gateway/{deposit,transfer,balance}/route.ts` |
| `references/circlefin_arc-nanopayments` | https://github.com/circlefin/arc-nanopayments | `a29f920` | Apache-2.0 | x402 and Gateway Nanopayments: agent pays per call (testnet `eip155:5042002`) | `agent.mts`, `lib/x402.ts`, `app/api/premium/*/route.ts`, `app/api/gateway/withdraw/route.ts` |
| `references/circlefin_arc-p2p-payments` | https://github.com/circlefin/arc-p2p-payments | `499d1f5` | Apache-2.0 | Passkey modular wallet + bundler + paymaster on Arc. A gasless UX pattern to contrast with ours | `components/web3-provider.tsx`, `app/api/setup-wallets/route.ts` |
| `references/circlefin_arc-ecommerce-payments` | https://github.com/circlefin/arc-ecommerce-payments | `be2017d` | Apache-2.0 | Merchant checkout on Arc: Commerce Payments Protocol escrow plus an ERC-3009 collector relayed by an operator. Closest to "robot pays merchant" | `contracts/README.md` (Arc EVM notes), `contracts/artifacts/*.json`, `scripts/setup.ts`, `lib/contracts/` |
| `references/circlefin_stablecoin-evm` | https://github.com/circlefin/stablecoin-evm | `fc85788` | Apache-2.0 | USDC source, including **`NativeFiatTokenV2_2`** (Arc's native USDC), EIP-3009 and the SignatureChecker 7702/1271 behaviour | `contracts/v2/NativeFiatTokenV2_2.sol`, `contracts/v2/FiatTokenV2_2.sol`, `contracts/util/SignatureChecker.sol`, `contracts/v2/EIP3009.sol` |
| `references/circlefin_evm-cctp-contracts` | https://github.com/circlefin/evm-cctp-contracts | `a92a2b4` | Apache-2.0 | CCTP v2 contracts (fast transfer, hooks, `TokenMessengerWithFees`) | `src/v2/` |
| `references/circlefin_arc-node` | https://github.com/circlefin/arc-node | `6e76402` | Apache-2.0 | Arc node source. Ground truth for precompiles (P-256 at 0x100, CallFrom, native coin), hardforks and txpool rules | `crates/precompiles/src/{precompile_provider,call_from,native_coin_control}.rs`, `crates/execution-config/src/hardforks.rs`, `crates/execution-e2e/tests/e2e/p256_precompile.rs`, `BREAKING_CHANGES.md` |
| `references/circlefin_agent-stack-starter-kits` | https://github.com/circlefin/agent-stack-starter-kits | `3996330` | Apache-2.0 | Agent Stack (agent wallets, nanopayments) with Claude Agent SDK / LangChain / Vercel AI. Reference for the robot decision loop paying | `kits/claude-agent-sdk/src`, `kits/vercel-ai`, `packages/` |
| `references/circlefin_docs-examples` | https://github.com/circlefin/docs-examples | `1507481` | Apache-2.0 | Runnable code from the docs pages, including the Unified Balance Kit | `app-kit-unified-balance/src`, `app-kit-send`, `app-kit-bridge-evm` |
| `references/circlefin_arc-escrow` | https://github.com/circlefin/arc-escrow | `d5006bc` | Apache-2.0 | Escrow with AI validation and USDC settlement (Refund Protocol). Example of "advanced stablecoin logic" judges have already seen | `contracts/`, `app/` |
| `references/circlefin_circle-cctp-crosschain-transfer` | https://github.com/circlefin/circle-cctp-crosschain-transfer | `e445516` | Apache-2.0 | Step-by-step CCTP v2 UI (burn, attest, mint) | `src/`, `scripts/` |

**Not cloned:**

- `circlefin/arc-foundry` (7 MB): it's a toolchain. Install it with the docs instead.
- `arc-commerce`, `arc-stablecoin-fx`, `arc-fintech`, `arc-remote-signer` and
  `arc-x402-circle-wallets` (empty, 1 KB): too far from our use case.
- The App Kit, Unified Balance Kit, Bridge Kit and x402-batching npm packages: no public repos.
- MetaMask `delegation-framework`, ZeroDev `kernel` and Alchemy `modular-account` were already
  cloned by another session.

---

## Open questions / unverified

1. **Is a Studio project URL viewable by judges without logging in, or does it need sharing
   settings?** Nothing is documented. Ask at the Arc workshop at 17:00 IST today.
2. **Does a Studio-started project still qualify if most code is written outside Studio and
   deployed to mainnet by us?** The rules say "use Arc Studio as the starting point" and "connect
   to an app inside Studio". The safe plan is to keep the contract and a minimal app in Studio,
   and confirm with the Arc judges.
3. **Is Gateway mainnet live for Arc as a *source* (deposit on Arc)?** `/v1/info` lists the Arc
   wallet contract with `processedHeight`, and the docs show ~0.5 s finality, so probably yes.
   Not yet exercised with real USDC. [?]
4. **Passkey owner with Gateway.** Is there a working `contractSigner: true` example for a 7702
   EOA whose `isValidSignature` checks P-256? It needs the delegate on the source chain. Untested. [?]
5. **Which 7702 implementation.** Mainnet has MetaMask EIP7702StatelessDeleGator plus enforcers,
   Alchemy SMA7702 (already in use), Kernel v3.3 and Simple7702Account. Still to check: does
   MetaMask's `smart-accounts-kit` npm release include Arc mainnet yet (PR merged 2026-09-28; is
   it released)? [?]
6. **Bundler endpoints and pricing on Arc mainnet** (Pimlico `arc` slug, Alchemy) are not
   exercised yet. Does the bundler accept UserOps with no paymaster, where the account pays
   prefund in native USDC? Expected yes. [?]
7. **Nanopayments for robots.** It's EOA-only with full-balance semantics, so it can't enforce
   on-chain caps. Is it worth using only for the offline/voucher demo beat? [?]
8. **The native vs ERC-20 dual exit.** Do we confirm in a test that our session policy blocks
   native-value sends? Arc Foundry's `arc-anvil --network arc` is needed, because plain anvil
   can't reproduce the native-USDC behaviour. [?]
9. **Gateway delegate revocation semantics** (signed intents stay valid until `maxBlockHeight`).
   If we ever make a robot a Gateway delegate, set short `maxBlockHeight` values. [D]
10. **Blocklist** reverts still consume gas. A merchant address blocklisted by Circle would make
    robot payments fail at a cost. That's an edge case to show in the "denied" path, or to ignore. [D]
