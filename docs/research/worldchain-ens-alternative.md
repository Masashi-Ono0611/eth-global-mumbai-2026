# World Chain + 0G + ENS as an alternative to Arc (research, 2026-11-06)

**The question.** Should we swap Arc for **World Chain (480) + 0G + ENS**, or add ENS to the Arc plan (plan v3.1)?

**Confidence markers:**
- **[V]** verified live: an RPC call, an HTTP probe or code we read
- **[D]** from the official docs
- **[S]** from secondary sources (news, search summaries)
- **[I]** our inference

Live checks ran on 2026-11-05/06 against:
- World Chain: `https://worldchain-mainnet.g.alchemy.com/public`, cross-checked on `https://480.rpc.thirdweb.com`
- Ethereum: `https://ethereum-rpc.publicnode.com`
- Arc: `https://rpc.mainnet.arc.io`

Prices used: ETH $2,229.8 and WLD $0.34 (CoinGecko, at query time).

## TL;DR

1. **There is no World Chain or mini app prize at Mumbai.** World's prizes are Agent Pass ($5k), Agent Pass Continuity
   ($2.5k), IDKit ($2.5k) and IDKit Continuity ($2.5k). All of them are chain-agnostic. Moving to World Chain wins
   **no** extra prize money.
2. **ETHGlobal allows at most 3 partner prizes per project.** A partner with several tracks counts as one pick. So "+
   ENS" always means **dropping** Arc, 0G or World. It can't be added on top. [V]
3. **ENS's prize is "Best Use of ENSv2": $7k, paid to 4 places ($3k / $2k / $1k / $1k).** It must be built on ENSv2 on
   **Ethereum mainnet or Sepolia**, and ENSv2 must be central, not cosmetic. **No other chain is required**, so it works
   just as well with names that resolve to **Arc** addresses. [V]
4. **World Chain is technically possible, but it is a migration:**
   - The MetaMask Delegation Framework (DF) v1.3.0 is **not deployed on 480**: every contract returned 0 bytes. [V]
   - What is there: the P-256 precompile, EntryPoint v0.7/v0.8, Permit2, CREATE2 factories, native USDC with
     EIP-3009, CCTP V2 (domain 14), Pimlico's bundler and USDC paymaster, Durin, and the Coinbase (CDP) x402
     facilitator.
   - What is missing: **Circle's facilitator (no 480)**, Circle Paymaster, the Safe AllowanceModule and ERC-8004.
   - Gas is about 5× cheaper than Arc but paid in ETH. Blocks are 2 s with 200 ms flashblocks, against Arc's
     deterministic sub-second finality.
5. **World App can't give a robot a standing allowance.** Mini apps can only call allowlisted contracts. Approvals are
   revoked after each transaction, and Permit2 expiration "should always be 0". The World Money Safe has only the
   Safe4337Module. The only workable pattern is **World App funds our account** with one transfer.
6. **Recommendation: stay on Arc and add ENSv2 robot and merchant names.** Then decide one pick, **Arc prize vs ENS
   prize**, by how central the ENS piece turns out to be. Do not migrate to World Chain.

## 1. Prizes (source: <https://ethglobal.com/events/mumbai/prizes>, fetched 2026-11-05)

