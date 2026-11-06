# Contracts on chain (spec M1)

## Source: the Arc Studio project

Both contracts are authored in Arc Studio, the single source of on-chain logic (decision of 6 Nov, 16:00 IST):
https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75. The repo holds a pinned, read-only pull in
`contracts/studio/` (provenance and sha256 of every file in `contracts/studio/PULL.md`, pulled 2026-11-06T10:03:50Z), and
`contracts/` builds, tests and deploys exactly those files.

- Studio pull `contracts/RobotPaymentPolicyEnforcer.sol` (sha256 `ff554c88be9024acaa4a8adec561a020c281c4314e71a45036a907fc69f6400a`)
  ⇒ Arc mainnet `0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3` and Studio's Arc testnet `0xf334227646b3372f46b4d9d6b562189b7e35d711`.
- Studio pull `contracts/EpisodeLog.sol` (sha256 `e5d17b7d9a8e1fb5fd24210b70d2df75a4bb37ad351eb7cfbc9df55b5f92e2b3`)
  ⇒ 0G Galileo `0x4C947E6D794C78d0F684e46EFC97f712E51a206A` and Studio's Arc testnet `0xe7019b50c2a519b1e61b0a46df695bc9b5333579`.
  Studio cannot deploy to 0G: EpisodeLog is the recorded exception, Studio-authored and deployed to Galileo by us.

### Runtime bytecode comparison (2026-11-06T10:14:40Z, read-only `eth_getCode`)

