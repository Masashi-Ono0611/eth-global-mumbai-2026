# Contracts on chain (spec M1)

## RobotPaymentPolicyEnforcer (Arc mainnet, chain 5042)

| | |
| --- | --- |
| Address (`APP_ENFORCER_ADDRESS`) | `0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3` |
| Deploy tx | [0xdfc22a66…e3ca](https://explorer.arc.io/tx/0xdfc22a665871bc7eb5eec894c763346a90b0461b616e208597bd085a262ae3ca), block 29754137, `status 1`, gas 999733 at 21 gwei (≈ 0.021 USDC), 6 Nov ≈ 06:11 IST |
| Deployer | the relayer `0x404b09F43db64fB08f70b0b3e2b785bC312D6fDb` (nonce 4), right after the mainnet smoke |
| Command | `cd contracts && DEPLOYER_PRIVATE_KEY=<relayer key, from .env.main.local, never printed> forge script script/DeployArc.s.sol --rpc-url https://rpc.mainnet.arc.io --broadcast --with-gas-price 40gwei --priority-gas-price 1gwei` |
| Sources | `contracts/src/RobotPaymentPolicyEnforcer.sol` at `a0d25c2` (unchanged at `0f5bb06`), solc 0.8.23, `paris`, optimizer 200 |
| Approval domain | `domainSeparator()` on chain = `0xdd64e6796bfea718a8f2ef8c176d3d963cb46255313c56edcc27f1564dba3a42`, equal to `@ethmumbai/protocol` `domainSeparator(approvalDomain(0x7c21…e4D3))` |

Verification:

- **Runtime code = this build**: `keccak256(cast code 0x7c21…e4D3)` = `0x8ae1c544a79174dbaae0c617c21fa0a3b4e795fc06a6273b917018271081b653`
  = `keccak256(contracts/out/RobotPaymentPolicyEnforcer.sol/RobotPaymentPolicyEnforcer.json deployedBytecode)`.
- **Behaviour against live Arc state with exactly this runtime code**: `ARC_RPC_URL=https://rpc.mainnet.arc.io bunx
  vitest run packages/chain/test/LiveApproval.test.ts` → 1 passed (8 cases: under cap pays; over cap and unlisted payee
  revert `RPP:approval-required`; a valid approver signature pays; wrong payee / amount / signer revert
  `RPP:approval-payee-mismatch` / `RPP:approval-amount-mismatch` / `RPP:invalid-approval-signature`).
- **Explorer source verification: not done.** `forge verify-contract … --verifier blockscout --verifier-url
  https://explorer.arc.io/api/` was refused: the explorer API answers a Cloudflare browser challenge ("Just a
  moment…") to non-browser clients. To retry from a browser session or with Arc's support.

## EpisodeLog (0G Galileo, chain 16602)

Not deployed yet: it needs the 0G storage signer's Galileo gas (Kris). `contracts/script/DeployZg.s.sol` prints
`EPISODE_LOG_ADDRESS` (`contracts/README.md`).

## Arc Studio (6 Nov 11:40 IST)

Project: https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75 (created with `arc-studio run --prompt-file … --file <flattened>.sol:contracts/…`, one turn, 254 s). Studio compiled both flattened contracts unchanged on solc 0.8.23 / paris, wrote 42 Foundry tests (enforcer 33 incl. 2 fuzz; EpisodeLog 9), and deployed both to **Arc testnet** with its shared deployer:

| Contract | Arc testnet address | Deploy tx |
| --- | --- | --- |
| `RobotPaymentPolicyEnforcer` | `0xf334227646b3372f46b4d9d6b562189b7e35d711` | `0x2683071f952db97277b824675c1fb402a924c6363ec0a202075ce7d3adefadb2` |
| `EpisodeLog` | `0xe7019b50c2a519b1e61b0a46df695bc9b5333579` | `0x065dcf1012396fecfaf7c1554a026db58ec6e0e6c796ae2dbf072a2438e9c2b8` |

The Studio page reads `USDC()` (= `0x3600…0000`) and `domainSeparator()` from the live testnet enforcer, cross-checks `approvalDigest` against an EIP-712 hash computed in the browser, and has a `record()` form for the EpisodeLog. The app's approval digests are bound to chain 5042 and the mainnet enforcer, so the testnet deployment is for the Studio showcase only.