| Partner (pool) | Track | Amount and places | Key requirements | Conf. |
| --- | --- | --- | --- | --- |
| **ENS** ($10k) | **Best Use of ENSv2** | **$7,000**: $3k / $2k / $1k / $1k | <ul><li>Built on ENSv2 on Ethereum mainnet **or Sepolia**</li><li>ENSv2 features central, not cosmetic</li><li>A functional demo, not hard-coded values</li><li>A live demo link and open source code</li><li>"Bonus points if you bring AI agents into the mix… agents as namespaces, each with their own identity and permissions"</li></ul> | [V] |
| ENS | Best Integration of ENSv2 into an Existing Project | $3,000 ($2k / $1k) | **Continuity Track only**; ENSv2 on mainnet | [V] |
| **World** ($12.5k) | **World ID Agent Pass** | **$5,000**: $2.5k / $1.5k / $1k | <ul><li>Official Agent Pass</li><li>The full journey, including a deny path</li><li>Validated in a backend</li><li>A debrief</li><li>"We are mocking proofs now"</li></ul> | [V] |
| World | Best Use of IDKit | $2,500: up to 2 × $1,250 | IDKit in an app, mini app or on-chain flow; the credential chosen as the minimum sufficient one; a debrief | [V] |
| World | Agent Pass and IDKit (Continuity) | $2.5k each | Continuity only | [V] |
| World | **World Chain or mini app track** | **None exists at Mumbai** | n/a | [V] |
| **0G** ($15k) | **Physical AI: Agents with a Body** | **$5,000**: $2.5k / $1.5k / $1k (best real hardware) | <ul><li>A 0G call in the decision loop</li><li>**An episode log on 0G Storage** with a request id per decision</li><li>A sim or a live booth demo</li><li>A safe-stop (a faked fallback disqualifies)</li><li>Paid at 0G's discretion</li></ul> | [V] |
| 0G | Build with 0G Private Computer | $5,000 | Consumer app; users sign in with a 0G account and spend their own credits | [V] |
| **Arc** ($15k) | **Advanced Stablecoin Logic, in Arc Studio** | **$3,000** (no places listed, so one winner [I]) | Built in Arc Studio, with a shareable Studio URL shown in the demo; an MVP and a diagram; "bonus for contracts designed to be reused" | [V] |
| Arc | DeFi / Marketplace consumer agent / Bridge Kit | $3,000 each | Arc Studio for all; state which bounty you enter | [V] |
| ETHGlobal | Finalist (top 10) | $1,000 + $500 travel **per person** for teams of 3–5 | Independent of the partner picks | [V] |

### Cap on partner prizes

- **The rule:** "On the last step of the submission form, you can select up to **3 Partner Prizes** to apply for. If a
  partner has multiple tracks, you can be eligible for all of them while only counting as 1 Partner Prize."
  - Source: <https://ethglobal.com/events/mumbai/info/details> [V]
- **Consequences:**
  - Picking **World** covers Agent Pass **and** IDKit. [V] (rule) / [I] (applied to World)
  - Picking **0G** covers Physical AI and Private Computer.

### Prize comparison (the three picks are always 0G + World + one of Arc or ENS)

| | Picks | Ceiling (1st everywhere) | +IDKit ceiling | Expected [I] |
| --- | --- | --- | --- | --- |
| **(a) Current: Arc + 0G + World** | Arc ASL $3k, 0G PAI $2.5k, World AP $2.5k | **$8,000** | $9,250 | ≈ $2.0–2.8k |
| **(b) Arc chain + ENS names, picks unchanged** | as (a); the ENS names are UX only | $8,000 | $9,250 | ≈ $2.1–2.9k (slightly better story) |
| **(b′) Arc chain + ENS, ENS replaces the Arc pick** | ENS $3k, 0G $2.5k, World $2.5k | **$8,000** | $9,250 | ≈ $2.3–3.2k |
| **(c) World Chain + 0G + ENS** | ENS $3k, 0G $2.5k, World $2.5k (World Chain itself adds $0) | **$8,000** | $9,250 | ≈ $2.2–3.1k, lower if the migration slips |

**How the expected column is built [I].** Pure judgment, assuming a strong-fit project:

- **Arc ASL:** about 25% for its single $3k (≈ $750).
- **ENSv2:** 4 placings in a $7k pool, about 40% of placing (≈ $800–1,000) if ENSv2 is genuinely central.
- **0G Physical AI:** a strong fit (≈ $900–1,200).
- **World Agent Pass:** ≈ $700–900. IDKit adds about 20% × $1,250.

**What the table shows.** Prize ceilings are **identical**. ENS has more money and more places than Arc's single $3k
slot. The chain choice doesn't change the prize money; only the picks do.

## 2. World Chain (480): technical facts

