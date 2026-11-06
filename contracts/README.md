# Vitaquack contracts (spec M1)

**Arc Studio is the source of all on-chain logic.** Both contracts live in the Studio project
https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75 (decision of 6 Nov, 16:00 IST). This directory keeps:

- `studio/`: a pinned, read-only pull of that project (provenance and sha256 of every file in `studio/PULL.md`);
- the Foundry project that builds, tests and deploys exactly those files (`foundry.toml`: `src = "studio/contracts"`);
- the repo's regression suite (`test/`, with golden vectors from the app's TypeScript encoders) and deploy scripts
  (`script/`).

The policy:

- **Change contracts in Studio, then pull here.** Never edit `studio/`. `forge fmt` and `forge lint` skip it.
- **Mainnet and 0G deploys come from the pull.** `DeployArc` and `DeployZg` deploy the pull built exactly as Studio builds
  it, so the deployed bytes equal Studio's own testnet deployment (Studio deploys only to Arc testnet).
- **EpisodeLog is the recorded exception.** It is Studio-authored, but Studio cannot deploy to 0G, so we deploy it to
  0G Galileo from the same pull.

| Contract                                          | Chain                                                            | What it does                                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `studio/contracts/RobotPaymentPolicyEnforcer.sol` | Arc mainnet (5042): `0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3` | A MetaMask Delegation Framework v1.3.0 caveat on the owner → chip grant: per-payment cap + payee allowlist; anything else needs the approver's one-time EIP-712 approval |
| `studio/contracts/EpisodeLog.sol`                 | 0G Galileo (16602): `0x4C947E6D794C78d0F684e46EFC97f712E51a206A` | Write-once anchor of an errand's 0G Storage root hash and the hash of its 0G request ids                                                                                 |

Studio's own Arc testnet deployments are listed in `studio/PULL.md`. The bytecode comparison of the pull with every
deployment is in `docs/evidence/contracts.md`. Both files are single flattened sources: the Delegation Framework,
erc7579 and OpenZeppelin `ECDSA` code they need is inlined.

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

## Pull from Studio

From `contracts/` (the token stays in `.env.main.local` and is never printed):

```sh
ARC_STUDIO_TOKEN=$(grep '^ARC_STUDIO_TOKEN=' ../.env.main.local | cut -d= -f2-) \
  bunx @circle-fin/arc-studio-cli@1.2.2 pull --app 63241623-a488-4452-ae23-ab151e4f2d75 --out studio \
  --paths 'contracts/*.sol' 'contracts/test/*.sol' 'contracts/script/*.sol' 'contracts/contract-metadata/*.json' \
  foundry.toml remappings.txt .foundry-version
```

Add `--dry-run --diff` first to see what changed. Then update `studio/PULL.md` (time, sha256 list, testnet
deployments), run the tests and the equivalence check below, and commit `studio/` with the deploy that uses it.
`studio/PULL.md` says why the frontend, Studio's build outputs and its agent files are not pulled.

## Test

```sh
cd contracts
forge build
forge test -vv
```

This needs no network once forge has solc 0.8.23. It runs Studio's own tests (`studio/contracts/test`, 42) and the
repo's (`test/`, 50: unit cases, fuzz and golden vectors) against the pulled sources. Studio's CREATE2 helper
(`studio/contracts/script`) is skipped: it imports OpenZeppelin from Studio's `node_modules`. `test/Golden.t.sol`
reads `test/fixtures/golden.json`, generated by the app's TypeScript encoders. After a change to `Grant.ts` or
`Approval.ts`, regenerate it from the repo root and commit it:

```sh
bun contracts/test/fixtures/golden.ts && bunx oxfmt -c oxfmt.config.ts contracts/test/fixtures/golden.json
```

## Deploy (from the pull)

Keys and RPC URLs come from the environment only; the scripts print addresses, never keys. `DEPLOYER_PRIVATE_KEY` is
the relayer/deployer key (`APP_RELAYER_PRIVATE_KEY`), `ARC_RPC_URL` the keyed Arc RPC (`APP_ARC_RPC_URL`), `ZG_RPC_URL`
the 0G RPC (`https://evmrpc-testnet.0g.ai` for Galileo). Each script refuses any other chain.

First build the pull exactly as Studio does, into `out/studio`. The scripts deploy those artifacts. Before
broadcasting, they check that the artifact's code equals this project's compile of `studio/` with the metadata
removed, and after deploying, that the deployed code equals the artifact's:

```sh
cd contracts
forge build && forge test && script/studio-build.sh
```

Arc mainnet. Arc drops transactions under 20 gwei. A dry run against live state estimates 1.30M gas, at most
0.052 USDC at 40 gwei:

```sh
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
`broadcast/<script>/<chain>/run-latest.json`, which Git ignores, as are `out/` and `cache/`. The live deployments
above predate the Studio decision. They were deployed from the former `contracts/src` (`a0d25c2`, `39ecb5e`), whose
code equals the pull's except for the metadata hash. They stay, because the app's approvals are bound to the enforcer's
address.

### Verify a deployment

```sh
# Executed code = the pull (with and without metadata), for any number of addresses; exit 1 on a difference:
script/runtime-equivalence.sh out/studio/RobotPaymentPolicyEnforcer.sol/RobotPaymentPolicyEnforcer.json \
  "Arc mainnet" "$ARC_RPC_URL" "$ENFORCER_ADDRESS" \
  "Arc testnet (Studio)" https://rpc.testnet.arc.io 0xf334227646b3372f46b4d9d6b562189b7e35d711
script/runtime-equivalence.sh out/studio/EpisodeLog.sol/EpisodeLog.json \
  "0G Galileo" "$ZG_RPC_URL" "$EPISODE_LOG_ADDRESS"
cast call "$ENFORCER_ADDRESS" "USDC()(address)" --rpc-url "$ARC_RPC_URL"   # 0x3600…0000
# The on-chain digest equals the app's approvalDigest for the deployed address (the bun line runs from the repo root):
cast call "$ENFORCER_ADDRESS" "approvalDigest((bytes32,address,uint256,uint64,bytes32))(bytes32)" \
  "(0x1111111111111111111111111111111111111111111111111111111111111111,0x000000000000000000000000000000000000c0de,500000,1794000300,0x2222222222222222222222222222222222222222222222222222222222222222)" \
  --rpc-url "$ARC_RPC_URL"
bun -e "import { approvalDigest } from './packages/protocol/src/Approval.ts'; console.log(approvalDigest(
  process.env.ENFORCER_ADDRESS, { invoiceHash: '0x' + '11'.repeat(32), payee: '0x000000000000000000000000000000000000c0de',
  amount: '500000', expiry: 1794000300, nonce: '0x' + '22'.repeat(32) }))"
```

Then set `APP_ENFORCER_ADDRESS` (app config, spec §10) and `EPISODE_LOG_ADDRESS` (netcup `~/.config/secrets.env`),
and record the addresses, the deploy transactions and the comparison in `docs/evidence/contracts.md`. Explorer source
verification on Arc failed: the Blockscout API answers a Cloudflare browser challenge (see the evidence file). For 0G,
the documented verifier is `--chain-id 16602 --verifier-url https://chainscan-galileo.0g.ai/api`.

## Dependencies

`lib/forge-std` is a verbatim copy of forge-std `v1.17.0` `src/` (github.com/foundry-rs/forge-std), with its
licences, used by the tests and scripts; no submodules. The contracts themselves have no imports.
