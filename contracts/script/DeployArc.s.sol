// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { console } from "forge-std/Script.sol";

import { RobotPaymentPolicyEnforcer } from "../studio/contracts/RobotPaymentPolicyEnforcer.sol";
import { StudioDeploy } from "./StudioDeploy.sol";

/// @notice Deploys the Arc Studio RobotPaymentPolicyEnforcer to Arc mainnet (5042) from the pinned pull and prints
/// `ENFORCER_ADDRESS=<address>`. Run script/studio-build.sh first: the deployed bytes equal Studio's testnet deployment.
/// @dev The key comes from `DEPLOYER_PRIVATE_KEY` and the RPC from `--rpc-url "$ARC_RPC_URL"`; only addresses are printed.
/// Arc drops transactions under 20 gwei, so broadcast with `--with-gas-price 40gwei --priority-gas-price 1gwei`
/// (README.md). Approvals are EIP-712 bound to chain 5042 and this address: the app's `APP_ENFORCER_ADDRESS` must be it.
contract DeployArc is StudioDeploy {
    uint256 internal constant ARC_MAINNET = 5042;
    string internal constant ARTIFACT = "out/studio/RobotPaymentPolicyEnforcer.sol/RobotPaymentPolicyEnforcer.json";

    function run() external returns (RobotPaymentPolicyEnforcer enforcer_) {
        require(block.chainid == ARC_MAINNET, "DeployArc: --rpc-url is not Arc mainnet (chain 5042)");
        bytes memory creationCode_ = _studioCreationCode(ARTIFACT, type(RobotPaymentPolicyEnforcer).runtimeCode);
        uint256 deployerKey_ = vm.envUint("DEPLOYER_PRIVATE_KEY");
        console.log("deployer", vm.addr(deployerKey_));

        vm.startBroadcast(deployerKey_);
        enforcer_ = RobotPaymentPolicyEnforcer(_deploy(ARTIFACT, creationCode_));
        vm.stopBroadcast();

        console.log("runtime keccak256 (= Studio's build)");
        console.logBytes32(keccak256(address(enforcer_).code));
        console.log("domainSeparator");
        console.logBytes32(enforcer_.domainSeparator());
        console.log("ENFORCER_ADDRESS=%s", address(enforcer_));
    }
}