| # | Fact | Evidence | Conf. |
| --- | --- | --- | --- |
| W1 | Chain id 480 (`0x1e0`) on both RPCs | `eth_chainId` | [V] |
| W2 | **MetaMask DF v1.3.0 is not deployed:** <ul><li>SimpleFactory `0x69Aa…c77c`</li><li>DelegationManager `0xdb9B…7dB3`</li><li>HybridDeleGatorImpl `0x48dB…FEC4`</li><li>EIP7702StatelessDeleGator `0x63c0…E32B`</li><li>all 37 enforcers in `Deployments.md`</li></ul> all return **0 bytes**. 480 is not in MetaMask's chain list (Arc is) | `eth_getCode` on Alchemy and thirdweb; `references/MetaMask_delegation-framework/documents/Deployments.md` (commit b4b8c41, 2026-10-22) | [V] |
| W3 | We could self-deploy: <ul><li>The Arachnid CREATE2 deployer `0x4e59…956C` and CreateX `0xba5E…a5Ed` are live, and the DF scripts use `new X{salt:"GATOR"}`.</li><li>`DelegationManager(owner)` takes the owner as a constructor argument. Replaying MetaMask's exact creation code with their owner (`0xB040…9f44`) would reproduce the canonical addresses, with MetaMask owning the pause. Otherwise our own addresses plus a custom SDK environment.</li><li>About 45 contracts, at under $0.10 total gas.</li><li>All plan A1–A7 simulations would have to be re-run.</li></ul> | `script/DeployDelegationFramework.s.sol:43-49`, `eth_getCode` | [V] facts / [I] plan |
| W4 | **The P-256 precompile (RIP-7212) is live at `0x100`:** <ul><li>a valid vector returns `…01`</li><li>a tampered one returns `0x`</li><li>`estimateGas` is 30,775 including the 21k base</li></ul> | `eth_call` | [V] |
| W5 | The modexp precompile `0x05` works, so on-chain RS256 verification of the Agent Pass token ports | `eth_call` 3^5 mod 7 = 5 | [V] |
| W6 | **ERC-4337:** <ul><li>EntryPoint v0.7 `0x0000…a032` (16,035 B) and v0.8 `0x4337…f108` are live.</li><li>Pimlico's public bundler `public.pimlico.io/v2/480` supports v0.6, v0.7, v0.8 and v0.9.</li><li>`pimlico_getTokenQuotes` returns a **USDC ERC-20 paymaster `0x7777…834C`**.</li></ul> | RPC | [V] |
| W7 | **Circle Paymaster is not on World Chain.** v0.7: Arbitrum, Base. v0.8: Arbitrum, Avalanche, Base, Ethereum, Optimism, Polygon, Unichain. No code at the known addresses on 480 | <https://developers.circle.com/paymaster>, `eth_getCode` | [D]/[V] |
| W8 | **Native USDC `0x79A02482A880bCE3F13e09Da970dC34db4CD24d1`:** <ul><li>`name()` = "USDC", `version()` = "2", 6 decimals</li><li>has `TRANSFER_WITH_AUTHORIZATION_TYPEHASH` (EIP-3009)</li><li>supply ≈ 16.1M</li></ul> A secondary source claims the name is "USD Coin". That is wrong | `cast call` | [V] |
| W9 | **CCTP V2:** TokenMessengerV2 `0x28b5…cf5d` and MessageTransmitterV2 `0x81D4…4B64` are live, with `localDomain()` = **14** | `cast call` | [V] |
| W10 | **Circle Gateway:** World Chain is domain 14. GatewayWallet `0x7777…00eE` and GatewayMinter `0x2222…C205` have code on 480. Confirmation: about 65 ETH blocks, roughly 13–19 min | <https://developers.circle.com/gateway/references/supported-blockchains>, `eth_getCode` | [D]/[V] |
| W11 | **x402 facilitators on `eip155:480`:**<ul><li>**Circle: no.** `/supported` lists only 5042, 5042002, 8453, 84532, 137 and 80002 (live)</li><li>**Coinbase CDP: yes**, `exact`, `upto` and `batch-settlement` (needs a CDP key)</li><li>**World's demo facilitator** `x402-worldchain.vercel.app/facilitator`: `exact` on 480 and 8453 (live)</li><li>thirdweb: any `eip155:<id>`</li><li>The x402 Go SDK has 480 USDC as a default asset</li></ul> | `curl` /supported; <https://docs.cdp.coinbase.com/x402/network-support>; `go/mechanisms/evm/default_assets.go:112`; <https://blog.thirdweb.com/changelog/expanding-x402-payments-to-26-new-chains/> | [V]/[D]/[S] |
| W12 | x402 demand on 480 is close to zero. One seller dropped World Chain in October 2026: "nothing has ever been paid to us" on it | <https://github.com/Nutshell2000/agent-data-tools/pull/238> | [S] |
| W13 | **Latency:** 100 blocks in 200 s, so **2 s blocks**. Flashblocks stream 200 ms preconfirmations. L1 finality is minutes. Arc's finality is deterministic and under a second | `eth_getBlock`; <https://world.org/blog/engineering/world-chain-full-block-access-lists> | [V]/[S] |
| W14 | **Gas now:** <ul><li>base fee 0.0005 gwei, effective 0.0015 gwei</li><li>`getL1FeeUpperBound(200 B)` = 1.16e10 wei ($0.000026)</li><li>`getL1FeeUpperBound(1500 B)` = 7.6e10 wei ($0.00017)</li></ul> | RPC, GasPriceOracle `0x4200…000F` | [V] |
| W15 | **World App gas sponsorship** is for World ID-verified users **transacting from World App** (its Safe + 4337 paymaster), "subject to minimums and restrictions". It does not cover our relayer, our HybridDeleGator, or any non-World App wallet. The "gas allowance for humans" at protocol level is still roadmap | `worldcoin_developer-docs/mini-apps/more/faq.mdx:7-12`, `world-chain/quick-start/features.mdx` | [D] / [I] (our contracts) |
| W16 | Safe AllowanceModule (0.1.0 / 0.1.1), Coinbase SpendPermissionManager and ERC-8004 registries: **0 bytes on 480**. Durin L2RegistryFactory `0xDddd…d22d` **is** live on 480 (not on Arc). AgentBook is live on 480 | `eth_getCode` | [V] |

