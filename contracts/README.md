# Vitaquack contracts (spec M1)

Two contracts, built and tested with Foundry (`forge` 1.8.3, solc 0.8.23, EVM `paris`):

| Contract                         | Chain                                           | What it does                                                                                                                                                             |
| -------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/RobotPaymentPolicyEnforcer` | Arc mainnet (5042)                              | A MetaMask Delegation Framework v1.3.0 caveat on the owner → chip grant: per-payment cap + payee allowlist; anything else needs the approver's one-time EIP-712 approval |
| `src/EpisodeLog`                 | 0G Galileo (16602); 0G mainnet (16661) accepted | Write-once anchor of an errand's 0G Storage root hash and the hash of its 0G request ids                                                                                 |

Arc Studio project: not created yet (Kris adds the `https://studio.arc.io/app/<id>` URL here).

## RobotPaymentPolicyEnforcer

The encodings are the app's (`packages/chain/src/Grant.ts`, `packages/protocol/src/Approval.ts`), checked byte for byte
by `test/Golden.t.sol`.

- **Terms** (`policyTerms`): `abi.encode(uint256 perPaymentCap, address[] allowlist, address approver)`.
- **Args** (`approvalArgs`): empty, or `abi.encode((bytes32 invoiceHash, address payee, uint256 amount, uint64 expiry,
  bytes32 nonce) approval, bytes signature)`, a 65-byte `r‖s‖v` signature. The relayer injects them per payment
  (`withApprovalArgs`); they are not part of the signed delegation.
- **Execution**: single call type, default exec type, exactly `abi.encodePacked(USDC, uint256(0), transfer(payee,
  amount))` (120 bytes; USDC = `0x3600000000000000000000000000000000000000`).
- **Rule**: `amount ≤ perPaymentCap` and `payee` allowlisted → pass (args ignored, nothing consumed). Otherwise the args
  must hold an approval with the same payee and amount, `block.timestamp ≤ expiry`, signed by `approver` over
  `approvalDigest`, and an unused nonce. The nonce is then spent and `PaymentApproved(delegationManager, delegationHash,
  nonce, delegator, invoiceHash, payee, amount)` is emitted.
- **Approval digest**: EIP-712, domain `{name: "VitaquackApproval", version: "1", chainId: block.chainid,
  verifyingContract: address(this)}`, struct `Approval(bytes32 invoiceHash,address payee,uint256 amount,uint64
  expiry,bytes32 nonce)`, signed raw (no EIP-191 prefix). The domain separator is computed per call, so the runtime code
  can be injected at any address with a state override and still verify approvals for that address
  (`packages/chain/test/LiveApproval.test.ts` does this on live Arc state).
- **Replay**: `usedNonces[msg.sender][nonce]`, keyed by the calling DelegationManager, so copying an approval from the
  mempool and calling the hook directly cannot burn the nonce a real redemption needs.
- **Revert reasons** (Delegation Framework string style, decoded verbatim by the facilitator): `RPP:approval-required`,
  `RPP:invalid-approval-signature`, `RPP:approval-expired`, `RPP:approval-nonce-used`, `RPP:approval-payee-mismatch`,
  `RPP:approval-amount-mismatch`, `RPP:invalid-execution-length`, `RPP:invalid-target`, `RPP:invalid-value`,
  `RPP:invalid-method`, `RPP:invalid-payee`; the base class adds `CaveatEnforcer:invalid-call-type` and
  `CaveatEnforcer:invalid-execution-type`.
- **Not checked here**: the payment's invoice hash. It is the leaf's `Id` caveat term, and a caveat only sees its own
  delegation's terms and args. On-chain, an approval binds payee, amount, expiry and one use. Its `invoiceHash` is
  covered by the signature and emitted in the event, and the leaf's `IdEnforcer` stops a second payment of the same
  invoice. An approval lifts neither the daily cap (`ERC20PeriodTransferEnforcer`) nor the grant's expiry.

Gas of `beforeHook` (the hook frame alone, as inside a redemption; `FOUNDRY_ISOLATE=false forge test -vvvv
--match-test test_gas`): **4,307** within policy, **35,482** on the approval path (signature check, nonce `SSTORE`,
event). Under forge's default isolation (`isolate = true`) the same calls report 29,983 and 64,358 gas, because each
then counts as a transaction with 21,000 intrinsic gas plus calldata.

