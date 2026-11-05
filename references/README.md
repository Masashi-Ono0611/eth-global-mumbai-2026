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

## Added 2026-11-05 (gap round: Radxa bring-up, QR scan, ESP32 gate, signing, accounts, Arc, 0G, Open Duck)

Sparse clones (only the listed paths): `radxa-docs_docs` (English Zero 3 docs and shared snippets), `rockchip-linux_rkbin` (`bin/rk35` loaders) and `wevm_viem` (`src/`). See `docs/research/reference-additions.md` for why each was added.

| Clone | Upstream | Commit | Research note |
| --- | --- | --- | --- |
| `rockchip-linux_rkdeveloptool` | https://github.com/rockchip-linux/rkdeveloptool | `304f073752` | reference-additions |
| `radxa-pkg_radxa-overlays` | https://github.com/radxa-pkg/radxa-overlays | `5df76fec76` | reference-additions |
| `radxa-docs_docs` | https://github.com/radxa-docs/docs | `c08fbdf11d` | reference-additions |
| `rockchip-linux_rkbin` | https://github.com/rockchip-linux/rkbin | `3e288fe814` | reference-additions |
| `paulmillr_qr` | https://github.com/paulmillr/qr | `951806df84` | reference-additions |
| `mchehab_zbar` | https://github.com/mchehab/zbar | `77ad19ae9b` | reference-additions |
| `kaiaai_arduino_128x160_display` | https://github.com/kaiaai/arduino_128x160_display | `0141cab16a` | reference-additions |
| `yoprogramo_ESP_QRcode` | https://github.com/yoprogramo/ESP_QRcode | `57a4044d9e` | reference-additions |
| `paulmillr_micro-eth-signer` | https://github.com/paulmillr/micro-eth-signer | `0d65b83d23` | reference-additions |
| `bitcoin-core_secp256k1` | https://github.com/bitcoin-core/secp256k1 | `b97f7f5f9c` | reference-additions |
| `0xOucan_LeekWallet` | https://github.com/0xOucan/LeekWallet | `78662b42b3` | reference-additions |
| `This-Is-Captain-Code_shrikevault` | https://github.com/This-Is-Captain-Code/shrikevault | `e262db68a7` | reference-additions |
| `wevm_viem` | https://github.com/wevm/viem | `9bdccb06c5` | reference-additions |
| `erc7579_erc7579-implementation` | https://github.com/erc7579/erc7579-implementation | `99cbd34479` | reference-additions |
| `MetaMask_smart-accounts-kit` | https://github.com/MetaMask/smart-accounts-kit | `555dd2043a` | reference-additions |
| `pimlicolabs_permissionless.js` | https://github.com/pimlicolabs/permissionless.js | `a536891b73` | reference-additions |
| `zerodevapp_sdk` | https://github.com/zerodevapp/sdk | `52b0430074` | reference-additions |
| `erc-8004_erc-8004-contracts` | https://github.com/erc-8004/erc-8004-contracts | `b9e466c250` | reference-additions |
| `sudeepb02_awesome-erc8004` | https://github.com/sudeepb02/awesome-erc8004 | `6ec3d36896` | reference-additions |
| `brtvcl_eip-3009-transferWithAuthorization-example` | https://github.com/brtvcl/eip-3009-transferWithAuthorization-example | `4094a9f836` | reference-additions |
| `circlefin_arc-stablecoin-fx` | https://github.com/circlefin/arc-stablecoin-fx | `53b2b39a40` | reference-additions |
| `l0vvkey_awesome-arc` | https://github.com/l0vvkey/awesome-arc | `b498dd8c7e` | reference-additions |
| `Salado210102_arc-smart-orders` | https://github.com/Salado210102/arc-smart-orders | `1e7d02d4fa` | reference-additions |
| `alexandre-mrt_0g-agent-kit` | https://github.com/alexandre-mrt/0g-agent-kit | `7ac9aea678` | reference-additions |
| `ddiddi_solo-router` | https://github.com/ddiddi/solo-router | `fd46ecd686` | reference-additions |
| `OakandSparrowSystemsEnterprises_AI-Infra-Hackathon` | https://github.com/OakandSparrowSystemsEnterprises/AI-Infra-Hackathon | `a253ce32fe` | reference-additions |
| `IntelligentSystemsLabUTV_hackathon-physical-ai` | https://github.com/IntelligentSystemsLabUTV/hackathon-physical-ai | `e7a080f16a` | reference-additions |
| `apirrone_Open_Duck_reference_motion_generator` | https://github.com/apirrone/Open_Duck_reference_motion_generator | `3d7bc6fd80` | reference-additions |