### Cost per action (USD, at the gas prices above)

| Action | World Chain | Arc (plan) | Conf. |
| --- | --- | --- | --- |
| Plain USDC transfer | **≈ $0.00018**: a sampled tx, 48,950 gas plus 5.8e9 wei L1 fee | ≈ $0.0004 | [V] sample / [D] Arc |
| A 4337 user op | ≈ $0.0007: a sampled 194k-gas op | n/a | [V] sample |
| `redeemDelegations` with a passkey, caveats and the leaf, 250–400k gas | **≈ $0.0009–0.0014** | ≈ $0.005–0.008 (20 gwei, paid in USDC) | [I] from gas × price |
| Plus `HumanApprovalEnforcer` RS256, ~700k gas in total | ≈ $0.0024 | ≈ $0.014 | [I] |
| Who pays | Our relayer, **in ETH**, or the user in USDC via Pimlico's paymaster | Our relayer or the user, **in USDC** | [V] |
| DF deployment | One-off, about 45 contracts, under $0.10 | $0 (MetaMask deployed it) | [I] |

## 3. World App / MiniKit: can World Money be the owner?

| # | Rule (MiniKit v2 docs, repo HEAD 2026-11-04) | Conf. |
| --- | --- | --- |
| M1 | **`sendTransaction` runs on World Chain only** (`chainId: 480`). Every contract and Permit2 token must be **allowlisted** in the Developer Portal; otherwise `invalid_contract`. Other errors include `disallowed_operation`, `malicious_operation` and `daily_tx_limit_reached` | [D] `mini-apps/commands/send-transaction.mdx` |
| M2 | **Approvals:** "Standard ERC-20 `approve()` … approval will be automatically revoked after the transaction". For Permit2 AllowanceTransfer, "Expiration should always be set to 0 as the approval will be consumed in the same transaction". SignatureTransfer was removed in v2 | [D] |
| M3 | A sampled World Chain 4337 sender (`0x92a4…49d7`) is Safe 1.4.1 with 1 owner, threshold 1, **only the Safe4337Module 0.3** `0x75cf…c226`, and no guard. This looks like a World App wallet (not proven). A mini app would have to call `enableModule` on the user's own Safe, which can't be allowlisted | [V] sample / [I] |
| M4 | **Standing robot allowance from World Money: no viable path:**<ul><li>An AllowanceModule isn't deployed (W16) and can't be installed (M3)</li><li>A long-expiry Permit2 or ERC-20 allowance is revoked or disallowed (M2)</li><li>The Safe can't be a DF delegator: no `executeFromExecutor`; HybridDeleGator's EOA owner must be an ECDSA EOA, not a Safe</li></ul> | [I] from [D]/[V] |
| M5 | **What does work:** a mini app button that does one allowlisted `USDC.transfer(ourHybridAccount, x)` from World Money, a "top up from World App". On World Chain it is same-chain. On Arc it is a CCTP V2 / Gateway hop from domain 14 | [I] |
| M6 | Mini apps need Developer Portal review before public listing. For a demo, unlisted dev testing in World App is enough | [D] faq.mdx |
| M7 | Real upside of World Chain for **IDKit** only: World ID proofs verify natively on World Chain, avoiding the Arc satellite's hourly root and missing issuer keys (`world-v2.md` A6, A10). Agent Pass (OIDC) is chain-agnostic | [V] (world-v2) / [I] |

