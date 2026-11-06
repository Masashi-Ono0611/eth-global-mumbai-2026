// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { console } from "forge-std/Script.sol";

import { EpisodeLog } from "../studio/contracts/EpisodeLog.sol";
import { StudioDeploy } from "./StudioDeploy.sol";

/// @notice Deploys the Arc Studio EpisodeLog to 0G Galileo (16602) from the pinned pull and prints
/// `EPISODE_LOG_ADDRESS=<address>`; 0G mainnet (16661) is accepted too, in case the 0G booth asks for mainnet. Run
/// script/studio-build.sh first: the deployed bytes equal Studio's Arc testnet deployment. Studio cannot deploy to 0G,
/// so this is the recorded exception: Studio-authored, deployed by us from the same pull.
/// @dev The key comes from `DEPLOYER_PRIVATE_KEY` and the RPC from `--rpc-url "$ZG_RPC_URL"`; only addresses are printed.
contract DeployZg is StudioDeploy {
    uint256 internal constant ZG_GALILEO = 16_602;
    uint256 internal constant ZG_MAINNET = 16_661;
    string internal constant ARTIFACT = "out/studio/EpisodeLog.sol/EpisodeLog.json";

    function run() external returns (EpisodeLog episodeLog_) {
        require(
            block.chainid == ZG_GALILEO || block.chainid == ZG_MAINNET,
            "DeployZg: --rpc-url is not 0G Galileo (16602) or 0G mainnet (16661)"
        );
        bytes memory creationCode_ = _studioCreationCode(ARTIFACT, type(EpisodeLog).runtimeCode);
        uint256 deployerKey_ = vm.envUint("DEPLOYER_PRIVATE_KEY");
        console.log("deployer", vm.addr(deployerKey_));
        console.log("chain", block.chainid);

        vm.startBroadcast(deployerKey_);
        episodeLog_ = EpisodeLog(_deploy(ARTIFACT, creationCode_));
        vm.stopBroadcast();

        console.log("runtime keccak256 (= Studio's build)");
        console.logBytes32(keccak256(address(episodeLog_).code));
        console.log("EPISODE_LOG_ADDRESS=%s", address(episodeLog_));
    }
}
