# Arc Studio pull (read-only)

Everything in this directory except this file is a verbatim pull of the Arc Studio project that is the single source
of Vitaquack's on-chain logic. Never edit these files: change the contracts in Studio, then pull again and update this
file. `contracts/foundry.toml` builds, tests and deploys exactly these sources.

|                  |                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Studio app       | `63241623-a488-4452-ae23-ab151e4f2d75`                                                      |
| URL              | https://studio.arc.io/app/63241623-a488-4452-ae23-ab151e4f2d75                              |
| Pulled           | 2026-11-06T10:03:50Z (15:33:50 IST) with `@circle-fin/arc-studio-cli` 1.2.2                 |
| Studio toolchain | Foundry `v1.7.1` (`.foundry-version`), solc 0.8.23, `paris`, optimizer 200 (`foundry.toml`) |

Pull command, from `contracts/` (the token stays in `.env.main.local` and is never printed):

```sh
ARC_STUDIO_TOKEN=$(grep '^ARC_STUDIO_TOKEN=' ../.env.main.local | cut -d= -f2-) \
  bunx @circle-fin/arc-studio-cli@1.2.2 pull --app 63241623-a488-4452-ae23-ab151e4f2d75 --out studio \
  --paths 'contracts/*.sol' 'contracts/test/*.sol' 'contracts/script/*.sol' 'contracts/contract-metadata/*.json' \
  foundry.toml remappings.txt .foundry-version
```

The `--paths` filter keeps the on-chain part of the app: the contracts, Studio's tests and deploy helper, the
deployment records and the Foundry config. The app held 158 files at pull time. The rest is not committed:

- the Studio showcase page (Vite + React under `src/`, `package.json`, `bun.lock`, configs); it is not on-chain logic,
  and the repo's oxfmt and oxlint gates would reject its formatting;
- Studio's build outputs (`contracts/out`, `contracts/cache`), which Git ignores here as everywhere;
- Studio's forge-std 1.16.2 checkout; this project uses its vendored forge-std 1.17.0 for the tests;
- Studio's agent files (`AGENTS.md`, `.agents/`), which must not act as instructions in this repo;
- `.env*` (the CLI excludes it by default).

`.arc-studio/pull-manifest.json` is the CLI's own record of this pull (path, sha256 and time per file); a later pull
uses it to detect local edits.

## Files (sha256)

```text
05f7810a6b7bb41dea1ba4113f0be0616823f8218481ae363ede1a3bfc82973c  .arc-studio/pull-manifest.json
b59269d636da76a16dca895a43085d37114d105ca9f933cb45d3ec23fdfe0845  .foundry-version
e5d17b7d9a8e1fb5fd24210b70d2df75a4bb37ad351eb7cfbc9df55b5f92e2b3  contracts/EpisodeLog.sol
ff554c88be9024acaa4a8adec561a020c281c4314e71a45036a907fc69f6400a  contracts/RobotPaymentPolicyEnforcer.sol
da54633a8d47dbff0b807122b9cb483a7fc1a7b503b0f6fd7f377ed945aaeca9  contracts/contract-metadata/EpisodeLog.json
93fbc43ac66b54829db4513f6ab12122942b87f8bad49a8916eda2da129b349e  contracts/contract-metadata/RobotPaymentPolicyEnforcer.json
4b2d23e8364e58e08460c39d6c26dced67b82b7e039c306c671245c4f012c38b  contracts/script/Create2Factory.sol
031692db152269016a8df83293d429f69f90dcb0e563ecc5366a257cbcf334a1  contracts/script/DeployCreate2.s.sol
312b6320583da76a39d37edb0534b7d778fc58fb691468bec16c550666cd2d77  contracts/test/EpisodeLog.t.sol
2918e7f143ee05571f957c65fa91cbf77774c3e38e4e9da75642eca57525ae5d  contracts/test/RobotPaymentPolicyEnforcer.t.sol
b936d5f142c70afa0570bf776c73c5954b53e523d02a8ace8fc6681a48c53def  foundry.toml
7db29ab99ec9f13cfd2dc2c9c746f77e57f85c17c6186a15204e1dfdcfadd29c  remappings.txt
```

Check: `cd contracts/studio && sed -n '/^```text$/,/^```$/p' PULL.md | grep -v '^```' | sha256sum -c`.

## Studio's Arc testnet deployments

From `contracts/contract-metadata/*.json` (Studio's deployer wallet `3c2464b2-8369-52e2-a782-800bbeca5396`):

| Contract                     | Arc testnet (5042002) address                                                                                                      | Deploy tx                                                            | Deployed             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------- |
| `RobotPaymentPolicyEnforcer` | [`0xf334227646b3372f46b4d9d6b562189b7e35d711`](https://explorer.testnet.arc.io/address/0xf334227646b3372f46b4d9d6b562189b7e35d711) | `0x2683071f952db97277b824675c1fb402a924c6363ec0a202075ce7d3adefadb2` | 2026-11-06T06:10:41Z |
| `EpisodeLog`                 | [`0xe7019b50c2a519b1e61b0a46df695bc9b5333579`](https://explorer.testnet.arc.io/address/0xe7019b50c2a519b1e61b0a46df695bc9b5333579) | `0x065dcf1012396fecfaf7c1554a026db58ec6e0e6c796ae2dbf072a2438e9c2b8` | 2026-11-06T06:10:48Z |

## What this pull builds to

`contracts/script/studio-build.sh` compiles these two files under this directory's `foundry.toml`, as Studio does. The
runtime bytecode, metadata included, is then exactly Studio's testnet code: keccak256
`0x5f907757c8db88bfb5703792caf64b1afa166cf990be8a7cdd666e582f6f0d93` (enforcer) and
`0x1c44a3d3224ee4f0e0e785e491ccaece400368e25fd62bfef4d469becd0c225f` (EpisodeLog). `DeployArc` and `DeployZg` deploy
those artifacts. The comparison with the mainnet and Galileo deployments is in `docs/evidence/contracts.md`.

The two contract files are the flattened sources this repo uploaded to Studio on 6 Nov (`forge flatten` of the former
`contracts/src/*.sol` at `a0d25c2` and `39ecb5e`), with one added trailing newline each; Studio compiled them unchanged.
