# Wallet accounts v2: account model, universal grants, no third parties (research, 2026-11-05)

What this answers: which **account model** the personal wallet (system 1) should use, and how **grants**
(session keys for any grantee) work on it, universally and without third-party wallet services, so
that the AI client (system 2), the merchant (system 3) and the World proof flow (system 4) can build on it.

**Decision impact:** this recommends **reopening** the locked `decisions.md` row "Owner wallet: owner EOA upgraded with
EIP-7702". The proposal is a passkey-native DF account as the default, with the 7702 EOA kept as the fallback and as
the MetaMask path. Grants, relayer, enforcers and the robot-key decision are unchanged, because both models are DF
delegators.

Builds on, and does not repeat: `docs/decisions.md`, `docs/research/evm-accounts-and-payments.md` (DF v1.3.0
on Arc, offline leaf delegations, custom enforcers), `docs/research/arc-and-circle.md` (Arc facts, Gateway,
contractSigner) and the architecture page's "The passkey question" (`docs/site/architecture/index.html`).

Method:

- Read the contract and SDK code in `references/`. The new clones are listed at the end.
- Checked bytecode on Arc mainnet (`https://rpc.mainnet.arc.io`, chain 5042) and compared it with Base and
  Ethereum.
- **Ran an end-to-end simulation against live Arc mainnet state.** This used `eth_call` + `eth_estimateGas`
  through Multicall3, with state overrides only for balances and for one 7702 code designator. Nothing was
  broadcast and no funds were used. The method is in the appendix.
- Used the web, with URLs cited inline and at the end.
- Two helper passes researched the WebAuthn PRF support matrix and ERC-7715/7710/5792 wallet support. Their
  claims are marked *(web check)* and keep their URLs.

## TL;DR

- **Default: a passkey-native MetaMask `HybridDeleGator`.** Use one per user, deployed by our relayer through
  `SimpleFactory`, with **P-256 passkeys as on-chain signers**.
  - Implementation `0x48dBe696A4D990079e039489bA2053B36E8FFEC4` and SimpleFactory
    `0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c` are both **live on Arc**.
  - Arc's bytecode is byte-for-byte MetaMask's Base deployment except the chain id and the cached EIP-712 domain
    separator.
  - The account is a native Delegation Framework (DF) delegator, so grants are DF delegations with no custom
    account code.
- **The simulation proves the whole loop on Arc mainnet with stock contracts.** Each of these was run:
  - deploy a passkey-only account;
  - passkey-sign a root grant;
  - sub-delegate owner → AI client → robot → an open "payment voucher";
  - have a relayer redeem it, which paid 2 USDC;
  - over-cap payments revert with `ERC20TransferAmountEnforcer:allowance-exceeded`;
  - revoke a grant;
  - add a second passkey;
  - make an ERC-1271 / EIP-3009 USDC transfer signed by the passkey.

  The authenticator was software, so a real-device check is still owed.
- **One grant system covers every account type.** `DelegationManager` checks each hop with ECDSA if the
  delegator has no code, and with ERC-1271 otherwise (`DelegationManager.sol:163-180`). It executes on the root
  through `executeFromExecutor`. A passkey Hybrid account, a 7702 EOA on `EIP7702StatelessDeleGator`
  (simulated too), a MetaMask user's upgraded account, and EOA or contract grantees in the middle of a chain
  all use the same `Delegation` struct, enforcers and redemption.
- **No bundler is needed. Use bundler-free relaying.** Every action is `DelegationManager.redeemDelegations`
  sent by our relayer EOA, which pays gas in native USDC.
  - That includes the owner's own sends, revokes and key changes, each as a one-time delegation to the relayer
    (`exactExecution` + `limitedCalls(1)` + `redeemer`).
  - Cost: about $0.004–0.008 per action at Arc's 20 gwei floor.
  - A self-hosted bundler is possible but worse here, because Arc's public RPC has **no `debug_traceCall`**.
    You'd run Alto/Rundler/Skandha in "unsafe" mode or run your own node.
- **Fallback: 7702 EOA + PRF-wrapped secp256k1 key on `EIP7702StatelessDeleGator`.** It keeps the same
  address on every chain, plain-ECDSA Gateway and the same grants. It is weaker on coverage: no PRF on
  Bitwarden, Dashlane or the Chrome profile authenticator; Windows Hello only since Feb 2026 and on one PC
  only. Its security is software-wallet grade: the key reaches JS, and the root key can never rotate.
- **External wallets: the honest universal answer is "funding source, plus optionally an EIP-712 owner key of a
  Hybrid account".** Every wallet can send USDC and sign typed data. ERC-7715 (MetaMask Advanced Permissions) is a
  MetaMask-only bonus. It yields the same DF permission context, so our relayer redeems it unchanged. Wallets do
  not let dapps request arbitrary 7702 authorizations (§2.3).
- **Circle rails fit, with one rule: a contract account signs Gateway intents only where it is deployed.**
  - Inbound from other chains: CCTP `depositForBurnWithHook` with `mintRecipient` = our Arc account plus
    Circle's Forwarding Service (Arc ✅). Or an external EOA's own Gateway balance with
    `destinationRecipient` = our account.
  - Outbound from Arc: the account calls CCTP, or uses Gateway with `contractSigner: true` on Arc, where it is
    deployed.
  - `depositFor(ourAccount)` on Base only helps if we also deploy the account on Base.

## 1. Comparison

### 1.1 The three model families

| | **A. Passkey-native smart account** (rec.: DF `HybridDeleGator`) | **B. EOA + EIP-7702, key from passkey PRF** (DF `EIP7702StatelessDeleGator`) | **C. External wallet** (MetaMask, Rabby, Coinbase, …) |
|---|---|---|---|
| Who signs | Passkey P-256 signature, verified on-chain (precompile `0x100`, SCL fallback) | secp256k1 key unwrapped in JS from the PRF output for each signature | The wallet's own key, in its own UI |
| Key ever in page JS | **No** | **Yes** (XSS or a malicious dependency at signing time = loss) | No |
| Device coverage | Any ES256 passkey provider (iCloud, GPM, Windows Hello, 1Password, Bitwarden, Dashlane, security keys) | Only PRF-capable providers (§2.2 matrix) | Any wallet |
| Live on Arc | ✅ impl, factory, DM, enforcers | ✅ stateless delegator; type-4 txs seen on Arc | n/a |
| Grants (DF delegations) | ✅ native (account is the delegator, 1271) | ✅ native (ECDSA by the EOA key via 1271) | ✅ only if the wallet's account is a DF delegator: MetaMask smart account + ERC-7715, or the wallet is the EIP-712 owner of our Hybrid. Otherwise none |
| Sub-delegation chains | ✅ (simulated, 3 hops) | ✅ (same DM) | ✅ via MetaMask `redelegatePermissionContext`, or our Hybrid |
| Gas without a hosted bundler | ✅ relayer redeems; relayer deploys the account | ✅ relayer redeems; relayer can sponsor the type-4 authorization | User pays their own gas, or same relayer path for 7715 contexts |
| Recovery | Several passkeys (`addKey`, simulated), optional EOA owner, guardians as delegations / `MultiSigDeleGator` | Passkey sync only, unless the key is wrapped by several passkeys plus a recovery code. **Root key can never rotate** | The wallet's seed phrase |
| Address across chains | Same CREATE2 address wherever DF v1.3.0 lives, given the same *initial* signers. Deployed per chain; key changes don't sync | **Same EOA address everywhere**, controllable everywhere | Same EOA |
| Gateway burn intents | `contractSigner: true`, valid only on chains where the account is deployed (Arc ✅) | Plain ECDSA, any chain | Plain ECDSA (EOA) |
| EIP-3009 / Permit2 / x402 `exact` | ✅ via 1271 (simulated). Account must be deployed; signature must not be ERC-6492-wrapped | ✅ (1271 path once delegated, ECDSA before) | ✅ |
| Custom code needed | None for the account | None for the account; key wrapping and a "boundary page" in the app | None |
| Audits | DF: Hybrid in scope of Diligence 2024-06, also in Cyfrin 2025-03/04 and 2026-10 reports (`audits/`) | Stateless delegator: Cyfrin/Diligence 2025 (older note) | n/a |

