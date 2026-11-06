// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { Script } from "forge-std/Script.sol";

/// @notice Deploys a contract from its Studio-identical artifact (script/studio-build.sh writes out/studio), so the
/// deployed runtime bytecode, metadata included, equals Arc Studio's build and its Arc testnet deployment.
abstract contract StudioDeploy is Script {
    /// @dev The artifact's creation code, after checking that its runtime equals this project's compile of the same
    /// pulled source with the metadata removed (a stale out/studio from another pull fails here, before broadcasting).
    function _studioCreationCode(string memory _artifact, bytes memory _projectRuntime)
        internal
        view
        returns (bytes memory)
    {
        require(
            keccak256(_withoutMetadata(vm.getDeployedCode(_artifact))) == keccak256(_withoutMetadata(_projectRuntime)),
            "StudioDeploy: out/studio does not match studio/ (run script/studio-build.sh)"
        );
        return vm.getCode(_artifact);
    }

    /// @dev CREATE from the broadcasting deployer, then the deployed code must equal the artifact's runtime.
    function _deploy(string memory _artifact, bytes memory _creationCode) internal returns (address deployed_) {
        assembly {
            deployed_ := create(0, add(_creationCode, 0x20), mload(_creationCode))
        }
        require(deployed_ != address(0), "StudioDeploy: create failed");
        require(
            keccak256(deployed_.code) == keccak256(vm.getDeployedCode(_artifact)),
            "StudioDeploy: deployed code differs from the Studio artifact"
        );
    }

    /// @dev Solidity appends CBOR metadata whose byte length is the code's last two bytes.
    function _withoutMetadata(bytes memory _code) internal pure returns (bytes memory stripped_) {
        uint256 length_ = _code.length;
        uint256 metadata_ = ((uint256(uint8(_code[length_ - 2])) << 8) | uint256(uint8(_code[length_ - 1]))) + 2;
        stripped_ = new bytes(length_ - metadata_);
        for (uint256 i = 0; i < stripped_.length; ++i) {
            stripped_[i] = _code[i];
        }
    }
}