## 4. ENS: what we'd use

| # | Fact | Conf. |
| --- | --- | --- |
| E1 | **Status.** ENSv2 activation passed and launched on Ethereum mainnet on about 2026-10-27. Namechain (the planned ENS L2) was **dropped in February 2026**, so ENSv2 lives on L1. Docs: "until launch completes, Mainnet resolution and registration still run through ENSv1. Sepolia already resolves through ENSv2." Registrations are payable in USDC or DAI | [S] <https://www.radom.com/insights/ens-labs-revises-strategy-by-halting-development-of-namechain-layer-2-opts-for-full-integration-of-ensv2-on-ethereum-mainnet>, <https://crypto.news/ensv2-ethereum-mainnet-nft-name-upgrades/>; [D] <https://docs.ens.domains/learn/deployments> |
| E2 | **ENSv2 mainnet contracts have code:**<ul><li>RootRegistry `0x2553…a91e`</li><li>ETHRegistry `0xf60a…85e2`</li><li>ETHRegistrar `0xd6d8…cc81`</li><li>UniversalResolverV2 `0x06fd…cfd5`</li><li>VerifiableFactory `0x7751…30d2`</li><li>PermissionedResolverImpl `0x565b…57c5`</li></ul> | [V] `cast codesize` |
| E3 | **Price.** The ENSv2 registrar's `getRegisterPrice(<5+ chars>, 1 yr, USDC)` = **8.000021 USDC** (labels "vitaquack", "quackbot", "vitaduck"; all `isAvailable` = true). The v1 controller `rentPrice` = 0.00225 ETH ≈ $5 (v1 may be frozen to new registrations [S]). Whether v2 `register` is open right now is untested [I] | [V] |
| E4 | **`duck.eth` is taken** (v1 and v2 both report unavailable), so `vitaquack.duck.eth` is impossible unless we buy it. Use our own parent, e.g. `<project>.eth` → `vitaquack.<project>.eth` | [V] |
| E5 | **Gas.** Mainnet runs at 0.248 gwei, so a 100–300k-gas subname or resolver operation costs about **$0.06–0.17**; the parent costs about $8/yr. **Sepolia is allowed for the prize, at $0.** Durin L2 subnames on World Chain or Base cost about $0.001 each, but Durin is a v1-style CCIP-read setup, not "ENSv2 central" | [V] gas / [I] |
| E6 | **ENSv2 features that fit us:**<ul><li>a per-project **subname registry** with robots and merchants as subnames</li><li>**Enhanced Access Control** roles: grant the **chip address** the right to edit only its own text records, or the owner account the right to revoke</li><li>a **PermissionedResolver** per robot</li><li>expiring or revocable subnames that mirror grant expiry</li></ul> This is exactly the "agents as namespaces with their own permissions" bonus | [D] prize text, <https://docs.ens.domains/ensv2/overview/> |
| E7 | **Multichain addresses (ENSIP-11):** `coinType = 0x80000000 \| chainId`. **Arc 5042 → 2147488690**; World Chain 480 → 2147484128. Names resolve to Arc addresses with no Arc-side ENS contracts | [V] arithmetic / [D] ENSIP-11 |
| E8 | **Agent identity:**<ul><li>ENSIP-26 `agent-context` and `agent-endpoint[mcp\|a2a\|web]` text records (point `[mcp]` at the Robot Agent or wallet MCP)</li><li>ENSIP-25 `agent-registration[<ERC-7930 registry>][<agentId>]` links to an ERC-8004 entry</li><li>The **ERC-8004 Identity registry `0x8004A169…a432` is live on Arc** (code present) and **absent on World Chain**</li></ul> | [D] <https://docs.ens.domains/ensip/26/>, <https://docs.ens.domains/ensip/25/>; [V] code |
| E9 | **Arc contracts can't read ENS:** it's L1 state. Names are resolution and UX: the consent screen, the Agent Pass approval page ("pay `snacks.<project>.eth`"), merchant discovery, and `agent-endpoint`. On-chain caveats keep using addresses | [I] |
| E10 | **Is ENS chain-specific?** Only "ENSv2 on Ethereum mainnet or Sepolia". Nothing ties it to the payment chain, so ENS on top of Arc qualifies the same as with World Chain | [V] prize text |

