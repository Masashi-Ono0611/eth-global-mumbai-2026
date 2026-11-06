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

| | |
| --- | --- |
| Address (`APP_EPISODE_LOG_ADDRESS`) | `0x4C947E6D794C78d0F684e46EFC97f712E51a206A` ([chainscan](https://chainscan-galileo.0g.ai/address/0x4C947E6D794C78d0F684e46EFC97f712E51a206A)) |
| Deploy tx | [0xe4eb07f3…bf69](https://chainscan-galileo.0g.ai/tx/0xe4eb07f387cc5a767c019f150cc7abca7424fa68ae092ab50fe1bc49b2bebf69), block 64122644, `status 1`, gas 282232 at ≈ 4 gwei, 6 Nov 12:00 IST (block time 06:30:05Z) |
| Deployer | the 0G storage signer `0xc6fF8A666f4C7F674C1D129C73b46D61f2891fcD` (nonce 0; funded 0.5 0G by Kris, [0xbfc30ee8…9651](https://chainscan-galileo.0g.ai/tx/0xbfc30ee8fa193c6aa144cf2d635efaf5b61c6d8d03d43a6f9b40180b1df69651)); ≈ 0.4988 0G left for uploads |
| Command | dry run, then `cd contracts && DEPLOYER_PRIVATE_KEY=<APP_ZG_STORAGE_PRIVATE_KEY from .env.main.local, never printed> forge script script/DeployZg.s.sol --rpc-url https://evmrpc-testnet.0g.ai --broadcast` |
| Sources | `contracts/src/EpisodeLog.sol` at `39ecb5e`, solc 0.8.23, `paris` |

Verification: `keccak256(cast code 0x4C94…206A)` = `0xc855393071a1cda13d3c0aa07f0b8c6ba644404b00fdabefb7937af0e1a5beb9`
= `keccak256(contracts/out/EpisodeLog.sol/EpisodeLog.json deployedBytecode)`. No explorer source verification attempted
yet (`contracts/README.md` lists the chainscan verifier URL).