`cd contracts && forge build && script/studio-build.sh && script/runtime-equivalence.sh <artifact> <label> <rpc> <address> …`.
"Without metadata" drops the trailing CBOR metadata (its length is the code's last two bytes); everything else is the
code as executed.

| Contract | Code | Bytes | keccak256, full | keccak256, without metadata |
| --- | --- | --- | --- | --- |
| Enforcer | Studio-root build of the pull (`script/studio-build.sh`, `out/studio`) | 4383 | `0x5f907757…6f0d93` | `0x3bdb7c29f1cca2b260bd9902bede5e8ce5cd63115de356026d29728257dda0f7` |
| Enforcer | Studio's own artifact (`contracts/out` in the full pull) | 4383 | `0x5f907757…6f0d93` | same |
| Enforcer | Arc testnet `0xf334…d711` (deployed by Studio) | 4383 | `0x5f907757…6f0d93` | same |
| Enforcer | Arc mainnet `0x7c21…e4D3` | 4383 | `0x8ae1c544…81b653` | same |
| Enforcer | this project's build of the pull (`out/`, used by the tests) | 4383 | `0x85d68e54…7ec016` | same |
| EpisodeLog | Studio-root build of the pull (`out/studio`) | 1010 | `0x1c44a3d3…0c225f` | `0x89e603a191a93a2d97cc6d29a511a6867fc55182e6e932704541b058269cf237` |
| EpisodeLog | Studio's own artifact | 1010 | `0x1c44a3d3…0c225f` | same |
| EpisodeLog | Arc testnet `0xe701…3579` (deployed by Studio) | 1010 | `0x1c44a3d3…0c225f` | same |
| EpisodeLog | 0G Galileo `0x4C94…206A` | 1010 | `0xc8553930…a5beb9` | same |
| EpisodeLog | this project's build of the pull (`out/`) | 1010 | `0x53914d6c…0b94c7` | same |

Full hashes: enforcer `0x5f907757c8db88bfb5703792caf64b1afa166cf990be8a7cdd666e582f6f0d93`,
`0x8ae1c544a79174dbaae0c617c21fa0a3b4e795fc06a6273b917018271081b653`,
`0x85d68e541e06e1e5532333d38c5c30dd5964b16e04fd4f16cd543893cb7ec016`; EpisodeLog
`0x1c44a3d3224ee4f0e0e785e491ccaece400368e25fd62bfef4d469becd0c225f`,
`0xc855393071a1cda13d3c0aa07f0b8c6ba644404b00fdabefb7937af0e1a5beb9`,
`0x53914d6c66ccdb466d4be3819adfeb571b2abd0b2d1ad3eb9f044e95f70b94c7`.

What this shows:

- The executed code is the same everywhere: every row of a contract has the same hash without metadata.
- Built from Studio's root, the pull gives Studio's testnet code byte for byte, metadata included.
- The mainnet enforcer and the Galileo EpisodeLog were deployed before the decision, from `contracts/src/*.sol`
  (`a0d25c2`, `39ecb5e`). Only their metadata hash differs, because it covers the source paths (the multi-file sources,
  not the flattened `contracts/<Name>.sol`). Studio's files are `forge flatten` of those sources plus a trailing
  newline. They stay deployed: the app's approvals are bound to `0x7c21…e4D3`.
- `script/DeployArc.s.sol` and `script/DeployZg.s.sol` now deploy the Studio-root artifact after checking it against
  the project's compile of the pull. Rehearsed on local anvil (chain ids 5042 and 16602), the deployed code hashed
  `0x5f907757…` and `0x1c44a3d3…`, Studio's exactly. A later deploy from the pull is therefore byte-identical to Studio's.

### Studio's Arc testnet deployments

| Contract | Arc testnet (5042002) address | Deploy tx | Deployed |
| --- | --- | --- | --- |
| `RobotPaymentPolicyEnforcer` | [`0xf334227646b3372f46b4d9d6b562189b7e35d711`](https://explorer.testnet.arc.io/address/0xf334227646b3372f46b4d9d6b562189b7e35d711) | `0x2683071f952db97277b824675c1fb402a924c6363ec0a202075ce7d3adefadb2` | 2026-11-06T06:10:41Z |
| `EpisodeLog` | [`0xe7019b50c2a519b1e61b0a46df695bc9b5333579`](https://explorer.testnet.arc.io/address/0xe7019b50c2a519b1e61b0a46df695bc9b5333579) | `0x065dcf1012396fecfaf7c1554a026db58ec6e0e6c796ae2dbf072a2438e9c2b8` | 2026-11-06T06:10:48Z |

Studio wrote 42 Foundry tests (enforcer 33, EpisodeLog 9). They are part of the pull and pass in this project next to
the repo's 50 (`forge test`: 92 passed). The app's approval digests are bound to chain 5042 and the mainnet enforcer, so
the testnet deployments are for the Studio showcase only.

## RobotPaymentPolicyEnforcer (Arc mainnet, chain 5042)

| | |
| --- | --- |
| Address (`APP_ENFORCER_ADDRESS`) | `0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3` |
| Deploy tx | [0xdfc22a66…e3ca](https://explorer.arc.io/tx/0xdfc22a665871bc7eb5eec894c763346a90b0461b616e208597bd085a262ae3ca), block 29754137, `status 1`, gas 999733 at 21 gwei (≈ 0.021 USDC), 6 Nov ≈ 06:11 IST |
| Deployer | the relayer `0x404b09F43db64fB08f70b0b3e2b785bC312D6fDb` (nonce 4), right after the mainnet smoke |
| Command | `cd contracts && DEPLOYER_PRIVATE_KEY=<relayer key, from .env.main.local, never printed> forge script script/DeployArc.s.sol --rpc-url https://rpc.mainnet.arc.io --broadcast --with-gas-price 40gwei --priority-gas-price 1gwei` |
| Sources | `contracts/src/RobotPaymentPolicyEnforcer.sol` at `a0d25c2` (unchanged at `0f5bb06`), solc 0.8.23, `paris`, optimizer 200; the same code as the Studio pull without metadata (above) |
| Approval domain | `domainSeparator()` on chain = `0xdd64e6796bfea718a8f2ef8c176d3d963cb46255313c56edcc27f1564dba3a42`, equal to `@ethmumbai/protocol` `domainSeparator(approvalDomain(0x7c21…e4D3))` |

Verification:

- Runtime code = the build it came from: `keccak256(cast code 0x7c21…e4D3)` = `0x8ae1c544a79174dbaae0c617c21fa0a3b4e795fc06a6273b917018271081b653`
  = the `deployedBytecode` of `contracts/src` at `a0d25c2`; without metadata it equals the Studio pull's (above).
- Behaviour against live Arc state with exactly this runtime code: `ARC_RPC_URL=https://rpc.mainnet.arc.io bunx
  vitest run packages/chain/test/LiveApproval.test.ts` → 1 passed (8 cases: under cap pays; over cap and unlisted payee
  revert `RPP:approval-required`; a valid approver signature pays; wrong payee / amount / signer revert
  `RPP:approval-payee-mismatch` / `RPP:approval-amount-mismatch` / `RPP:invalid-approval-signature`).
- Explorer source verification: not done. `forge verify-contract … --verifier blockscout --verifier-url
  https://explorer.arc.io/api/` was refused: the explorer API answers a Cloudflare browser challenge ("Just a
  moment…") to non-browser clients. To retry from a browser session or with Arc's support.

## EpisodeLog (0G Galileo, chain 16602)

| | |
| --- | --- |
| Address (`APP_EPISODE_LOG_ADDRESS`) | `0x4C947E6D794C78d0F684e46EFC97f712E51a206A` ([chainscan](https://chainscan-galileo.0g.ai/address/0x4C947E6D794C78d0F684e46EFC97f712E51a206A)) |
| Deploy tx | [0xe4eb07f3…bf69](https://chainscan-galileo.0g.ai/tx/0xe4eb07f387cc5a767c019f150cc7abca7424fa68ae092ab50fe1bc49b2bebf69), block 64122644, `status 1`, gas 282232 at ≈ 4 gwei, 6 Nov 12:00 IST (block time 06:30:05Z) |
| Deployer | the 0G storage signer `0xc6fF8A666f4C7F674C1D129C73b46D61f2891fcD` (nonce 0; funded 0.5 0G by Kris, [0xbfc30ee8…9651](https://chainscan-galileo.0g.ai/tx/0xbfc30ee8fa193c6aa144cf2d635efaf5b61c6d8d03d43a6f9b40180b1df69651)); ≈ 0.4988 0G left for uploads |
| Command | dry run, then `cd contracts && DEPLOYER_PRIVATE_KEY=<APP_ZG_STORAGE_PRIVATE_KEY from .env.main.local, never printed> forge script script/DeployZg.s.sol --rpc-url https://evmrpc-testnet.0g.ai --broadcast` |
| Sources | `contracts/src/EpisodeLog.sol` at `39ecb5e`, solc 0.8.23, `paris`; the same code as the Studio pull without metadata (above) |

Verification: `keccak256(cast code 0x4C94…206A)` = `0xc855393071a1cda13d3c0aa07f0b8c6ba644404b00fdabefb7937af0e1a5beb9`
= the `deployedBytecode` of `contracts/src` at `39ecb5e`; without metadata it equals the Studio pull's (above). No explorer source verification attempted
yet (`contracts/README.md` lists the chainscan verifier URL).