## 5. Verdict matrix

| | (a) Current Arc plan | (b) Arc + ENSv2 names on top | (c) World Chain + 0G + ENS |
| --- | --- | --- | --- |
| Partner picks | Arc + 0G + World | Arc + 0G + World, **or (b′)** ENS + 0G + World | ENS + 0G + World |
| Prize ceiling | $8.0k ($9.25k with IDKit) | $8.0k either way | $8.0k |
| Technical risk | Known (C1 passed on live Arc; A1–A7 simulated) | Same plus small. ENSv2 is ten days old on mainnet, so use Sepolia if mainnet registration isn't open | **High:** <ul><li>a self-deployed DF</li><li>re-running every simulation and bench C1</li><li>a new facilitator (CDP key, or World's demo one)</li><li>a relayer funded in ETH</li><li>allowlist review if a mini app is involved</li></ul> |
| Work delta | 0 | ≈ 0.5–1 dev-day: <ul><li>a parent name and a subname registry</li><li>a subname plus resolver at robot pairing</li><li>ENSIP-11 Arc address and ENSIP-26/25 records</li><li>an EAC role to the chip</li><li>names in the UI</li></ul> | ≈ 1.5–3 dev-days before any new feature, plus the ENS work from (b) |
| Gained | USDC as gas, sub-second finality, Circle facilitator, ERC-8004 on Arc | Robot and merchant identity, the "agents as namespaces" story, an MCP endpoint discoverable by name. In (b′): $7k across 4 places instead of $3k for 1 winner, **and no Arc Studio requirement** | <ul><li>Gas about 5× cheaper (still negligible on Arc)</li><li>Native World ID on-chain (helps IDKit)</li><li>Same-chain top-up from World App</li><li>Durin and AgentBook</li></ul> |
| Lost | — | In (b′): the Arc prize and its Studio showcase | <ul><li>USDC-as-gas (ETH for the relayer, or a paymaster)</li><li>deterministic sub-second finality (2 s blocks)</li><li>Circle's facilitator and Circle Paymaster</li><li>ERC-8004</li><li>the Arc prize</li><li>bench C1 and the simulations already run</li></ul> No World Chain prize to offset it |
| World UX | Agent Pass (unchanged) | Same | Same Agent Pass. A mini app can only top up; no standing allowance (M4) |