## EpisodeLog

`record(string episodeId, bytes32 rootHash, bytes32 requestIdsHash)` stores `records[keccak256(bytes(episodeId))] =
{rootHash, requestIdsHash, recorder: msg.sender, recordedAt}` and emits `EpisodeRecorded(address indexed recorder,
bytes32 indexed episodeKey, string episodeId, bytes32 rootHash, bytes32 requestIdsHash, uint64 recordedAt)`. A second
record for the same episode reverts `AlreadyRecorded(bytes32 episodeKey)`; a zero root reverts `ZeroRootHash()`.
Getters: `records(bytes32) → (rootHash, requestIdsHash, recorder, recordedAt)` and `episodeKey(string)`. Anyone may
record; the stored recorder is the evidence of who wrote it. `requestIdsHash` is protocol's `requestIdsHash`
(`keccak256(utf8(requestIds.join(",")))`); the root hash is the 0G Storage locator, so no URI is stored.

## Test

```sh
cd contracts
forge build
forge test -vv
```

Offline; forge downloads solc 0.8.23 on first use. `test/Golden.t.sol` reads `test/fixtures/golden.json`, generated by
the app's TypeScript encoders. After a change to `Grant.ts` or `Approval.ts`, regenerate it from the repo root and
commit it:

```sh
bun contracts/test/fixtures/golden.ts && bunx oxfmt -c oxfmt.config.ts contracts/test/fixtures/golden.json
```

## Deploy (not broadcast yet)

Keys and RPC URLs come from the environment only; the scripts print addresses, never keys. `DEPLOYER_PRIVATE_KEY` is
the relayer/deployer key (`APP_RELAYER_PRIVATE_KEY`), `ARC_RPC_URL` the keyed Arc RPC (`APP_ARC_RPC_URL`), `ZG_RPC_URL`
the 0G RPC (`https://evmrpc-testnet.0g.ai` for Galileo). Each script refuses any other chain.

Arc mainnet. Arc drops transactions under 20 gwei. A dry run against live state (simulated on 6 Nov) estimates 1.30M
gas, at most 0.052 USDC at 40 gwei:

```sh
cd contracts
forge test
# Dry run: simulates against live Arc state, sends nothing.
DEPLOYER_PRIVATE_KEY="$APP_RELAYER_PRIVATE_KEY" forge script script/DeployArc.s.sol --rpc-url "$ARC_RPC_URL"
# Broadcast; prints ENFORCER_ADDRESS=0x…
DEPLOYER_PRIVATE_KEY="$APP_RELAYER_PRIVATE_KEY" forge script script/DeployArc.s.sol --rpc-url "$ARC_RPC_URL" \
  --broadcast --with-gas-price 40gwei --priority-gas-price 1gwei
```

0G Galileo. A dry run estimates 0.35M gas, about 0.0014 0G (faucet: 0.1 0G a day):

```sh
DEPLOYER_PRIVATE_KEY="$APP_ZG_STORAGE_PRIVATE_KEY" forge script script/DeployZg.s.sol --rpc-url "$ZG_RPC_URL"
DEPLOYER_PRIVATE_KEY="$APP_ZG_STORAGE_PRIVATE_KEY" forge script script/DeployZg.s.sol --rpc-url "$ZG_RPC_URL" --broadcast
```

Any funded Galileo key can deploy EpisodeLog; the deployer has no special role. The transactions land in
`broadcast/<script>/<chain>/run-latest.json`, which Git ignores.

### Verify after deploying

```sh
# Runtime code equals this build (same sources and settings, metadata included).
[ "$(cast code "$ENFORCER_ADDRESS" --rpc-url "$ARC_RPC_URL")" = \
  "$(jq -r .deployedBytecode.object out/RobotPaymentPolicyEnforcer.sol/RobotPaymentPolicyEnforcer.json)" ] && echo same
cast call "$ENFORCER_ADDRESS" "USDC()(address)" --rpc-url "$ARC_RPC_URL"   # 0x3600…0000
# The on-chain digest equals the app's approvalDigest for the deployed address (run from the repo root):
cast call "$ENFORCER_ADDRESS" "approvalDigest((bytes32,address,uint256,uint64,bytes32))(bytes32)" \
  "(0x1111111111111111111111111111111111111111111111111111111111111111,0x000000000000000000000000000000000000c0de,500000,1794000300,0x2222222222222222222222222222222222222222222222222222222222222222)" \
  --rpc-url "$ARC_RPC_URL"
bun -e "import { approvalDigest } from './packages/protocol/src/Approval.ts'; console.log(approvalDigest(
  process.env.ENFORCER_ADDRESS, { invoiceHash: '0x' + '11'.repeat(32), payee: '0x000000000000000000000000000000000000c0de',
  amount: '500000', expiry: 1794000300, nonce: '0x' + '22'.repeat(32) }))"
# EpisodeLog answers on Galileo:
cast call "$EPISODE_LOG_ADDRESS" "episodeKey(string)(bytes32)" aaaqeayeaudaocajbifqydiob4 --rpc-url "$ZG_RPC_URL"
```