### 1.2 Passkey-native candidates, on Arc

Bytecode checked on Arc 5042 on 2026-11-05 with `eth_getCode`:

| Account | Arc addresses (code present?) | Passkey on-chain | Session keys / grants | Fits "one grant system"? | Verdict |
|---|---|---|---|---|---|
| **MetaMask `HybridDeleGator`** (DF v1.3.0) | impl `0x48dB…FEC4` ✅ 20,203 B · SimpleFactory `0x69Aa…c77c` ✅ · DM `0xdb9B…7dB3` ✅ · MultiSig impl `0x56a9…f3A7` ✅ | ✅ WebAuthn + raw P-256 + one EOA owner (`HybridDeleGator.sol:369-390`) | DF delegations, ~38 stock enforcers | ✅ native | **Default** |
| OpenZeppelin `Account` + `SignerWebAuthn` (+7579/7821/7739) | nothing canonical (library) | ✅ (`ERC7913WebAuthnVerifier`, `SignerWebAuthn`) | 7579 modules; no DF / 7710 | 🔧 we'd add `executeFromExecutor` + `onlyDelegationManager` ourselves (unaudited combination) | Only if we must own the account code |
| Coinbase Smart Wallet | factory v1 `0x0BA5…428a` ✅, v1.1 `0xBA5E…5842` ✅, impl v1 `0x0001…9E72` ✅, impl v1.1 `0x0000…534d` ✅ (v1.1 factory bytecode identical on Arc/Base/Eth) | ✅ (`webauthn-sol`, owners as 64-byte keys); `replaySafeHash` wraps 1271 hashes (`ERC1271.sol:69-90`) | `SpendPermissionManager` `0xf852…67Ad` ✅ only: periodic allowance, spender must send the tx, no allowlist or sub-delegation | ❌ not a DF delegator | No |
| ZeroDev Kernel v3.1 / v3.3 + passkey validator | factory v3.1 `0xaac5…E419` ✅, v3.3 `0x2577…F2E9` ✅, meta factory `0xd703…42d5` ✅, impl v3.3 `0xd6CE…5b28` ✅, passkey validator 0.0.3 `0x7ab1…9e69` ✅ (0.0.2 `0xbA45…90Fd` ❌) | ✅ | ZeroDev permission plugins (separate system; v3 policies moved off master, see the older note) | ❌ separate grant system | No |
| Safe 1.4.1 + Safe4337Module + passkey signer | Safe `0x4167…461a` ✅, ProxyFactory ✅, Safe4337Module 0.3 `0x75cf…c226` ✅, SafeModuleSetup ✅, `SafeWebAuthnSignerFactory` 0.2.1 `0x1d31…1195` ✅, `SafeWebAuthnSharedSigner` `0x94a4…55c2` ✅, FCL verifier ✅ · Safe7579 adapter ❌, AllowanceModule 0.1.1 ❌ | ✅ | none deployed (no 7579 adapter, no allowances) | ❌ | No |
| Uniswap Calibur (7702 singleton) | `0x0000…030e` ✅ | ✅ WebAuthn keys on a 7702 EOA (EOA key stays root) | per-key expiry + our hooks | ❌ (no 7710) | Already the older note's fallback; superseded here |

**Newer in 2026, and why none changes the pick:**