### Recommendation

1. **Don't migrate to World Chain.** It has no prize of its own. It means redeploying and re-validating the whole
   delegation stack, it loses Circle's facilitator and USDC gas, and the World App wallet still can't hold a robot
   allowance.
2. **Do (b): add ENSv2 identity on top of Arc.** Each robot and merchant gets a subname under our own `.eth`:
   - an ENSIP-11 Arc address
   - an `agent-endpoint[mcp]` record
   - an ENSIP-25 link to an ERC-8004 entry on Arc
   - an EAC role so the chip edits its own records

   Build on Sepolia first ($0); use mainnet only if v2 registration is confirmed open (about $8 plus cents).
3. **Then decide one pick, Arc vs ENS (b′), by Saturday:**
   - Keep **Arc** if the Studio-built enforcers are real and showcased.
   - Switch to **ENS** if Studio friction is high or the ENS piece is genuinely central, since ENS pays 4 places
     from $7k.
4. **Always keep 0G and World.** The World pick also makes us eligible for IDKit at no extra pick.
5. **Note for 0G:** "episode log on 0G Storage" is a qualification requirement, not optional.

## Sources

- Prizes: <https://ethglobal.com/events/mumbai/prizes>
- Rules (3-pick cap): <https://ethglobal.com/events/mumbai/info/details>
- MetaMask DF deployments: `references/MetaMask_delegation-framework/documents/Deployments.md`
- MetaMask DF deploy script: `script/DeployDelegationFramework.s.sol`
- World docs (local mirror of <https://github.com/worldcoin/developer-docs>):
  - `mini-apps/commands/send-transaction.mdx`, `mini-apps/more/faq.mdx`
  - `world-chain/providers/paymasters.mdx`, `world-chain/quick-start/features.mdx`
- Circle Paymaster: <https://developers.circle.com/paymaster>
- Circle Gateway chains: <https://developers.circle.com/gateway/references/supported-blockchains>
- Circle facilitator: `https://api.circle.com/v1/facilitator/x402/supported` (live)
- CDP x402 networks: <https://docs.cdp.coinbase.com/x402/network-support>
- World x402 demo facilitator: `https://x402-worldchain.vercel.app/facilitator/supported` (live)
- thirdweb x402 chains: <https://blog.thirdweb.com/changelog/expanding-x402-payments-to-26-new-chains/>
- World Chain flashblocks: <https://world.org/blog/engineering/world-chain-full-block-access-lists>
- ENSv2:
  - <https://docs.ens.domains/ensv2/overview/>, <https://docs.ens.domains/learn/deployments>
  - `ensdomains/contracts-v2` `contracts/src/registrar/interfaces/IETHRegistrar.sol`
  - ENSIP-25: <https://docs.ens.domains/ensip/25/>; ENSIP-26: <https://docs.ens.domains/ensip/26/>
- ENS news:
  - <https://www.radom.com/insights/ens-labs-revises-strategy-by-halting-development-of-namechain-layer-2-opts-for-full-integration-of-ensv2-on-ethereum-mainnet>
  - <https://crypto.news/ensv2-ethereum-mainnet-nft-name-upgrades/>
  - <https://en.coin-turk.com/ens-labs-proposes-mainnet-launch-of-ensv2-freezing-new-eth-registrations-on-v1/>
- Durin: <https://github.com/ensdomains/durin> (factory `0xDddd…d22d`, L1 resolver `0x8A96…3D61`)
- Earlier notes: `docs/research/world-v2.md` (A6, A10), `wallet-accounts-v2.md`, `evm-accounts-and-payments.md`
