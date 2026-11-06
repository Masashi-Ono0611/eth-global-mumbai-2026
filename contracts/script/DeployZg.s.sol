// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { Script, console } from "forge-std/Script.sol";

import { EpisodeLog } from "../src/EpisodeLog.sol";

/// @notice Deploys EpisodeLog to 0G Galileo (16602) and prints `EPISODE_LOG_ADDRESS=<address>`. 0G mainnet (16661) is
/// accepted too, in case the 0G booth asks for mainnet.
/// @dev The key comes from `DEPLOYER_PRIVATE_KEY` and the RPC from `--rpc-url "$ZG_RPC_URL"`; only addresses are printed.
contract DeployZg is Script {
    uint256 internal constant ZG_GALILEO = 16_602;
    uint256 internal constant ZG_MAINNET = 16_661;

    function run() external returns (EpisodeLog episodeLog_) {
        require(
            block.chainid == ZG_GALILEO || block.chainid == ZG_MAINNET,
            "DeployZg: --rpc-url is not 0G Galileo (16602) or 0G mainnet (16661)"
        );
        uint256 deployerKey_ = vm.envUint("DEPLOYER_PRIVATE_KEY");
        console.log("deployer", vm.addr(deployerKey_));
        console.log("chain", block.chainid);

        vm.startBroadcast(deployerKey_);
        episodeLog_ = new EpisodeLog();
        vm.stopBroadcast();

        console.log("EPISODE_LOG_ADDRESS=%s", address(episodeLog_));
    }
}