## Added 2026-11-05 (research round 2, version-matched stack clones, Pele)

Commits are read from each clone. The `@version` clones match the versions the repo pins (added by the foundation session).

| Clone | Upstream | Commit | Research note |
| --- | --- | --- | --- |
| `agentic-commerce-protocol_agentic-commerce-protocol` | https://github.com/agentic-commerce-protocol/agentic-commerce-protocol | `7fdd78df67` | merchant-and-agent-commerce |
| `agent-intent_verifiable-intent` | https://github.com/agent-intent/verifiable-intent | `356c29635f` | merchant-and-agent-commerce |
| `ahmad-codex_purser` | https://github.com/ahmad-codex/purser | `088ec08976` | mcp-wallet-and-ai-client |
| `alchemyplatform_rundler` | https://github.com/alchemyplatform/rundler | `f055885c1f` | wallet-accounts-v2 |
| `alchemy-run_alchemy@beta.84` | https://github.com/alchemy-run/alchemy | `c78e72bc1c` | stack-references (version-matched) |
| `AlexxIT_go2rtc` | https://github.com/AlexxIT/go2rtc | `990f4de3cc` | robot-browser-and-mcp |
| `andy-t-wang_agentbook` | https://github.com/andy-t-wang/agentbook | `bfdb56d1a3` | world-v2 |
| `cloudflare_agents` | https://github.com/cloudflare/agents | `e0f95e5870` | mcp-wallet-and-ai-client, merchant-and-agent-commerce, robot-browser-and-mcp, stack-references |
| `cloudflare_realtime-examples` | https://github.com/cloudflare/realtime-examples | `53489c2847` | robot-browser-and-mcp |
| `cloudflare_workers-oauth-provider` | https://github.com/cloudflare/workers-oauth-provider | `b4cec31730` | mcp-wallet-and-ai-client, nod-froggy-patterns |
| `coinbase_agents` | https://github.com/coinbase/agents | `1f91fea2b9` | mcp-wallet-and-ai-client |
| `coinbase_smart-wallet` | https://github.com/coinbase/smart-wallet | `a4e83fd36c` | wallet-accounts-v2 |
| `Effect-TS_effect@4.0.7` | https://github.com/Effect-TS/effect | `b174739b6b` | stack-references (version-matched) |
| `etherspot_skandha` | https://github.com/etherspot/skandha | `acba0d8e3a` | wallet-accounts-v2 |
| `foldkit_foldkit@0.169.0` | https://github.com/foldkit/foldkit | `7ee214268c` | stack-references (version-matched) |
| `google-agentic-commerce_a2a-x402` | https://github.com/google-agentic-commerce/a2a-x402 | `125db5526a` | merchant-and-agent-commerce |
| `google-agentic-commerce_AP2` | https://github.com/google-agentic-commerce/AP2 | `e1ea56db72` | mcp-wallet-and-ai-client, merchant-and-agent-commerce |
| `IliaLarchenko_robot_MCP` | https://github.com/IliaLarchenko/robot_MCP | `5087718375` | robot-browser-and-mcp |
| `jackccrawford_reachy-mini-mcp` | https://github.com/jackccrawford/reachy-mini-mcp | `0ad7fc888b` | robot-browser-and-mcp |
| `lpigeon_unitree-go2-mcp-server` | https://github.com/lpigeon/unitree-go2-mcp-server | `e7a6737dc9` | robot-browser-and-mcp |
| `MetaMask_snap-7715-permissions` | https://github.com/MetaMask/snap-7715-permissions | `60c8a92a9d` | wallet-accounts-v2 |
| `modelcontextprotocol_ext-apps` | https://github.com/modelcontextprotocol/ext-apps | `19256f52ca` | mcp-wallet-and-ai-client, nod-froggy-patterns |
| `modelcontextprotocol_ext-auth` | https://github.com/modelcontextprotocol/ext-auth | `15ca394e00` | mcp-wallet-and-ai-client |
| `modelcontextprotocol_modelcontextprotocol` | https://github.com/modelcontextprotocol/modelcontextprotocol | `3c4d91b7e8` | mcp-wallet-and-ai-client |
| `modelcontextprotocol_typescript-sdk` | https://github.com/modelcontextprotocol/typescript-sdk | `1e608caeb5` | mcp-wallet-and-ai-client |
| `modeofO_402-hardware` | https://github.com/modeofO/402-hardware | `e4c8899be7` | merchant-and-agent-commerce |
| `obsidianmd_pele` | https://github.com/obsidianmd/pele | `3a2f075ee0` | docs/site (diagram renderer) |
| `OpenZeppelin_openzeppelin-community-contracts` | https://github.com/OpenZeppelin/openzeppelin-community-contracts | `16cb98acc9` | wallet-accounts-v2 |
| `oportetxyz_oportet` | https://github.com/oportetxyz/oportet | `94b31e739b` | wallet-accounts-v2 |
| `pimlicolabs_alto` | https://github.com/pimlicolabs/alto | `94b1e46477` | wallet-accounts-v2 |
| `pollen-robotics_microduck-simulator` | https://huggingface.co/spaces/pollen-robotics/microduck-simulator | `ad9d41a763` | robot-browser-and-mcp |
| `pollen-robotics_reachy_mini` | https://github.com/pollen-robotics/reachy_mini | `25756e7042` | robot-browser-and-mcp |
| `pollen-robotics_reachy_mini_conversation_app` | https://github.com/pollen-robotics/reachy_mini_conversation_app | `e901925591` | robot-browser-and-mcp |
| `robotmcp_ros-mcp-server` | https://github.com/robotmcp/ros-mcp-server | `476591ac05` | robot-browser-and-mcp |
| `rokbenko_quackd` | https://github.com/rokbenko/quackd | `64876bff42` | robot-browser-and-mcp |
| `s0nderlabs_remit` | https://github.com/s0nderlabs/remit | `d3ced6cb5f` | mcp-wallet-and-ai-client |
| `safe-global_safe-modules` | https://github.com/safe-global/safe-modules | `9e5f3d0701` | wallet-accounts-v2 |
| `tkhq_secure-browser-mcp` | https://github.com/tkhq/secure-browser-mcp | `f5849458bb` | mcp-wallet-and-ai-client |
| `Universal-Commerce-Protocol_ucp` | https://github.com/Universal-Commerce-Protocol/ucp | `58c7ab92dc` | merchant-and-agent-commerce |
| `visa_trusted-agent-protocol` | https://github.com/visa/trusted-agent-protocol | `16d59bdf3f` | merchant-and-agent-commerce |
| `worldcoin_agentkit-shopify-demo` | https://github.com/worldcoin/agentkit-shopify-demo | `3af21dbed6` | merchant-and-agent-commerce, world-v2 |
| `worldcoin_developer-portal` | https://github.com/worldcoin/developer-portal | `ac44581f8e` | world-v2 |
| `worldcoin_maitre-demo-plugin` | https://github.com/worldcoin/maitre-demo-plugin | `31d5bf244e` | world-v2 |
| `worldcoin_simulator` | https://github.com/worldcoin/simulator | `ae8e4b807a` | world-v2 |
| `worldcoin_walletkit` | https://github.com/worldcoin/walletkit | `3432423a8f` | world-v2 |
| `worldcoin_web-authenticator` | https://github.com/worldcoin/web-authenticator | `8f3eae8f59` | world-v2 |
| `worldcoin_world-id-utility-contracts` | https://github.com/worldcoin/world-id-utility-contracts | `6f09724250` | world-v2 |
| `xanderslabs_norkey` | https://github.com/xanderslabs/norkey | `dc1e026979` | wallet-accounts-v2 |
| `fireblocks_x402-facilitator` | https://github.com/fireblocks/x402-facilitator | `ca7dd59d2a` | plan v3: ERC-7710 facilitator mechanism |
| `base_account-sdk` | https://github.com/base/account-sdk | `1c31057036` | plan v3: just-in-time refill (sub accounts) |
| `tempoxyz_mpp-specs` | https://github.com/tempoxyz/mpp-specs | `cd75e27a54` | plan v3: MPP (later) |
| `wevm_mppx` | https://github.com/wevm/mppx | `7a18dacc93` | plan v3: MPP (later) |
| `danfinlay_x402@7710-implementation` | https://github.com/danfinlay/x402 | `a26d75e857` | plan v3: x402 PR #1837 (7710 facilitator draft) |