- **Openfort's 7702 + WebAuthn account** was archived on 2026-06-30
  ([repo](https://github.com/openfort-xyz/openfort-7702-account)).
- **oportet** is a Porto fork with passkeys, session keys and 7702 relay mode
  ([repo](https://github.com/oportetxyz/oportet)). It is active, with 0 stars, its own contracts, and nothing
  deployed on Arc.
- **NorKey** has PRF-wrapped EOAs delegated to Calibur, with a self-hosted server and an isolated "boundary page"
  ([repo](https://github.com/xanderslabs/norkey)). It's the best reference implementation of model B.
- **OZ community `RoleAccount`** is an account controlled by an AccessManager role, with ERC-7739.
- **Native AA:** Ethereum's EIP-8141 frame transactions are scheduled for Hegotá, targeting 2027
  ([ETH Daily](https://ethdaily.io/account-abstraction-scheduled-for-hegota)). Base's EIP-8130 runs only on a
  devnet and rejects P-256 at admission
  ([Base docs](https://docs.base.org/base-chain/specs/upgrades/cobalt/eip-8130),
  [EIP-8130](https://eips.ethereum.org/EIPS/eip-8130)). Neither reaches Arc in our timeframe.
- **The P-256 precompile is now on L1 too** (EIP-7951, Fusaka, Dec 2025, per third-party sources). That matters
  only if we later deploy the account on other chains.

## 2. Details per model

### 2.1 A. Passkey-native HybridDeleGator (DF v1.3.0)

**On Arc and provenance.** The impl, factory, DelegationManager, MultiSig impl, stateless 7702 delegator and every
enforcer we use have code on Arc.

- I fetched the Hybrid impl, DelegationManager and stateless delegator from Arc and from Base and diffed them
  byte by byte. The only differences are:
  - `0x13b2` vs `0x2105`, the immutable chain id;
  - the 32-byte cached EIP-712 domain separator.
- The lengths are identical (20,203 / 11,503 / 11,185 B). SimpleFactory's bytecode hash is identical on Arc,
  Base and Ethereum.
- This closes open question 1 of the older note for these contracts: Arc runs the same audited build.

**How it signs** (`src/HybridDeleGator.sol:369-390`, `src/libraries/P256VerifierLib.sol`,
`P256SCLVerifierLib.sol`, `WebAuthn.sol`):

- 65-byte signature: ECDSA by the optional EOA `owner`.
- 96 bytes: a raw P-256 signature over `sha256(hash)`. It is handy for a non-WebAuthn P-256 key such as a
  Secure Enclave or Android Keystore key, or an ESP32 hardware P-256 key.
- Anything else: WebAuthn, `abi.encode(keyIdHash, r, s, authenticatorData, requireUV, clientDataJSONPrefix,
  clientDataJSONSuffix, responseTypeLocation)`. The challenge is the 32-byte hash. Our spike's signatures are
  544 bytes.
- Verification calls the precompile at `0x100` first and falls back to the Smooth Crypto Library.
  - **`s` must be low** (`s ≤ n/2`), or the signature is rejected. `@metamask/smart-accounts-kit`'s
    `encodeDeleGatorSignature` normalises it.
  - The verifier does **not** check origin or rpIdHash (`WebAuthn.sol` comments). The authenticator's RP binding
    is trusted, which is normal for on-chain WebAuthn.
- No ERC-7739 or replay-safe wrapping. A raw `personal_sign` signature is valid for every account that shares the
  key. EIP-712 payloads with their own domain (DM, USDC, Gateway) are unaffected.

**Signers.**

- `initialize(owner, keyIds[], xs[], ys[])`. The owner can be `address(0)`, which gives a passkey-only account.
  The account can't drop its last signer (`CannotRemoveLastSigner`).
- `addKey`, `removeKey`, `updateSigners` and `transferOwnership` are `onlyEntryPointOrSelf`. A delegation whose
  execution targets the account itself satisfies "self" (simulated).
- Every key is full-power. There are no per-key policies, which is fine: policies live in grants.

**Deploy.**

- `SimpleFactory.deploy(ERC1967Proxy.creationCode ‖ abi.encode(impl, initialize(...)), salt)`. Anyone may submit
  it. The address commits to the initial signer set, so front-running is harmless.
- Our relayer deploys at signup. That cost ≈245k gas ≈ **$0.005**.
- `DelegationManager` has no ERC-6492 support. A **counterfactual account can't be a delegator**, because its
  signature is checked as ECDSA because `code.length == 0`. So deploy before the first grant.
- The kit's `toMetaMaskSmartAccount(...).signTypedData/signMessage` returns an **ERC-6492-wrapped** signature
  while the account is undeployed (2,400 B in the spike). USDC and Gateway don't accept it. Unwrap it, or
  sign after deployment.

**4337 is there if wanted.** The `entryPoint()` immutable on Arc is v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032`
and `execute` is `onlyEntryPoint` (`DeleGatorCore.sol:177-188`). We don't need it (§3.3).

**Liveness dependency.** `DelegationManager.owner()` on Arc is the **EOA** `0xB0403B32f54d0Bd752113f4009e8B534C6669f44`.
It can `pause()` redemption, which would freeze all grants and our owner-action path. `paused()` returns `false`
today. The 4337 path keeps working while the DM is paused, because owner actions can go through EntryPoint v0.7.
That is a reason to keep 4337 as a break-glass path.

**Other passkey accounts.** See table 1.2. CBSW, Kernel and Safe all work on Arc, but each brings its **own**
permission system, so the AI-client / robot / merchant stack would need a second grant model. The OZ route means
writing and owning the account contract.

### 2.2 B. EOA + 7702 with a passkey-PRF key

**How.**

1. On signup, generate a random secp256k1 key.
2. Wrap it with an AES key derived via HKDF from a PRF output, taken from a `get()` call, never from `create()`.
3. Store the ciphertext on our server.
4. The key signs a 7702 authorization to `EIP7702StatelessDeleGator` `0x63c0…E32B`. Our relayer can submit it
   as a sponsored type-4 tx. Use `chain_id = 0` to make one authorization valid on every chain while the
   nonce matches; for a fresh key that's nonce 0 everywhere
   ([EIP-7702](https://eips.ethereum.org/EIPS/eip-7702)).
5. After that, the same key signs DF delegations and one-time actions. The stateless delegator's 1271 is just
   `ECDSA.recover == address(this)` (`EIP7702StatelessDeleGator.sol:54-58`).

The simulation ran this path with a code override (`0xef0100 ‖ 0x63c0…E32B`). A root grant redeemed by the relayer
paid 1 USDC (≈180k gas), and an over-cap amount reverted.

**Wrap, don't derive.** Deriving the key from PRF ties the address forever to one credential. You can't add a second
passkey or rotate. Re-creating a passkey for the same `user.id` silently replaces it, with a new PRF and so a new
key. Wrapping lets several passkeys and a recovery code each wrap the same key (Yubico and Corbado guidance;
[Tim Cappalli, Feb 2026](https://blog.timcappalli.me/p/passkeys-prf-warning/)). NorKey is a working example: it
decrypts only inside an isolated boundary page.

**PRF support matrix, late 2026** *(web check; sources: [Corbado](https://www.corbado.com/blog/passkeys-prf-webauthn),
[passkeys.dev](https://passkeys.dev/device-support/), [mera support page](https://mera.category.xyz/authenticator-support/),
[MS KB5077181](https://support.microsoft.com/en-us/servicing/os/windows-11/2026/02/february-10-2026-kb5077181-os-builds-26200-7840-and-26100-7840),
[WebKit 26.4](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/), [Yubico](https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html))*

| Platform / provider | PRF on `get()` | Synced | Notes |
|---|---|---|---|
| iOS/iPadOS ≥18.4, any browser (WebKit) + iCloud Keychain | ✅ | iCloud | 18.0–18.3: hybrid returned no or **different** values. `create()` output unreliable |
| macOS 15+ Safari / Chrome 132+ / Firefox 139+ with iCloud Keychain | ✅ | iCloud | Security keys only from Safari 26.4; WebKit bugs 311099 and 314934 open |
| Chrome / Edge desktop + Google Password Manager | ✅ | GPM | Chrome 132+ |
| Chrome **profile** (local) authenticator | ❌ | no | `getClientCapabilities()` still reports `prf: true` |
| Android Chrome / Edge / Samsung Internet + GPM | ✅ | GPM | Firefox Android 149+ platform authenticator only |
| Windows 11 Windows Hello | ✅ since **KB5077181 (10 Feb 2026)**, Chrome/Edge 147+, Firefox 148+ | **no (one PC)** | Windows 10 and older builds ❌ |
| Edge + Microsoft Password Manager (synced) | ❌ (`NotAllowedError`) | MS | unusable |
| 1Password, Proton Pass, Keeper, Enpass | ✅ | yes | |
| Bitwarden | mostly ❌ | yes | no roadmap |
| Dashlane, NordPass | ❌ | | |
| Samsung Pass | ✅ get, ❌ create | Samsung | |
| YubiKey 5 (fw ≥5.2), Titan v2 | ✅ get (hmac-secret) | no | `create()` needs CTAP 2.2 `hmac-secret-mc` |
| Hybrid (QR) | ✅ | phone's | older iOS gave wrong values |

Within one provider the PRF value is stable across synced devices, by spec. Across ecosystems it differs, because
those are different credentials. WebAuthn Level 3 (W3C Recommendation, 25 Aug 2026) includes PRF
([W3C](https://www.w3.org/TR/webauthn-3/)). CXF 1.0 can carry `hmacCredentials`, so PRF can survive a provider
export, but Apple's and Google's actual export of them is unverified.

**Security model.** PRF output reaches page JS in plaintext. A compromised dependency, XSS or an injected extension
on the signing page gets the key. Safe's maintainers put it as: PRF gives software-wallet security, while on-chain
P-256 gives hardware-wallet security ([safe-modules #246](https://github.com/safe-fndn/safe-modules/issues/246)).
With 7702 the secp256k1 key stays the **permanent root** of the address: no rotation, and no on-chain limit on it.

**Why it is only the fallback.** It is weaker than A on coverage, key exposure and recovery. It is stronger on
cross-chain:

- the same address everywhere;
- plain-ECDSA Gateway intents, plus `depositFor` to our address from any chain;
- funds sent on any EVM chain are always recoverable.

Choose it if a real-device spike shows WebAuthn assertions failing in the Hybrid verifier, or if
Gateway-on-every-chain becomes a requirement.

### 2.3 C. Connect existing wallet

From the helper pass *(web check)*, which read code in MetaMask/core, metamask-extension, snap-7715-permissions,
Rabby, Ambire, Rainbow and Uniswap, plus the ERCs.

**ERC-7715 (MetaMask "Advanced Permissions").**

- The method is now **`wallet_requestExecutionPermissions`**; `wallet_grantPermissions` is the old name. Companions
  are `wallet_getSupportedExecutionPermissions`, `wallet_getGrantedExecutionPermissions` and
  `wallet_revokeExecutionPermission`.
- The ERC is still **Draft** ([EIP-7715](https://eips.ethereum.org/EIPS/eip-7715)).
- **MetaMask extension only.**
  - Stable ≥ v13.23.0 has the stream and periodic types; allowance types need ≥ v13.32.1.
  - **Mobile has no handler.**
  - The call goes through the extension to `permissions-kernel-snap` and then `@metamask/gator-permissions-snap`
    (`references/MetaMask_snap-7715-permissions`).
- **Arc is supported:**
  - Requests must target chains in MetaMask's `confirmations_eip_7702.supportedChains` remote flag, which includes
    `0x13b2`, plus Base and others.
  - The user must have Arc added as a network.
  - The account **must be upgraded via 7702 to `EIP7702StatelessDeleGator` `0x63c0…E32B`**. The snap triggers
    `wallet_upgradeAccount`, an on-chain tx from the user, so they need a little USDC on Arc for gas.
- **The response is a DF chain.**
  - `context = encodeDelegations([root])` with `delegator = user EOA` and `delegate = the requested address`.
  - Caveats: permission enforcer + `expiry` / `redeemer` / `payee` rules + `NonceEnforcer`.
  - `delegationManager = 0xdb9B…dB3`, and `dependencies = []`.
  - So **our relayer redeems it exactly like our own grants**.
  - The types are limited to native and ERC-20 stream / periodic / allowance and token-approval revocation. We
    **add our own caveats** (merchant set, per-payment cap, co-sign) by sub-delegating from that context to the
    final grantee; every hop's caveats apply.

**ERC-7710** is Draft, and the only real manager is MetaMask's DF. x402's `exact` scheme has an `erc7710` method
naming it ([EIP-7710](https://eips.ethereum.org/EIPS/eip-7710)).

**EIP-5792** (`wallet_sendCalls`, `wallet_getCapabilities`) has been **Final** since 2025-05
([EIP-5792](https://eips.ethereum.org/EIPS/eip-5792)).

- MetaMask's `atomic` capability needs the 7702 upgrade to its own delegator. MetaMask rejects non-optional
  capabilities except `auxiliaryFunds`, so `paymasterService` (ERC-7677) must be marked optional.
- Coinbase/Base, Ambire, Safe and Uniswap support it. **Rabby doesn't** (`methodNotFound`).
- It batches a user's own calls. It is not a grant mechanism.

**A dapp-chosen 7702 authorization: no wallet allows it.**

- MetaMask throws "External EIP-7702 transactions are not supported" (`MetaMask/core
  transaction-controller/src/utils/validation.ts:83-100`).
- Ambire, OKX, Trust, Rainbow, Uniswap, Phantom and Base Account only delegate to their own contract.
- Rabby has no 7702 for dapps.
- No ERC defines `wallet_signAuthorization`. ERC-7902's `eip7702Auth` capability is Draft and implemented by
  nobody.

**MetaMask's Delegation-signing guard.**

- Location: `MetaMask/core packages/signature-controller/src/utils/validation.ts:260-294`.
- It rejects `eth_signTypedData_v4` with `primaryType = "Delegation"` from an external origin **only when
  `message.delegator` is one of the wallet's own EOAs**. It also rejects a `verifyingContract` that is an internal
  account, and requires the domain `chainId` to equal the active chain.
- So a MetaMask EOA **can** sign a `Delegation` whose delegator is **our Hybrid account**, with the EOA as its
  `owner`. MetaMask shows a generic typed-data prompt, and it validates on-chain: Hybrid's 65-byte path is
  `ECDSA.recover(hash) == owner()`.
- Other wallets don't decode `Delegation`; Rabby shows "Unknown Signature Type".

**Coinbase/Base Account.**

- Its spend permissions (SpendPermissionManager, also deployed on Arc) and sub-accounts **don't support Arc**: the
  SDK's chain whitelist lacks Arc.
- The Base App was renamed back to Coinbase Wallet on 2026-09-10.

**What is truly universal.** Every wallet can (a) send a USDC transfer on its own chain and (b) sign EIP-712 typed
data. So:

1. **External wallet = funding source** (always). The user funds by an Arc transfer, or by CCTP-with-forwarding /
   Gateway from its home chain (§3.6).
2. **External wallet = EIP-712 owner key of a Hybrid account** (optional, universal). The user's grants are then
   signed by MetaMask, Rabby, Coinbase and others with `eth_signTypedData_v4`. Our relayer submits everything, so the
   wallet never needs Arc gas. The UX is an opaque typed-data prompt, so our own consent screen must show the policy
   before the wallet prompt.
3. **MetaMask extension user with a 7702 smart account** (bonus): `wallet_requestExecutionPermissions` on Arc. The
   grant is rooted at their own EOA, so funds stay in MetaMask. It's the nicest flow for that one wallet.

So yes: **"external wallet = funding source (plus optional owner key)" is the honest universal answer**. 7715 is a
MetaMask-only enhancement that happens to cover Arc.

## 3. Cross-cutting

### 3.1 One grant system for every account (verified in code and simulation)

`DelegationManager.redeemDelegations` (`src/DelegationManager.sol:126-209`):

1. Decodes a leaf → root chain.
2. Requires `chain[0].delegate == msg.sender || ANY_DELEGATE (0xa11)`.
3. Checks every hop's signature: **ECDSA if `delegator.code.length == 0`, ERC-1271 otherwise**.
4. Checks `chain[i].authority == hash(chain[i+1])` and `chain[i].delegator == chain[i+1].delegate` (unless
   `ANY_DELEGATE`), and that no hop is disabled.
5. Runs every hop's caveat hooks around the execution on the **root** delegator via `executeFromExecutor`.

Consequences:

- The **root** must be a DF delegator: Hybrid, MultiSig, a 7702 EOA on the stateless delegator, or a MetaMask
  smart account.
- **Middle hops and leaves can be anything that signs.** A plain EOA (AI client key, robot key, server session key)
  signs with ECDSA. A contract (another user's smart account, a merchant escrow) signs with 1271.
- So **a grantee is just an address**. The wallet can't tell, and doesn't need to know, what is behind it.

Simulated on Arc (appendix): passkey Hybrid root, EOA middle hops, open leaf. 7702 root via code override. Same
encoding (`encodeDelegations`), same enforcers, same `redeemDelegations` call.

### 3.2 Sub-delegation (owner → AI client → robot, narrower each hop)

- A child delegation names the parent's hash as `authority`. It is signed by the parent's delegate and adds its
  own caveats.
- **Every hop's caveats run on every redemption**, so a child can only narrow. In the spike, root ≤ 5 USDC,
  AI → robot ≤ 2 USDC, and the robot's open leaf ≤ 2 USDC:
  - paying 2 succeeded (merchant +2,000,000 units);
  - paying 3 reverted with `ERC20TransferAmountEnforcer:allowance-exceeded`.
- Revoking any hop (`disableDelegation`) kills everything under it. The spike's root revoke made the next redemption
  fail with `CannotUseADisabledDelegation`.
- `smart-accounts-kit` has `createDelegation({ parentDelegation })`, `createOpenDelegation` (delegate =
  `ANY_DELEGATE`, needs `allowInsecureUnrestrictedDelegation` to sign) and `redelegatePermissionContext[Open]`
  for 7715 contexts (`packages/smart-accounts-kit/src/actions/redelegatePermissionContext.ts`).
- Stateful enforcers key their state by delegation hash. A period cap on the root is shared by everything below it,
  which is what we want: the root cap is the owner's real ceiling.

### 3.3 Gas abstraction with no hosted bundler

**Recommended: a bundler-free relayer.** One relayer EOA (a Cloudflare secret plus a small native-USDC float) sends:

- `SimpleFactory.deploy` at signup.
- `redeemDelegations` for grantee payments (open leaf or grantee-signed).
- `redeemDelegations` for **owner actions**. The owner passkey-signs a **one-time delegation**
  `owner → relayer` with caveats:
  - `exactExecution(target, 0, calldata)` (or `exactExecutionBatch`);
  - `limitedCalls(1)`;
  - `redeemer([relayer])`;
  - optionally `timestamp(deadline)`.

  The relayer can't alter or replay it (spike A4/A5/A7). Sends, revokes (`DM.disableDelegation`), `addKey`,
  Gateway deposits and CCTP burns all take this shape.
- For a 7702 account, also the sponsored type-4 authorization.

Measured with `eth_estimateGas`, including Multicall3 overhead and a 21k base; × 20 gwei (Arc's floor, 1 gas ≈
2×10⁻⁸ USDC):

| Action | Gas | ≈ USDC |
|---|---|---|
| Deploy passkey Hybrid | ~245k (270k with overhead) | 0.005 |
| Owner one-time action (WebAuthn root, 3 caveats) | ~297k | 0.006 |
| AI-client grant, 2 hops (passkey root + EOA open leaf) | ~316k | 0.006 |
| 3 hops (owner → AI → robot → open leaf) | ~409k | 0.008 |
| 7702 root, 1 hop (ECDSA) | ~180k | 0.004 |

Who pays is an open product decision. Either the platform absorbs it, or the execution is a batch that also pays the
relayer a fee, counted against the grant's cap. DF's `NativeTokenPaymentEnforcer` exists for "pay the redeemer"
designs.

**Self-hosted 4337 bundler (break-glass or optional).**

- Hybrid accounts speak EntryPoint v0.7.
- Arc's public RPC returns `method not supported` for `debug_traceCall`, `eth_simulateV1` and `txpool_*`, and it
  rate-limits within seconds (429s in our spike). A spec-compliant bundler needs a tracing node.
- Options: Alto `--safe-mode false` (`src/cli/config/options.ts:46-51`), Rundler `--unsafe` (`docs/cli.md:80`),
  Skandha `--unsafeMode` (README), or run `arc-node` ourselves. Voltaire (Python, Candide) also exists.
- Unsafe mode is acceptable for a **private** bundler that serves only our accounts, since ERC-7562 rules protect a
  public mempool. It still adds a service and a userOp signature path for nothing the relayer can't do.
- Keep it as the path that still works if MetaMask pauses the `DelegationManager`.

Whatever we pick, the relayer needs a **non-public RPC** (a paid Arc endpoint or our own node), because the public
one throttles.

### 3.4 Recovery

- **A (default).** Several layers, each simulated or stock:
  - Synced passkeys cover device loss within one ecosystem.
  - Add more passkeys from other ecosystems or a YubiKey via one-time `addKey` (spike A7).
  - Optionally set an EOA `owner`, e.g. the user's MetaMask, as a recovery key.
  - **Guardians as a delegation:** pre-sign `owner → guardian` (a guardian EOA or a DF `MultiSigDeleGator` of
    friends' EOAs) with `allowedTargets[self]`, `allowedMethods[addKey]` and `limitedCalls(1)`.
  - Gaps: there is no stock time-lock or "challenge period" enforcer, so a guardian can act immediately. A delay
    needs a custom enforcer. And if all passkeys are lost and there is no guardian or owner key, the funds are lost.
- **B (fallback).** The PRF-wrapped key is recoverable only if it's wrapped under several passkeys or a recovery
  code. Losing them means losing the funds. The address's root key can't be replaced, only abandoned by moving
  the funds.
- **C.** The external wallet's seed.

### 3.5 The address across chains

- **A.** `CREATE2(SimpleFactory, salt, keccak(proxyInitcode))`. The initcode commits to impl + owner + initial keys.
  DF v1.3.0 shares those addresses across its chains (Base, Ethereum, …), so the **counterfactual address is the
  same everywhere for the same initial signers**.
  - Later `addKey` or `removeKey` are per chain and do not sync. CBSW has `executeWithoutChainIdValidation`; DF
    does not.
  - To use another chain, deploy there with the original config, then replay key changes, each with a fresh
    passkey signature because DM domains are per chain.
  - Pick `salt = hash(userId)` and keep the original key list forever.
- **B / C.** EOA, the same everywhere. A 7702 delegation is per chain unless signed with `chain_id = 0`.

### 3.6 Circle Gateway compatibility

From `circlefin_evm-gateway-contracts/src/modules/wallet/Burns.sol:316-358` and Circle's
[ERC-1271 page](https://developers.circle.com/gateway/references/erc-1271.md).

**On-chain burn signature check.**

- (1) ECDSA, recovered == `sourceSigner`.
- (2) **TEE vouch**: an ECDSA signature by a registered contract-signature signer. This is what
  `contractSigner: true` turns into after Circle's enclave simulates `isValidSignature` with a 2-of-3 RPC quorum,
  on blocks up to 5 minutes old.
- (3) Allowlisted contracts verified with on-chain 1271.

Then `sourceSigner` must be the depositor or an authorized delegate (`Burns.sol:479-491`).

**Must the account be deployed on the source chain? In practice, yes.**

- The enclave simulates `isValidSignature` on the burn's source domain.
- ERC-6492 isn't mentioned, and state-changing validation isn't supported.
- For the passkey account, **use Arc as the Gateway source**: the account is deployed there and the precompile is
  there. Deploy on other chains only if we need balances there.

**`depositFor(token, depositor, value)`** (`Deposits.sol:79-93`) credits `depositor`'s balance on *that* chain's
GatewayWallet. If an external wallet calls `depositFor(USDC, ourAccount, x)` on Base, spending it needs our account
to sign with contractSigner **on Base**, so it must be deployed there. Avoid it for A unless we deploy on Base. It is
fine for B, which is ECDSA.

**External wallet deposits on Base, mints to our account on Arc: ✅, two ways.**

1. **Gateway.** The EOA `deposit`s on Base, waits for finality (~13–19 min, or FAST), then signs a burn intent
   (ECDSA, depositor = signer = the EOA) with `destinationRecipient = our Arc account`. With
   `/v1/transfer?enableForwarder=true`, Circle mints on Arc and charges the fee out of the amount.
2. **CCTP v2.** The EOA calls `depositForBurnWithHook` on Base with `mintRecipient = our Arc account` and the
   `cctp-forward` hook. Circle's Forwarding Service submits the Arc mint.
   - Arc is ✅ as a forwarding destination and as a source
     ([supported chains](https://developers.circle.com/cctp/concepts/supported-chains-and-domains.md),
     [forwarding](https://developers.circle.com/cctp/concepts/forwarding-service.md)).
   - Fee: $0.05 + destination gas, from `maxFee`.
   - It doesn't need our account to exist anywhere but Arc. **This is the simplest inbound rail.**

**Passkey account into its own unified balance.**

- `GatewayWallet.depositWithAuthorization(..., bytes signature)` accepts SCA (1271) 3009 signatures
  (`Deposits.sol:173-200`). The passkey signs, our relayer submits on Arc, and no delegation is needed.
- The spike proved the same 3009 + 1271 path against USDC directly (B2).
- To spend elsewhere, sign a burn intent on Arc with `contractSigner: true`.
- Workaround if contractSigner misbehaves: the account `addDelegate`s an ECDSA key on Arc. But a delegate holds a
  full allowance, and revocation doesn't cancel intents it already signed.

### 3.7 Receiving USDC someone sends on another chain

- **On Arc:** any `transfer` to the account address. Gateway and CCTP mints to contracts are fine. Arc's
  "native value to contracts" caveat is about calls with `value`, not ERC-20 credits.
- **From another chain:** give the sender a "send to Arc" instruction or a link that does CCTP + forwarding with
  `mintRecipient` = our address. Their wallet pays source gas.
- **If someone sends plain USDC to our address on Base**, the funds sit at our counterfactual address there:
  - For A: deploy the account on Base with the original signer set (our relayer needs ETH on Base, ~cents), then a
    one-time delegation runs CCTP to Arc.
  - For B: always recoverable with the EOA key.
  - Product decision: warn in the UI ("Arc only") or support lazy Base deployment.

### 3.8 What "swap" can mean

- **USDC ↔ EURC on Arc:**
  - **App Kit Swap** (`kit.swap`; Circle-hosted backend, optional API key, "on Arc only USDC, EURC, cirBTC").
    Arc *mainnet* support and smart-account signing are unconfirmed in the docs
    ([swap](https://docs.arc.io/app-kit/swap.md)).
  - **StableFX** is live on Arc mainnet since 2026-09-16 (`FxEscrow` `0xe2E5…DFe6`). It is an institutional
    maker/taker RFQ API with Permit2-signed trades
    ([release notes](https://developers.circle.com/release-notes/stablefx-2026.md)). Permit2 accepts 1271, so a
    Hybrid could be a taker if Circle grants access.
- **Other tokens → USDC:** swap on the source chain (a DEX router; the user's wallet pays), then CCTP to Arc. Or use
  App Kit's cross-chain swap.
- **Recommendation:** out of scope for iteration 1. At most, a USDC→EURC App Kit call as a stretch.

## 4. Recommended architecture

### 4.1 Account model

- **Default: passkey-native `HybridDeleGator` per user on Arc.**
  - Passkey-only (`owner = 0`), created with `pubKeyCredParams: [{alg: -7}]` (ES256 only, so Windows Hello
    doesn't pick RS256), `residentKey: required` and `userVerification: required`.
  - Salt = hash(userId). Deployed by our relayer at signup.
- **Connect existing wallet:**
  - (i) **Fund from it.** A direct Arc transfer, or CCTP-forward / Gateway from its chain.
  - (ii) **Optionally become an owner key** of the Hybrid (`transferOwnership(eoa)` as a one-time action, or
    `owner = eoa` at creation for "sign up with MetaMask, no passkey"). It then signs EIP-712 `Delegation`s.
  - (iii) **MetaMask Advanced Permissions (7715)** as a bonus import path: the returned permission context is a DF
    chain, and we redeem it like ours.
- **Fallback: 7702 EOA + PRF-wrapped key → `EIP7702StatelessDeleGator`**, with the same grants, relayer and
  enforcers. Only the "who signs" layer changes. It's the switch if real-device WebAuthn verification or Gateway
  contractSigner fails.

### 4.2 How "grant to any grantee" is represented

A grant is a **signed DF delegation plus our metadata**. Nothing in it says "robot" or "AI".

```ts
type Grant = {
  id: string
  account: Address                 // delegator: the user's Hybrid (or 7702 EOA)
  delegation: Delegation           // { delegate, delegator, authority, caveats[], salt, signature }
  delegationHash: Hex              // the on-chain identity (revoke = DM.disableDelegation)
  parentGrantId?: string           // sub-delegation: authority = parent's delegationHash
  delegate: Address | "ANY"        // what DM checks: msg.sender, or the next hop's delegator
  custody: "grantee" | "wallet"    // who holds the delegate's key
  redeemers: Address[]             // RedeemerEnforcer: usually [ourRelayer] (+ grantee if it pays its own gas)
  policy: {                        // human view of the caveats, rendered on the consent screen
    token: "USDC"; perPeriod?: { amount: bigint; seconds: number }; total?: bigint; perPayment?: bigint
    merchants?: Address[] | "any"; expiresAt?: number; nativeValue: 0n
    requires?: string[]            // e.g. "age>=18 proof" (World flow; see world.md)
  }
  label: string                    // free text chosen by the user or the grantee ("Claude desktop")
  status: "active" | "revoked" | "expired"
}
```

- **Delegate address.** Whatever the grantee hands us:
  - an EOA (robot key, AI-client key, another person's wallet);
  - a contract (another smart account, a merchant escrow; it redeems itself, since `DeleGatorCore.redeemDelegations`
    exists, or signs children via 1271);
  - or `ANY_DELEGATE` for one-shot vouchers.
- **Custody.**
  - `grantee`: the grantee generated the key and only gave us an address. Robots and AI clients with their own
    keystore work this way. It signs its own children and vouchers.
  - `wallet`: the grantee can't hold keys (an MCP client with only an OAuth token). The wallet server creates one
    secp256k1 session key **per grant** and stores it encrypted. The grant's caveats bound the damage, and
    `redeemer([relayer])` keeps the key useless outside our relayer. The server signs vouchers and sub-delegations
    only on authenticated requests from that grantee.
  - Moving to `grantee` custody later means the server signs a narrower child to the grantee's own key. That is
    exactly "AI client → robot".
- **Caveats (stock, on Arc):**
  - `erc20PeriodTransfer` (daily cap), `erc20TransferAmount` (lifetime cap) or `erc20Streaming`;
  - `allowedTargets[USDC]` + `allowedMethods[transfer]`;
  - **`valueLte(0)`**, always: it closes the native-USDC exit;
  - `timestamp` (expiry), `limitedCalls`, `redeemer`, `nonce` (bulk revoke), `id` / `exactExecution` (one-shot);
  - `multiTokenPeriod` for USDC + EURC.
  - **Custom, from the older note:** per-payment cap + merchant set + co-signature enforcer. It's our Arc Studio
    artifact.
- **Sub-delegation** = a child grant with `authority = parent.delegationHash`, signed by the parent's delegate, with
  equal or narrower caveats. The wallet UI shows the tree. Revoking a node revokes its subtree.

### 4.3 Sequence: signup → fund → grant → pay

```mermaid
sequenceDiagram
  autonumber
  participant U as Owner (browser, passkey)
  participant W as Wallet server (API + MCP)
  participant R as Relayer (our EOA, USDC gas)
  participant A as Arc: SimpleFactory / DelegationManager / Hybrid account
  participant X as External wallet (any chain)
  participant C as AI client (grantee)
  participant M as Merchant
  Note over U,A: Signup
  U->>U: navigator.credentials.create (ES256, UV) -> P-256 pubkey (x,y), credential id
  U->>W: register (credential id, x, y)
  W->>W: address = CREATE2(SimpleFactory, salt=hash(userId), proxy(HybridImpl, initialize(0,[id],[x],[y])))
  W->>R: deploy
  R->>A: SimpleFactory.deploy(...)  (~$0.005)
  Note over U,X: Fund (any of)
  X->>A: USDC.transfer(account) on Arc
  X->>X: Base: depositForBurnWithHook(mintRecipient=account, hook=cctp-forward)
  X-->>A: Circle Forwarding Service mints USDC to account on Arc
  Note over U,C: Grant (AI client connects over MCP)
  C->>W: connect (OAuth) + its delegate address (or none, then W mints a wallet-held session key)
  W->>U: consent screen: "$5/day USDC, these merchants, until Sunday"
  U->>U: passkey signs Delegation{delegate, delegator=account, ROOT, caveats, salt}
  U->>W: signed root grant (stored; returned to C as its permission context)
  Note over C,M: Pay
  M-->>C: invoice / x402 requirement (merchant, amount, order id)
  C->>C: sign open leaf: exactExecution(USDC.transfer(merchant, amt)) + id + deadline
  C->>R: [leaf, root]  (or via W if wallet-held key)
  R->>A: DelegationManager.redeemDelegations([leaf, root], SingleDefault, transfer)
  A->>A: verify WebAuthn root (1271) + ECDSA leaf, run all caveats on every hop
  A->>M: USDC.transfer (account -> merchant), or revert
  Note over U,R: Owner actions (send, revoke, add passkey, Gateway/CCTP out)
  U->>R: passkey-signed one-time delegation owner->relayer: exactExecution + limitedCalls(1) + redeemer
  R->>A: redeemDelegations([oneTime], ...)
```

## 5. Confidence

| Item | Status | Evidence / what's missing |
|---|---|---|
| HybridDeleGator impl, SimpleFactory, DM, MultiSig, stateless 7702 delegator and the enforcers we use are on Arc; same build as Base | **Known** | `eth_getCode` + byte diff (only chain id + domain separator differ) |
| Passkey-only Hybrid deploys via SimpleFactory from any sender (~245k gas) | **Known** (simulated on mainnet state) | spike A0 |
| WebAuthn-signed delegations verify on Arc (precompile `0x100`, low-s), 544-byte sigs | **Known** with a software P-256 authenticator | spike A1/A4; real iOS / Android / Windows Hello / YubiKey assertions not yet tried |
| One grant system: passkey root, EOA mid-hops, open leaf, 7702 root, same encoding and enforcers | **Known** | `DelegationManager.sol:126-209`; spike A1, A6, C1 |
| Sub-delegation narrows; over-cap reverts; revoke kills the subtree; `addKey` via delegation | **Known** | spike A1, A2, A5, A7 |
| Passkey account signs EIP-3009 / 1271 (x402 `exact`, Gateway `depositWithAuthorization` shape) | **Known** for USDC 3009 | spike B2; must be deployed; ERC-6492 wrapper rejected (B1) |
| Arc public RPC: no `debug_traceCall` / `eth_simulateV1` / `txpool_*`; aggressive 429s | **Known** | direct calls |
| DM owner on Arc is an EOA that can pause | **Known** | `owner()` = `0xB040…f44`, no code; `paused()` = false |
| CBSW, Safe + passkey + 4337, Kernel + passkey 0.0.3, Calibur on Arc; Safe7579 / AllowanceModule / ZeroDev passkey 0.0.2 absent | **Known** | `eth_getCode` |
| CCTP forwarding to and from Arc; `depositFor` semantics; Gateway's three signature paths | **Known** (docs + code) | Circle docs; `Burns.sol`, `Deposits.sol` |
| Real-device WebAuthn on the Hybrid verifier (Safari clientDataJSON variants, UV flag, cross-device) | **Uncertain: needs a spike** | one real passkey on a phone + laptop, then `isValidSignature` via `eth_call` on a deployed test account |
| Gateway `contractSigner: true` with a 544-byte WebAuthn sig from a Hybrid on Arc → mint on Base with forwarder | **Uncertain: needs a spike** | $1 test; the API's signature size limits are unknown |
| Sponsored type-4 tx from our relayer for the fallback (real tx, not a code override) | **Uncertain: needs a spike** | one tx on Arc (7702 type-4 txs already exist on Arc) |
| Real gas on a broadcast tx vs estimates; relayer nonce and drop handling at 20 gwei | **Uncertain: needs a spike** | first real deploy + payment |
| CCTP `depositForBurnWithHook` (forward) executed from the Hybrid via a one-time delegation | **Uncertain: needs a spike** | small Arc → Base transfer |
| ERC-7715 is Draft; MetaMask extension (≥13.23) only, not mobile; Arc `0x13b2` on its 7702 chain list; result is a DF context rooted at the user's EOA (`0x63c0…E32B` upgrade) | **Known** (code + live flags, helper pass) | §2.3; a real MetaMask grant on Arc not yet requested |
| No wallet signs a dapp-chosen 7702 authorization; Rabby has no 5792 | **Known** (code + statements, helper pass) | §2.3 |
| MetaMask lets a dapp request a `Delegation` signature whose delegator is our Hybrid (EOA = owner) | **Known from code**, **Uncertain: needs a spike** for UX | guard at `signature-controller/src/utils/validation.ts:260-294` triggers only for internal-EOA delegators; try MetaMask, Rabby and Coinbase prompts, and check Blockaid warnings |
| MetaMask 7715 grant on Arc, then our sub-delegation with custom caveats, redeemed by our relayer | **Uncertain: needs a spike** | needs an extension user with Arc added and USDC for the upgrade tx |
| Self-hosted Alto/Rundler in unsafe mode against an Arc RPC | **Uncertain: needs a spike** | only if we want the 4337 break-glass path |
| Who pays relayer gas (absorb vs fee leg in the grant) | **Unknown: decision** | product |
| Recovery policy: guardians (immediate, no stock delay), EOA owner, extra passkeys | **Unknown: decision** | product + maybe a custom delay enforcer |
| Deploy accounts on other chains (same address) or "Arc-only" | **Unknown: decision** | affects §3.5–3.7 |
| Wallet-held session keys for keyless MCP clients (custody, storage, audit) | **Unknown: decision** | security review with system 2 |
| Accept MetaMask's DM pause risk; keep the 4337 path as break-glass? | **Unknown: decision** | |
| App Kit Swap on Arc mainnet with a smart account; StableFX access | **Unknown: needs research** | docs don't say |
| World proof bound to a grant (caveat terms vs off-chain attachment keyed by `delegationHash`) | **Unknown: needs research** | World note / system 4 |

## Appendix: the simulation (reproducible)

Script saved in the repo as `docs/research/spikes/wallet-accounts-v2-spike.ts.txt` (originally `/tmp/walletv2/spike/spike.ts`). It used Bun 1.4.4, `viem` 2.57.16 and
`@metamask/smart-accounts-kit` 2.0.0, which pulls `@metamask/delegation-deployments` 2.1.0. That release includes
`arcMainnet`, so `getSmartAccountsEnvironment(5042)` works.

- A software WebAuthn authenticator stands in for the passkey. It is a WebCrypto P-256 key, with
  `authenticatorData = sha256(rpId) ‖ 0x05 ‖ counter` and a standard `clientDataJSON`, and returns a DER
  signature through viem's `toWebAuthnAccount({ getFn })`.
- Everything runs in one `eth_call` to Multicall3 `0xcA11…CA11`, which plays the relayer.
- The state overrides were: the account's native balance (= its USDC ERC-20 balance on Arc), and, for C, the EOA's
  code = `0xef0100 ‖ EIP7702StatelessDeleGator`.

```ts
const owner = await toMetaMaskSmartAccount({ client, implementation: Implementation.Hybrid,
  deployParams: [zeroAddress, [credId], [x], [y]], deploySalt: "0x01", signer: { webAuthnAccount, keyId: credId } })
const { factory, factoryData } = await owner.getFactoryArgs()                  // SimpleFactory.deploy calldata
const root = createDelegation({ environment: env, from: owner.address, to: ai.address,
  scope: { type: ScopeType.Erc20TransferAmount, tokenAddress: USDC, maxAmount: 5_000_000n } })
const rootSigned = { ...root, signature: await owner.signDelegation({ delegation: root }) }   // WebAuthn, 544 B
const hop = createDelegation({ environment: env, from: ai.address, to: robot.address, parentDelegation: rootSigned,
  scope: { type: ScopeType.Erc20TransferAmount, tokenAddress: USDC, maxAmount: 2_000_000n } })
const hopSigned = { ...hop, signature: await signDelegation({ privateKey: aiKey, delegation: hop,
  delegationManager: env.DelegationManager, chainId: 5042 }) }
const leaf = createOpenDelegation({ environment: env, from: robot.address, parentDelegation: hopSigned, scope: /* ≤2 USDC */ })
// ... robot signs leaf with allowInsecureUnrestrictedDelegation: true
const redeem = encodeFunctionData({ abi: dmAbi, functionName: "redeemDelegations", args: [
  [encodeDelegations([leafSigned, hopSigned, rootSigned])], [ExecutionMode.SingleDefault],
  [encodePacked(["address","uint256","bytes"], [USDC, 0n, transfer(MERCHANT, 2_000_000n)])] ] })
// Multicall3.aggregate3([ {factory, factoryData}, {DelegationManager, redeem}, {USDC, balanceOf(MERCHANT)} ])
```

| Case | Result |
|---|---|
| A0 deploy only | ✅ address returned |
| A1 deploy + 3-hop (5 → 2 → 2 caps) pays 2 USDC | ✅ merchant 2,000,000; account 48,000,000 |
| A2 same, pays 3 USDC | ❌ `ERC20TransferAmountEnforcer:allowance-exceeded` (expected) |
| A3 root-only redeemed by a non-delegate | ❌ (expected: `delegate != msg.sender`, `InvalidDelegate`; run before revert decoding, reason not printed) |
| A4 owner one-time delegation to relayer pays 1 USDC | ✅ |
| A5 same one-time delegation twice | 2nd ❌ (expected) |
| A6 2-hop owner → AI, AI open leaf, pays 1 USDC | ✅ |
| A7 pay, owner revokes root (one-time), pay again, `addKey` (one-time), key count | ✅ / ✅ / ❌ `CannotUseADisabledDelegation` / ✅ / 2 |
| B1 1271 + 3009 with the kit's `signTypedData` output | ❌ (the signature was ERC-6492-wrapped: account counterfactual at signing time) |
| B2 same with the unwrapped 544-byte signature | ✅ `isValidSignature` = `0x1626ba7e`; 3009 moved 1.5 USDC |
| C1 7702 EOA (designator override), ECDSA root, pays 1 USDC | ✅ |
| C2 same, 6 USDC over a 5 cap | ❌ `allowance-exceeded` (expected) |

## Cloned repos (new in this pass)

All in `references/`, shallow, with `GIT_LFS_SKIP_SMUDGE=1`. `references/README.md` was not edited.

| Path | Upstream | Commit | Why |
|---|---|---|---|
| `references/safe-global_safe-modules` | https://github.com/safe-global/safe-modules | `9e5f3d0` | Safe passkey signer (`modules/passkey`), 4337 module, allowances: Arc address checks and comparison |
| `references/coinbase_smart-wallet` | https://github.com/coinbase/smart-wallet | `a4e83fd` | CBSW passkey owners, `replaySafeHash`, cross-chain replayable owner ops (contrast with Hybrid) |
| `references/pimlicolabs_alto` | https://github.com/pimlicolabs/alto | `94b1e46` | Self-hostable TS bundler; `safe-mode` flag for RPCs without tracing |
| `references/alchemyplatform_rundler` | https://github.com/alchemyplatform/rundler | `f055885` | Self-hostable Rust bundler; `--unsafe` skips `debug_traceCall` |
| `references/etherspot_skandha` | https://github.com/etherspot/skandha | `acba0d8` | Self-hostable TS bundler; `unsafeMode` |
| `references/MetaMask_snap-7715-permissions` | https://github.com/MetaMask/snap-7715-permissions | `60c8a92` | MetaMask's ERC-7715 implementation (Gator permissions snap): what an external MetaMask grant produces |
| `references/OpenZeppelin_openzeppelin-community-contracts` | https://github.com/OpenZeppelin/openzeppelin-community-contracts | `16cb98a` | ERC-7579 modules (`ERC7579Signature`, multisig, delayed executor) and `RoleAccount`, for an own-account route |
| `references/xanderslabs_norkey` | https://github.com/xanderslabs/norkey | `dc1e026` | Model B done properly: PRF-wrapped EOA keys, isolated boundary page, 7702 → Calibur, self-hosted |
| `references/oportetxyz_oportet` | https://github.com/oportetxyz/oportet | `94b31e7` | 2026 Porto fork (passkeys, session keys, 7702 relay): the "newer" option, read for patterns |

Not cloned:

- `candidelabs/voltaire` (105 MB, Python bundler): cited only.
- `MetaMask/core` (≈1 GB): read via the GitHub API.
- `wevm/ox` (191 MB): it ships inside viem.
- `base/webauthn-sol`: covered by OZ, Solady and DF.
- `openfort-xyz/openfort-7702-account`: archived.
- Already present and used: `MetaMask_delegation-framework` `b4b8c41`, `MetaMask_smart-accounts-kit` `555dd20`,
  `circlefin_evm-gateway-contracts` `c21d2d2`, `OpenZeppelin_openzeppelin-contracts` `efaa6f7`.

## Sources

- DF and kit: https://github.com/MetaMask/delegation-framework (`documents/Deployments.md`, `src/HybridDeleGator.sol`,
  `src/DelegationManager.sol`) · https://github.com/MetaMask/smart-accounts-kit · https://www.npmjs.com/package/@metamask/delegation-deployments (2.1.0)
- Arc: https://docs.arc.io/arc/references/evm-differences · https://docs.arc.io/arc/references/contract-addresses ·
  https://docs.arc.io/app-kit/swap.md · https://docs.arc.io/build/stablecoin-fx.md · RPC https://rpc.mainnet.arc.io
- Circle: https://developers.circle.com/gateway/references/erc-1271.md · https://developers.circle.com/gateway/howtos/manage-delegates.md ·
  https://developers.circle.com/cctp/concepts/forwarding-service.md · https://developers.circle.com/cctp/concepts/supported-chains-and-domains.md ·
  https://developers.circle.com/release-notes/stablefx-2026.md · https://github.com/circlefin/evm-gateway-contracts
- Other accounts: https://github.com/safe-global/safe-modules · https://github.com/coinbase/smart-wallet ·
  https://github.com/zerodevapp/sdk/blob/main/plugins/passkey/index.ts · https://github.com/zerodevapp/sdk/blob/main/packages/core/constants.ts ·
  https://github.com/Uniswap/calibur · https://github.com/openfort-xyz/openfort-7702-account · https://github.com/oportetxyz/oportet ·
  https://github.com/xanderslabs/norkey
- Bundlers: https://github.com/pimlicolabs/alto · https://github.com/alchemyplatform/rundler · https://github.com/etherspot/skandha ·
  https://github.com/candidelabs/voltaire
- 7715 / 7710 / 5792 and wallets (web check): https://eips.ethereum.org/EIPS/eip-7715 · https://eips.ethereum.org/EIPS/eip-7710 ·
  https://eips.ethereum.org/EIPS/eip-5792 · https://docs.metamask.io/smart-accounts-kit/concepts/advanced-permissions/ ·
  https://docs.metamask.io/smart-accounts-kit/get-started/supported-advanced-permissions/ ·
  https://github.com/MetaMask/core/blob/4e94d5499d7411f351aa04cff135a9683ccba9b4/packages/signature-controller/src/utils/validation.ts#L260-L294 ·
  https://github.com/MetaMask/metamask-extension/blob/0c56a8482af978edcb22c8ac198f89e6780fe69a/app/scripts/metamask-controller.js#L1238-L1290 ·
  https://github.com/MetaMask/metamask-extension/pull/40152 · https://github.com/MetaMask/snap-7715-permissions ·
  https://github.com/RabbyHub/Rabby/issues/3932 · https://github.com/ethereum/ERCs/blob/master/ERCS/erc-7902.md ·
  https://github.com/wevm/viem/discussions/3285 · https://docs.cdp.coinbase.com/coinbase-wallet/improve-ux/spend-permissions.md ·
  https://github.com/base/account-sdk · https://beta.walletbeat.eth.limo/wallet/eip/5792/
- EIPs and native AA: https://eips.ethereum.org/EIPS/eip-7702 · https://eips.ethereum.org/EIPS/eip-8130 ·
  https://docs.base.org/base-chain/specs/upgrades/cobalt/eip-8130 · https://ethdaily.io/account-abstraction-scheduled-for-hegota
- PRF (web check): https://www.corbado.com/blog/passkeys-prf-webauthn · https://passkeys.dev/device-support/ · https://www.w3.org/TR/webauthn-3/ ·
  https://fidoalliance.org/webauthn-level-3-is-now-a-w3c-recommendation/ · https://fidoalliance.org/specs/cx/cxf-v1.0-ps-20250814.html ·
  https://support.microsoft.com/en-us/servicing/os/windows-11/2026/02/february-10-2026-kb5077181-os-builds-26200-7840-and-26100-7840 ·
  https://webkit.org/blog/17862/webkit-features-for-safari-26-4/ · https://bugs.webkit.org/show_bug.cgi?id=311099 ·
  https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html · https://blog.timcappalli.me/p/passkeys-prf-warning/ ·
  https://mera.category.xyz/authenticator-support/ · https://github.com/safe-fndn/safe-modules/issues/246 · https://1password.com/blog/encrypt-data-saved-passkeys
