# references/

Read-only clones of upstream repos that agents read for patterns. Not committed: each is a shallow
clone with its own `.git` (`GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1`), named `<owner>_<repo>`.
The table below records the upstream and commit each clone was taken at. Never edit a clone in place.

Research notes for each group live in `docs/research/`.

| Clone | Upstream | Commit | Research note |
| --- | --- | --- | --- |
| `0gfoundation_0g-agent-skills` | https://github.com/0gfoundation/0g-agent-skills | `04b5a42085` | 0g |
| `0gfoundation_0g-compute-ts-sdk` | https://github.com/0gfoundation/0g-compute-ts-sdk | `3e833e24ee` | 0g |
| `0gfoundation_0g-storage-ts-sdk` | https://github.com/0gfoundation/0g-storage-ts-sdk | `1da5b3ee31` | 0g |
| `0gfoundation_0g-storage-ts-starter-kit` | https://github.com/0gfoundation/0g-storage-ts-starter-kit | `6a308551f4` | 0g |
| `0gfoundation_project-floaty` | https://github.com/0gfoundation/project-floaty | `94f5ddc85a` | 0g |
| `0gfoundation_reachy-mini-hackathon` | https://github.com/0gfoundation/reachy-mini-hackathon | `ceec36da96` | 0g |
| `0gfoundation_zerobot` | https://github.com/0gfoundation/zerobot | `c8328ad925` | 0g |
| `adafruit_Adafruit-ST7735-Library` | https://github.com/adafruit/Adafruit-ST7735-Library | `d568339f95` | robots-and-embedded |
| `alchemyplatform_modular-account` | https://github.com/alchemyplatform/modular-account | `ab9c0c2475` | evm-accounts-and-payments |
| `alchemy-run_alchemy` | https://github.com/alchemy-run/alchemy | `5bbe9aa4d8` | stack-references |
| `AlphaWallet_Web3E` | https://github.com/AlphaWallet/Web3E | `c19324cc20` | robots-and-embedded |
| `anthropics_skills` | https://github.com/anthropics/skills | `ca45fc496a` | stack-references |
| `ApeWorX_eth-account` | https://github.com/ethereum/eth-account | `b659d043d9` | robots-and-embedded |
| `apirrone_Open_Duck_Mini` | https://github.com/apirrone/Open_Duck_Mini | `b23317a485` | robots-and-embedded |
| `apirrone_Open_Duck_Mini_Runtime` | https://github.com/apirrone/Open_Duck_Mini_Runtime | `376de65435` | robots-and-embedded |
| `apirrone_Open_Duck_Playground` | https://github.com/apirrone/Open_Duck_Playground | `b9be205ac6` | robots-and-embedded |
| `base_eip-7702-proxy` | https://github.com/base/eip-7702-proxy | `80a4cd29f2` | evm-accounts-and-payments |
| `bcnmy_nexus` | https://github.com/bcnmy/nexus | `9007ba1352` | evm-accounts-and-payments |
| `blader_humanizer` | https://github.com/blader/humanizer | `0ef9fe5bc3` | stack-references |
| `Bodmer_TFT_eSPI` | https://github.com/Bodmer/TFT_eSPI | `16e3759504` | robots-and-embedded |
| `circlefin_agent-stack-starter-kits` | https://github.com/circlefin/agent-stack-starter-kits | `3996330605` | arc-and-circle |
| `circlefin_arc-ecommerce-payments` | https://github.com/circlefin/arc-ecommerce-payments | `be2017d8a7` | arc-and-circle |
| `circlefin_arc-escrow` | https://github.com/circlefin/arc-escrow | `d5006bc445` | arc-and-circle |
| `circlefin_arc-multichain-wallet` | https://github.com/circlefin/arc-multichain-wallet | `17befda546` | arc-and-circle |
| `circlefin_arc-nanopayments` | https://github.com/circlefin/arc-nanopayments | `a29f920ed8` | arc-and-circle, evm-accounts-and-payments |
| `circlefin_arc-node` | https://github.com/circlefin/arc-node | `6e764023ee` | arc-and-circle, evm-accounts-and-payments |
| `circlefin_arc-p2p-payments` | https://github.com/circlefin/arc-p2p-payments | `499d1f5fb0` | arc-and-circle |
| `circlefin_circle-cctp-crosschain-transfer` | https://github.com/circlefin/circle-cctp-crosschain-transfer | `e445516102` | arc-and-circle |
| `circlefin_docs-examples` | https://github.com/circlefin/docs-examples | `15074814b6` | arc-and-circle |
| `circlefin_evm-cctp-contracts` | https://github.com/circlefin/evm-cctp-contracts | `a92a2b4e7e` | arc-and-circle |
| `circlefin_evm-gateway-contracts` | https://github.com/circlefin/evm-gateway-contracts | `c21d2d2e35` | arc-and-circle, evm-accounts-and-payments |
| `circlefin_skills` | https://github.com/circlefin/skills | `1f23655cbc` | arc-and-circle |
| `circlefin_stablecoin-evm` | https://github.com/circlefin/stablecoin-evm | `fc85788bc7` | arc-and-circle, evm-accounts-and-payments |
| `cloudflare_skills` | https://github.com/cloudflare/skills | `1f2cd0a195` | stack-references |
| `coinbase_spend-permissions` | https://github.com/coinbase/spend-permissions | `e0004e63ed` | evm-accounts-and-payments |
| `cursor_plugins` | https://github.com/cursor/plugins | `2776ddd235` | stack-references |
| `daimo-eth_p256-verifier` | https://github.com/daimo-eth/p256-verifier | `607d3ec837` | evm-accounts-and-payments |
| `danieljvdm_effect-cf` | https://github.com/danieljvdm/effect-cf | `28f1ee52fe` | stack-references |
| `dmmulroy_anti-slop` | https://github.com/dmmulroy/anti-slop | `13909c9e07` | stack-references |
| `drizzle-team_drizzle-orm` | https://github.com/drizzle-team/drizzle-orm | `5d71fc408a` | stack-references |
| `Effect-TS_effect` | https://github.com/Effect-TS/effect | `cb679e39ca` | stack-references |
| `Effect-TS_tsgo` | https://github.com/Effect-TS/tsgo | `11414d156b` | stack-references |
| `emilkowalski_skills` | https://github.com/emilkowalski/skills | `c8a79627b5` | stack-references |
| `erc7579_smartsessions` | https://github.com/erc7579/smartsessions | `f5aaf867f7` | evm-accounts-and-payments |
| `eth-infinitism_account-abstraction` | https://github.com/eth-infinitism/account-abstraction | `1c6b669d0e` | evm-accounts-and-payments |
| `foldkit_coverchart` | https://github.com/foldkit/coverchart | `220ccf075b` | stack-references |
| `foldkit_foldkit` | https://github.com/foldkit/foldkit | `a471adb24d` | stack-references |
| `foldkit_foldkit-domains` | https://github.com/foldkit/foldkit-domains | `45e124c96f` | stack-references |
| `grmkris_repoagents` | https://github.com/grmkris/repoagents | `43ca7cf29d` | stack-references |
| `itaymendel_oxlint-plugin-complexity` | https://github.com/itaymendel/oxlint-plugin-complexity | `46d436e531` | stack-references |
| `ithacaxyz_account` | https://github.com/ithacaxyz/account | `767e973ad2` | evm-accounts-and-payments |
| `jakubkrehel_make-interfaces-feel-better` | https://github.com/jakubkrehel/make-interfaces-feel-better | `35545ea151` | stack-references |
| `joe-bell_skills` | https://github.com/joe-bell/skills | `6e79fd26ab` | stack-references |
| `joelhooks_potion-calendar` | https://github.com/joelhooks/potion-calendar | `017ae30e4b` | stack-references |
| `joelhooks_rat-stack` | https://github.com/joelhooks/rat-stack | `1496c2b5c9` | stack-references |
| `just-be-dev_agent-feed` | https://github.com/just-be-dev/agent-feed | `90cbd98ccb` | stack-references |
| `just-be-dev_cafe-stack` | https://github.com/just-be-dev/cafe-stack | `766ead07bc` | stack-references |
| `just-be-dev_effect-typed-id` | https://github.com/just-be-dev/effect-typed-id | `8570b812fb` | stack-references |
| `kmackay_micro-ecc` | https://github.com/kmackay/micro-ecc | `541b3a7802` | evm-accounts-and-payments, robots-and-embedded |
| `LoupVaillant_Monocypher` | https://github.com/LoupVaillant/Monocypher | `907e90ddd4` | robots-and-embedded |
| `lovyan03_LovyanGFX` | https://github.com/lovyan03/LovyanGFX | `dd228d15a0` | robots-and-embedded |
| `madhephaestus_ESP32Servo` | https://github.com/madhephaestus/ESP32Servo | `88be58c5eb` | robots-and-embedded |
| `Manzanita-Research_terrarium-v2` | https://github.com/Manzanita-Research/terrarium-v2 | `1ba55a12a0` | stack-references |
| `MapleTechLabs_hazel` | https://github.com/MapleTechLabs/hazel | `b1f34ef6d4` | stack-references |
| `MapleTechLabs_maple` | https://github.com/MapleTechLabs/maple | `b7dcb26a79` | stack-references |
| `mattpocock_skills` | https://github.com/mattpocock/skills | `4ae2317ddb` | stack-references |
| `MetaMask_delegation-framework` | https://github.com/MetaMask/delegation-framework | `b4b8c41fc9` | arc-and-circle, evm-accounts-and-payments |
| `michielryvers_retro` | https://github.com/michielryvers/retro | `15715d2d75` | stack-references |
| `NaturalHistoryMuseum_pyzbar` | https://github.com/NaturalHistoryMuseum/pyzbar | `ff2892666f` | robots-and-embedded |
| `nayuki_QR-Code-generator` | https://github.com/nayuki/QR-Code-generator | `bcfe1b018c` | robots-and-embedded |
| `nodestark_mdb-esp32-cashless` | https://github.com/nodestark/mdb-esp32-cashless | `8be3834873` | robots-and-embedded |
| `NolanGC_foldkit-alchemy-starter` | https://github.com/NolanGC/foldkit-alchemy-starter | `b84eda258a` | stack-references |
| `OpenMind_OM1` | https://github.com/OpenMind/OM1 | `2102a49c7f` | robots-and-embedded |
| `OpenZeppelin_openzeppelin-contracts` | https://github.com/OpenZeppelin/openzeppelin-contracts | `efaa6f78ab` | evm-accounts-and-payments |
| `oxc-project_tsrs` | https://github.com/oxc-project/tsrs | `c96e7683dc` | stack-references |
| `peaqnetwork_peaq-robotics-ros2` | https://github.com/peaqnetwork/peaq-robotics-ros2 | `f0d3a19a09` | robots-and-embedded |
| `phosphor-icons_core` | https://github.com/phosphor-icons/core | `2b75f3ad12` | stack-references |
| `PlaiPin_solana-esp32-x402` | https://github.com/PlaiPin/solana-esp32-x402 | `777ad021d7` | robots-and-embedded |
| `pollen-robotics_microduck` | https://github.com/pollen-robotics/microduck | `c15c2377d8` | robots-and-embedded |
| `pollen-robotics_microduck_rl` | https://github.com/pollen-robotics/microduck_rl | `bae39f5900` | robots-and-embedded |
| `ricmoo_QRCode` | https://github.com/ricmoo/QRCode | `eafbde4949` | robots-and-embedded |
| `Uniswap_calibur` | https://github.com/Uniswap/calibur | `3f16977e88` | evm-accounts-and-payments |
| `Uniswap_permit2` | https://github.com/Uniswap/permit2 | `cc56ad0f34` | evm-accounts-and-payments |
| `Vectorized_solady` | https://github.com/Vectorized/solady | `258f67cc71` | evm-accounts-and-payments |
| `vojtaholik_good-css` | https://github.com/vojtaholik/good-css | `35e0e8c673` | stack-references |
| `wevm_zyzz` | https://github.com/wevm/zyzz | `388dfd28ad` | stack-references |
| `worldcoin_agentkit` | https://github.com/worldcoin/agentkit | `cd85b5e7a9` | world |
| `worldcoin_developer-docs` | https://github.com/worldcoin/developer-docs | `551cffcbd2` | world |
| `worldcoin_human-in-the-loop` | https://github.com/worldcoin/human-in-the-loop | `9db036c580` | world |
| `worldcoin_idkit` | https://github.com/worldcoin/idkit | `b199567464` | world |
| `worldcoin_world-id-protocol` | https://github.com/worldcoin/world-id-protocol | `95e5002b2a` | world |
| `x402-foundation_x402` | https://github.com/x402-foundation/x402 | `6a773dba56` | evm-accounts-and-payments, robots-and-embedded |
| `yielded-dev_auth` | https://github.com/yielded-dev/auth | `bc4df04453` | stack-references |
| `yielded-dev_effect-tsrs` | https://github.com/yielded-dev/effect-tsrs | `947f60cac7` | stack-references |
| `zerodevapp_kernel` | https://github.com/zerodevapp/kernel | `c960b42d2e` | evm-accounts-and-payments |
| `zerodevapp_kernel-7579-plugins` | https://github.com/zerodevapp/kernel-7579-plugins | `332deed6ee` | evm-accounts-and-payments |
| `zxing-cpp_zxing-cpp` | https://github.com/zxing-cpp/zxing-cpp | `bae7153616` | robots-and-embedded |