Then set `APP_ENFORCER_ADDRESS` (app config, spec §10) and `EPISODE_LOG_ADDRESS` (netcup `~/.config/secrets.env`),
and record both addresses and the deploy transactions in `docs/evidence/`. Source verification on the explorers has
not been tried: Arc's explorer is Blockscout (`forge verify-contract <addr> src/RobotPaymentPolicyEnforcer.sol:RobotPaymentPolicyEnforcer
--chain-id 5042 --verifier blockscout --verifier-url https://explorer.arc.io/api/`), and 0G's skill documents
`--chain-id 16602 --verifier-url https://chainscan-galileo.0g.ai/api`.

## Arc Studio

Studio needs one file per contract. Flatten:

```sh
forge flatten src/RobotPaymentPolicyEnforcer.sol -o out/flat/RobotPaymentPolicyEnforcer.flat.sol   # ≈ 39 KB
forge flatten src/EpisodeLog.sol -o out/flat/EpisodeLog.flat.sol                                   # ≈ 2.5 KB
```

Checked on 6 Nov: each flattened file compiles on its own with solc 0.8.23 and `paris`, and its runtime bytecode
equals the project build's (compared with `bytecode_hash = "none"`). Constraints found:

- The flattened enforcer has one pragma, `=0.8.23 ^0.8.20 ^0.8.21 ^0.8.23`: Studio's Foundry must compile it with solc
  0.8.23 (the Delegation Framework pin). Its `evm_version = "paris"` matches ours.
- It is larger than Studio's 10,000-character prompt cap, so upload it as a file
  (`--file out/flat/RobotPaymentPolicyEnforcer.flat.sol:contracts/RobotPaymentPolicyEnforcer.sol`), not in a prompt.
- Studio deploys to Arc testnet (5042002) only. Approvals for a testnet deployment use chain id 5042002 and that address,
  so the app's digests (chain 5042) do not verify there. The Studio deployment is for the demo; the app uses ours
  on mainnet.
- `out/` is ignored by Git: regenerate the flattened files rather than committing them.

## Vendored dependencies (no submodules)

`lib/` holds verbatim copies of the few files these contracts import, at the commits the Delegation Framework v1.3.0
tag pins, with the upstream licences:

| Path                         | Upstream                                       | Commit                                     | Files                                                                                                       |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `lib/delegation-framework`   | github.com/MetaMask/delegation-framework       | tag `v1.3.0`                               | `src/enforcers/CaveatEnforcer.sol`, `src/interfaces/ICaveatEnforcer.sol`, `src/utils/{Types,Constants}.sol` |
| `lib/erc7579-implementation` | github.com/erc7579/erc7579-implementation      | `16138d1afd4e9711f6c1425133538837bd7787b5` | `src/lib/{ModeLib,ExecutionLib}.sol`, `src/interfaces/IERC7579Account.sol`                                  |
| `lib/account-abstraction`    | github.com/eth-infinitism/account-abstraction  | `7af70c8993a6f42973f520ae0752386a5032abe7` | `contracts/interfaces/PackedUserOperation.sol`                                                              |
| `lib/openzeppelin-contracts` | github.com/OpenZeppelin/openzeppelin-contracts | `105fa4e1b0832a6a40cb7ba6e545bb844f02a711` | `contracts/utils/cryptography/ECDSA.sol` (v5.0.0)                                                           |
| `lib/forge-std`              | github.com/foundry-rs/forge-std                | tag `v1.17.0`                              | `src/` (tests and scripts only)                                                                             |

The DF files are identical to `references/MetaMask_delegation-framework`. Remappings are in `foundry.toml`.
