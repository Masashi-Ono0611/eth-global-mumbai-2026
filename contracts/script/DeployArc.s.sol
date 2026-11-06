// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { Script, console } from "forge-std/Script.sol";

import { RobotPaymentPolicyEnforcer } from "../src/RobotPaymentPolicyEnforcer.sol";

/// @notice Deploys RobotPaymentPolicyEnforcer to Arc mainnet (5042) and prints `ENFORCER_ADDRESS=<address>`.
/// @dev The key comes from `DEPLOYER_PRIVATE_KEY` and the RPC from `--rpc-url "$ARC_RPC_URL"`; only addresses are printed.
/// Arc drops transactions under 20 gwei, so broadcast with `--with-gas-price 40gwei --priority-gas-price 1gwei`
/// (README.md). Approvals are EIP-712 bound to chain 5042 and this address: the app's `APP_ENFORCER_ADDRESS` must be it.
contract DeployArc is Script {
    uint256 internal constant ARC_MAINNET = 5042;

    function run() external returns (RobotPaymentPolicyEnforcer enforcer_) {
        require(block.chainid == ARC_MAINNET, "DeployArc: --rpc-url is not Arc mainnet (chain 5042)");
        uint256 deployerKey_ = vm.envUint("DEPLOYER_PRIVATE_KEY");
        console.log("deployer", vm.addr(deployerKey_));

        vm.startBroadcast(deployerKey_);
        enforcer_ = new RobotPaymentPolicyEnforcer();
        vm.stopBroadcast();

        console.log("domainSeparator");
        console.logBytes32(enforcer_.domainSeparator());
        console.log("ENFORCER_ADDRESS=%s", address(enforcer_));
    }
}
