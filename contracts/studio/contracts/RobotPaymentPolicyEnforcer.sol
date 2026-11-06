// SPDX-License-Identifier: MIT
pragma solidity =0.8.23 ^0.8.20 ^0.8.21 ^0.8.23;

// lib/openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol

// OpenZeppelin Contracts (last updated v5.0.0) (utils/cryptography/ECDSA.sol)

/**
 * @dev Elliptic Curve Digital Signature Algorithm (ECDSA) operations.
 *
 * These functions can be used to verify that a message was signed by the holder
 * of the private keys of a given address.
 */
library ECDSA {
    enum RecoverError {
        NoError,
        InvalidSignature,
        InvalidSignatureLength,
        InvalidSignatureS
    }

    /**
     * @dev The signature derives the `address(0)`.
     */
    error ECDSAInvalidSignature();

    /**
     * @dev The signature has an invalid length.
     */
    error ECDSAInvalidSignatureLength(uint256 length);

    /**
     * @dev The signature has an S value that is in the upper half order.
     */
    error ECDSAInvalidSignatureS(bytes32 s);

    /**
     * @dev Returns the address that signed a hashed message (`hash`) with `signature` or an error. This will not
     * return address(0) without also returning an error description. Errors are documented using an enum (error type)
     * and a bytes32 providing additional information about the error.
     *
     * If no error is returned, then the address can be used for verification purposes.
     *
     * The `ecrecover` EVM precompile allows for malleable (non-unique) signatures:
     * this function rejects them by requiring the `s` value to be in the lower
     * half order, and the `v` value to be either 27 or 28.
     *
     * IMPORTANT: `hash` _must_ be the result of a hash operation for the
     * verification to be secure: it is possible to craft signatures that
     * recover to arbitrary addresses for non-hashed data. A safe way to ensure
     * this is by receiving a hash of the original message (which may otherwise
     * be too long), and then calling {MessageHashUtils-toEthSignedMessageHash} on it.
     *
     * Documentation for signature generation:
     * - with https://web3js.readthedocs.io/en/v1.3.4/web3-eth-accounts.html#sign[Web3.js]
     * - with https://docs.ethers.io/v5/api/signer/#Signer-signMessage[ethers]
     */
    function tryRecover(bytes32 hash, bytes memory signature) internal pure returns (address, RecoverError, bytes32) {
        if (signature.length == 65) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            // ecrecover takes the signature parameters, and the only way to get them
            // currently is to use assembly.
            /// @solidity memory-safe-assembly
            assembly {
                r := mload(add(signature, 0x20))
                s := mload(add(signature, 0x40))
                v := byte(0, mload(add(signature, 0x60)))
            }
            return tryRecover(hash, v, r, s);
        } else {
            return (address(0), RecoverError.InvalidSignatureLength, bytes32(signature.length));
        }
    }

    /**
     * @dev Returns the address that signed a hashed message (`hash`) with
     * `signature`. This address can then be used for verification purposes.
     *
     * The `ecrecover` EVM precompile allows for malleable (non-unique) signatures:
     * this function rejects them by requiring the `s` value to be in the lower
     * half order, and the `v` value to be either 27 or 28.
     *
     * IMPORTANT: `hash` _must_ be the result of a hash operation for the
     * verification to be secure: it is possible to craft signatures that
     * recover to arbitrary addresses for non-hashed data. A safe way to ensure
     * this is by receiving a hash of the original message (which may otherwise
     * be too long), and then calling {MessageHashUtils-toEthSignedMessageHash} on it.
     */
    function recover(bytes32 hash, bytes memory signature) internal pure returns (address) {
        (address recovered, RecoverError error, bytes32 errorArg) = tryRecover(hash, signature);
        _throwError(error, errorArg);
        return recovered;
    }

    /**
     * @dev Overload of {ECDSA-tryRecover} that receives the `r` and `vs` short-signature fields separately.
     *
     * See https://eips.ethereum.org/EIPS/eip-2098[ERC-2098 short signatures]
     */
    function tryRecover(bytes32 hash, bytes32 r, bytes32 vs) internal pure returns (address, RecoverError, bytes32) {
        unchecked {
            bytes32 s = vs & bytes32(0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
            // We do not check for an overflow here since the shift operation results in 0 or 1.
            uint8 v = uint8((uint256(vs) >> 255) + 27);
            return tryRecover(hash, v, r, s);
        }
    }

    /**
     * @dev Overload of {ECDSA-recover} that receives the `r and `vs` short-signature fields separately.
     */
    function recover(bytes32 hash, bytes32 r, bytes32 vs) internal pure returns (address) {
        (address recovered, RecoverError error, bytes32 errorArg) = tryRecover(hash, r, vs);
        _throwError(error, errorArg);
        return recovered;
    }

    /**
     * @dev Overload of {ECDSA-tryRecover} that receives the `v`,
     * `r` and `s` signature fields separately.
     */
    function tryRecover(
        bytes32 hash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal pure returns (address, RecoverError, bytes32) {
        // EIP-2 still allows signature malleability for ecrecover(). Remove this possibility and make the signature
        // unique. Appendix F in the Ethereum Yellow paper (https://ethereum.github.io/yellowpaper/paper.pdf), defines
        // the valid range for s in (301): 0 < s < secp256k1n ÷ 2 + 1, and for v in (302): v ∈ {27, 28}. Most
        // signatures from current libraries generate a unique signature with an s-value in the lower half order.
        //
        // If your library generates malleable signatures, such as s-values in the upper range, calculate a new s-value
        // with 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141 - s1 and flip v from 27 to 28 or
        // vice versa. If your library also generates signatures with 0/1 for v instead 27/28, add 27 to v to accept
        // these malleable signatures as well.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return (address(0), RecoverError.InvalidSignatureS, s);
        }

        // If the signature is valid (and not malleable), return the signer address
        address signer = ecrecover(hash, v, r, s);
        if (signer == address(0)) {
            return (address(0), RecoverError.InvalidSignature, bytes32(0));
        }

        return (signer, RecoverError.NoError, bytes32(0));
    }

    /**
     * @dev Overload of {ECDSA-recover} that receives the `v`,
     * `r` and `s` signature fields separately.
     */
    function recover(bytes32 hash, uint8 v, bytes32 r, bytes32 s) internal pure returns (address) {
        (address recovered, RecoverError error, bytes32 errorArg) = tryRecover(hash, v, r, s);
        _throwError(error, errorArg);
        return recovered;
    }

    /**
     * @dev Optionally reverts with the corresponding custom error according to the `error` argument provided.
     */
    function _throwError(RecoverError error, bytes32 errorArg) private pure {
        if (error == RecoverError.NoError) {
            return; // no error: do nothing
        } else if (error == RecoverError.InvalidSignature) {
            revert ECDSAInvalidSignature();
        } else if (error == RecoverError.InvalidSignatureLength) {
            revert ECDSAInvalidSignatureLength(uint256(errorArg));
        } else if (error == RecoverError.InvalidSignatureS) {
            revert ECDSAInvalidSignatureS(errorArg);
        }
    }
}

// lib/erc7579-implementation/src/interfaces/IERC7579Account.sol

struct Execution {
    address target;
    uint256 value;
    bytes callData;
}

interface IERC7579Account {
    event ModuleInstalled(uint256 moduleTypeId, address module);
    event ModuleUninstalled(uint256 moduleTypeId, address module);

    /**
     * @dev Executes a transaction on behalf of the account.
     *         This function is intended to be called by ERC-4337 EntryPoint.sol
     * @dev Ensure adequate authorization control: i.e. onlyEntryPointOrSelf
     *
     * @dev MSA MUST implement this function signature.
     * If a mode is requested that is not supported by the Account, it MUST revert
     * @param mode The encoded execution mode of the transaction. See ModeLib.sol for details
     * @param executionCalldata The encoded execution call data
     */
    function execute(ModeCode mode, bytes calldata executionCalldata) external payable;

    /**
     * @dev Executes a transaction on behalf of the account.
     *         This function is intended to be called by Executor Modules
     * @dev Ensure adequate authorization control: i.e. onlyExecutorModule
     *
     * @dev MSA MUST implement this function signature.
     * If a mode is requested that is not supported by the Account, it MUST revert
     * @param mode The encoded execution mode of the transaction. See ModeLib.sol for details
     * @param executionCalldata The encoded execution call data
     */
    function executeFromExecutor(
        ModeCode mode,
        bytes calldata executionCalldata
    )
        external
        payable
        returns (bytes[] memory returnData);

    /**
     * @dev ERC-1271 isValidSignature
     *         This function is intended to be used to validate a smart account signature
     * and may forward the call to a validator module
     *
     * @param hash The hash of the data that is signed
     * @param data The data that is signed
     */
    function isValidSignature(bytes32 hash, bytes calldata data) external view returns (bytes4);

    /**
     * @dev installs a Module of a certain type on the smart account
     * @dev Implement Authorization control of your chosing
     * @param moduleTypeId the module type ID according the ERC-7579 spec
     * @param module the module address
     * @param initData arbitrary data that may be required on the module during `onInstall`
     * initialization.
     */
    function installModule(
        uint256 moduleTypeId,
        address module,
        bytes calldata initData
    )
        external
        payable;

    /**
     * @dev uninstalls a Module of a certain type on the smart account
     * @dev Implement Authorization control of your chosing
     * @param moduleTypeId the module type ID according the ERC-7579 spec
     * @param module the module address
     * @param deInitData arbitrary data that may be required on the module during `onUninstall`
     * de-initialization.
     */
    function uninstallModule(
        uint256 moduleTypeId,
        address module,
        bytes calldata deInitData
    )
        external
        payable;

    /**
     * Function to check if the account supports a certain CallType or ExecType (see ModeLib.sol)
     * @param encodedMode the encoded mode
     */
    function supportsExecutionMode(ModeCode encodedMode) external view returns (bool);

    /**
     * Function to check if the account supports installation of a certain module type Id
     * @param moduleTypeId the module type ID according the ERC-7579 spec
     */
    function supportsModule(uint256 moduleTypeId) external view returns (bool);

    /**
     * Function to check if the account has a certain module installed
     * @param moduleTypeId the module type ID according the ERC-7579 spec
     *      Note: keep in mind that some contracts can be multiple module types at the same time. It
     *            thus may be necessary to query multiple module types
     * @param module the module address
     * @param additionalContext additional context data that the smart account may interpret to
     *                          identifiy conditions under which the module is installed.
     *                          usually this is not necessary, but for some special hooks that
     *                          are stored in mappings, this param might be needed
     */
    function isModuleInstalled(
        uint256 moduleTypeId,
        address module,
        bytes calldata additionalContext
    )
        external
        view
        returns (bool);

    /**
     * @dev Returns the account id of the smart account
     * @return accountImplementationId the account id of the smart account
     * the accountId should be structured like so:
     *        "vendorname.accountname.semver"
     */
    function accountId() external view returns (string memory accountImplementationId);
}

// lib/erc7579-implementation/src/lib/ModeLib.sol

/**
 * @title ModeLib
 * To allow smart accounts to be very simple, but allow for more complex execution, A custom mode
 * encoding is used.
 *    Function Signature of execute function:
 *           function execute(ModeCode mode, bytes calldata executionCalldata) external payable;
 * This allows for a single bytes32 to be used to encode the execution mode, calltype, execType and
 * context.
 * NOTE: Simple Account implementations only have to scope for the most significant byte. Account  that
 * implement
 * more complex execution modes may use the entire bytes32.
 *
 * |--------------------------------------------------------------------|
 * | CALLTYPE  | EXECTYPE  |   UNUSED   | ModeSelector  |  ModePayload  |
 * |--------------------------------------------------------------------|
 * | 1 byte    | 1 byte    |   4 bytes  | 4 bytes       |   22 bytes    |
 * |--------------------------------------------------------------------|
 *
 * CALLTYPE: 1 byte
 * CallType is used to determine how the executeCalldata paramter of the execute function has to be
 * decoded.
 * It can be either single, batch or delegatecall. In the future different calls could be added.
 * CALLTYPE can be used by a validation module to determine how to decode <userOp.callData[36:]>.
 *
 * EXECTYPE: 1 byte
 * ExecType is used to determine how the account should handle the execution.
 * It can indicate if the execution should revert on failure or continue execution.
 * In the future more execution modes may be added.
 * Default Behavior (EXECTYPE = 0x00) is to revert on a single failed execution. If one execution in
 * a batch fails, the entire batch is reverted
 *
 * UNUSED: 4 bytes
 * Unused bytes are reserved for future use.
 *
 * ModeSelector: bytes4
 * The "optional" mode selector can be used by account vendors, to implement custom behavior in
 * their accounts.
 * the way a ModeSelector is to be calculated is bytes4(keccak256("vendorname.featurename"))
 * this is to prevent collisions between different vendors, while allowing innovation and the
 * development of new features without coordination between ERC-7579 implementing accounts
 *
 * ModePayload: 22 bytes
 * Mode payload is used to pass additional data to the smart account execution, this may be
 * interpreted depending on the ModeSelector
 *
 * ExecutionCallData: n bytes
 * single, delegatecall or batch exec abi.encoded as bytes
 */

// Custom type for improved developer experience
type ModeCode is bytes32;

type CallType is bytes1;

type ExecType is bytes1;

type ModeSelector is bytes4;

type ModePayload is bytes22;

// Default CallType
CallType constant CALLTYPE_SINGLE = CallType.wrap(0x00);
// Batched CallType
CallType constant CALLTYPE_BATCH = CallType.wrap(0x01);
// @dev Implementing delegatecall is OPTIONAL!
// implement delegatecall with extreme care.
CallType constant CALLTYPE_STATIC = CallType.wrap(0xFE);
CallType constant CALLTYPE_DELEGATECALL = CallType.wrap(0xFF);

// @dev default behavior is to revert on failure
// To allow very simple accounts to use mode encoding, the default behavior is to revert on failure
// Since this is value 0x00, no additional encoding is required for simple accounts
ExecType constant EXECTYPE_DEFAULT = ExecType.wrap(0x00);
// @dev account may elect to change execution behavior. For example "try exec" / "allow fail"
ExecType constant EXECTYPE_TRY = ExecType.wrap(0x01);

ModeSelector constant MODE_DEFAULT = ModeSelector.wrap(bytes4(0x00000000));
// Example declaration of a custom mode selector
ModeSelector constant MODE_OFFSET = ModeSelector.wrap(bytes4(keccak256("default.mode.offset")));

/**
 * @dev ModeLib is a helper library to encode/decode ModeCodes
 */
library ModeLib {
    function decode(ModeCode mode)
        internal
        pure
        returns (
            CallType _calltype,
            ExecType _execType,
            ModeSelector _modeSelector,
            ModePayload _modePayload
        )
    {
        assembly {
            _calltype := mode
            _execType := shl(8, mode)
            _modeSelector := shl(48, mode)
            _modePayload := shl(80, mode)
        }
    }

    function encode(
        CallType callType,
        ExecType execType,
        ModeSelector mode,
        ModePayload payload
    )
        internal
        pure
        returns (ModeCode)
    {
        return ModeCode.wrap(
            bytes32(
                abi.encodePacked(callType, execType, bytes4(0), ModeSelector.unwrap(mode), payload)
            )
        );
    }

    function encodeSimpleBatch() internal pure returns (ModeCode mode) {
        mode = encode(CALLTYPE_BATCH, EXECTYPE_DEFAULT, MODE_DEFAULT, ModePayload.wrap(0x00));
    }

    function encodeSimpleSingle() internal pure returns (ModeCode mode) {
        mode = encode(CALLTYPE_SINGLE, EXECTYPE_DEFAULT, MODE_DEFAULT, ModePayload.wrap(0x00));
    }

    function getCallType(ModeCode mode) internal pure returns (CallType calltype) {
        assembly {
            calltype := mode
        }
    }
}

using { eqModeSelector as == } for ModeSelector global;
using { eqCallType as == } for CallType global;
using { eqExecType as == } for ExecType global;

function eqCallType(CallType a, CallType b) pure returns (bool) {
    return CallType.unwrap(a) == CallType.unwrap(b);
}

function eqExecType(ExecType a, ExecType b) pure returns (bool) {
    return ExecType.unwrap(a) == ExecType.unwrap(b);
}

function eqModeSelector(ModeSelector a, ModeSelector b) pure returns (bool) {
    return ModeSelector.unwrap(a) == ModeSelector.unwrap(b);
}

// lib/delegation-framework/src/utils/Constants.sol

bytes32 constant EIP712_DOMAIN_TYPEHASH =
    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

// NOTE: signature is omitted from the Delegation typehash
bytes32 constant DELEGATION_TYPEHASH = keccak256(
    "Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)"
);

bytes32 constant CAVEAT_TYPEHASH = keccak256("Caveat(address enforcer,bytes terms)");

// lib/erc7579-implementation/src/lib/ExecutionLib.sol

/**
 * Helper Library for decoding Execution calldata
 * malloc for memory allocation is bad for gas. use this assembly instead
 */
library ExecutionLib {
    error ERC7579DecodingError();

    /**
     * @notice Decode a batch of `Execution` executionBatch from a `bytes` calldata.
     * @dev code is copied from solady's LibERC7579.sol
     * https://github.com/Vectorized/solady/blob/740812cedc9a1fc11e17cb3d4569744367dedf19/src/accounts/LibERC7579.sol#L146
     *      Credits to Vectorized and the Solady Team
     */
    function decodeBatch(bytes calldata executionCalldata)
        internal
        pure
        returns (Execution[] calldata executionBatch)
    {
        /// @solidity memory-safe-assembly
        assembly {
            let u := calldataload(executionCalldata.offset)
            let s := add(executionCalldata.offset, u)
            let e := sub(add(executionCalldata.offset, executionCalldata.length), 0x20)
            executionBatch.offset := add(s, 0x20)
            executionBatch.length := calldataload(s)
            if or(shr(64, u), gt(add(s, shl(5, executionBatch.length)), e)) {
                mstore(0x00, 0xba597e7e) // `DecodingError()`.
                revert(0x1c, 0x04)
            }
            if executionBatch.length {
                // Perform bounds checks on the decoded `executionBatch`.
                // Loop runs out-of-gas if `executionBatch.length` is big enough to cause overflows.
                for { let i := executionBatch.length } 1 { } {
                    i := sub(i, 1)
                    let p := calldataload(add(executionBatch.offset, shl(5, i)))
                    let c := add(executionBatch.offset, p)
                    let q := calldataload(add(c, 0x40))
                    let o := add(c, q)
                    // forgefmt: disable-next-item
                    if or(shr(64, or(calldataload(o), or(p, q))),
                        or(gt(add(c, 0x40), e), gt(add(o, calldataload(o)), e))) {
                        mstore(0x00, 0xba597e7e) // `DecodingError()`.
                        revert(0x1c, 0x04)
                    }
                    if iszero(i) { break }
                }
            }
        }
    }

    function encodeBatch(Execution[] memory executions)
        internal
        pure
        returns (bytes memory callData)
    {
        callData = abi.encode(executions);
    }

    function decodeSingle(bytes calldata executionCalldata)
        internal
        pure
        returns (address target, uint256 value, bytes calldata callData)
    {
        target = address(bytes20(executionCalldata[0:20]));
        value = uint256(bytes32(executionCalldata[20:52]));
        callData = executionCalldata[52:];
    }

    function encodeSingle(
        address target,
        uint256 value,
        bytes memory callData
    )
        internal
        pure
        returns (bytes memory userOpCalldata)
    {
        userOpCalldata = abi.encodePacked(target, value, callData);
    }
}

// lib/delegation-framework/src/interfaces/ICaveatEnforcer.sol

/**
 * @title CaveatEnforcer
 * @notice This is an abstract contract that exposes pre and post Execution hooks during delegation redemption.
 * @dev Hooks can be used to enforce conditions before and after an Execution is performed.
 * @dev Reverting during the hooks will revert the entire delegation redemption.
 * @dev Child contracts can implement the beforeAllHook, beforeHook, afterAllHook, afterHook methods.
 * @dev NOTE: There is no guarantee that the Execution is performed. If you are relying on the execution then
 * be sure to use the `afterHook` or `afterAllHook` methods to validate any required conditions.
 */
interface ICaveatEnforcer {
    /**
     * @notice Enforces conditions before any actions in a batch redemption process begin.
     * @dev This function MUST revert if the conditions are not met.
     * @param _terms The terms to enforce set by the delegator.
     * @param _args An optional input parameter set by the redeemer at time of invocation.
     * @param _mode The mode of execution for the executionCalldata.
     * @param _executionCalldata The data representing the execution.
     * @param _delegationHash The hash of the delegation.
     * @param _delegator The address of the delegator.
     * @param _redeemer The address that is redeeming the delegation.
     */
    function beforeAllHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    )
        external;

    /**
     * @notice Enforces conditions before the execution tied to a specific delegation in the redemption process.
     * @dev This function MUST revert if the conditions are not met.
     * @param _terms The terms to enforce set by the delegator.
     * @param _args An optional input parameter set by the redeemer at time of invocation.
     * @param _mode The mode of execution for the executionCalldata.
     * @param _executionCalldata The data representing the execution.
     * @param _delegationHash The hash of the delegation.
     * @param _delegator The address of the delegator.
     * @param _redeemer The address that is redeeming the delegation.
     */
    function beforeHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    )
        external;

    /**
     * @notice Enforces conditions after the execution tied to a specific delegation in the redemption process.
     * @dev This function MUST revert if the conditions are not met.
     * @param _terms The terms to enforce set by the delegator.
     * @param _args An optional input parameter set by the redeemer at time of invocation.
     * @param _mode The mode of execution for the executionCalldata.
     * @param _executionCalldata The data representing the execution.
     * @param _delegationHash The hash of the delegation.
     * @param _delegator The address of the delegator.
     * @param _redeemer The address that is redeeming the delegation.
     */
    function afterHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    )
        external;

    /**
     * @notice Enforces conditions after all actions in a batch redemption process have been executed.
     * @dev This function MUST revert if the conditions are not met.
     * @param _terms The terms to enforce set by the delegator.
     * @param _args An optional input parameter set by the redeemer at time of invocation.
     * @param _mode The mode of execution for the executionCalldata.
     * @param _executionCalldata The data representing the execution.
     * @param _delegationHash The hash of the delegation.
     * @param _delegator The address of the delegator.
     * @param _redeemer The address that is redeeming the delegation.
     */
    function afterAllHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    )
        external;
}

// lib/delegation-framework/src/enforcers/CaveatEnforcer.sol

/**
 * @title CaveatEnforcer
 * @dev This abstract contract enforces caveats before and after the execution of an execution.
 */
abstract contract CaveatEnforcer is ICaveatEnforcer {
    using ModeLib for ModeCode;

    /// @inheritdoc ICaveatEnforcer
    function beforeAllHook(bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address) public virtual { }

    /// @inheritdoc ICaveatEnforcer
    function beforeHook(bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address) public virtual { }

    /// @inheritdoc ICaveatEnforcer
    function afterHook(bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address) public virtual { }

    /// @inheritdoc ICaveatEnforcer
    function afterAllHook(bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address) public virtual { }

    /**
     * @dev Require the function call to be in single call type
     */
    modifier onlySingleCallTypeMode(ModeCode _mode) {
        {
            require(ModeLib.getCallType(_mode) == CALLTYPE_SINGLE, "CaveatEnforcer:invalid-call-type");
        }
        _;
    }

    /**
     * @dev Require the function call to be in batch call type
     */
    modifier onlyBatchCallTypeMode(ModeCode _mode) {
        {
            require(ModeLib.getCallType(_mode) == CALLTYPE_BATCH, "CaveatEnforcer:invalid-call-type");
        }
        _;
    }

    /**
     * @dev Require the function call to be in default execution mode
     */
    modifier onlyDefaultExecutionMode(ModeCode _mode) {
        {
            (, ExecType _execType,,) = _mode.decode();
            require(_execType == EXECTYPE_DEFAULT, "CaveatEnforcer:invalid-execution-type");
        }
        _;
    }

    /**
     * @dev Require the function call to be in try execution mode
     */
    modifier onlyTryExecutionMode(ModeCode _mode) {
        {
            (, ExecType _execType,,) = _mode.decode();
            require(_execType == EXECTYPE_TRY, "CaveatEnforcer:invalid-execution-type");
        }
        _;
    }
}

// src/RobotPaymentPolicyEnforcer.sol

/**
 * @title RobotPaymentPolicyEnforcer
 * @notice A MetaMask Delegation Framework (v1.3.0) caveat that turns a delegation into a robot's USDC spending policy
 * on Arc. A payment within policy (at most `perPaymentCap`, to an allowlisted payee) passes. Any other payment passes
 * only with the approver's EIP-712 signature over exactly that payment, and each approval works once.
 *
 * @dev Terms: `abi.encode(uint256 perPaymentCap, address[] allowlist, address approver)` (`policyTerms` in
 * packages/chain/src/Grant.ts).
 *
 * Args: empty, or `abi.encode(Approval approval, bytes signature)` with a 65-byte `r‖s‖v` signature (`approvalArgs` in
 * Grant.ts). Args are outside the signed delegation, so the redeemer injects them per payment. They are ignored when
 * the payment is within policy, so an approval is never consumed by a payment that does not need it.
 *
 * Execution: single call type, default exec type, `USDC.transfer(payee, amount)` with zero value; anything else
 * reverts.
 *
 * Approval domain: `{name: "VitaquackApproval", version: "1", chainId: block.chainid, verifyingContract: this}`
 * (`approvalDigest` in packages/protocol/src/Approval.ts). The separator is computed on every call and nothing in the
 * runtime code depends on the deployment address, so the code can be injected elsewhere with a state override for
 * simulation and still verify approvals for that address.
 *
 * Replay: approval nonces are consumed per delegation manager (`usedNonces[msg.sender][nonce]`), so calling this hook
 * directly cannot burn a nonce that a real redemption needs.
 *
 * Not visible here: the invoice hash of the payment. It is the leaf delegation's `Id` caveat term, and a caveat only
 * receives its own delegation's terms and args. The approval's `invoiceHash` is covered by the approver's signature and
 * emitted in `PaymentApproved`; on-chain the approval binds payee, amount, expiry and a single use. The grant's other
 * caveats still apply: an approval lifts neither the daily cap (ERC20PeriodTransferEnforcer) nor the grant's expiry.
 */
contract RobotPaymentPolicyEnforcer is CaveatEnforcer {
    using ExecutionLib for bytes;

    ////////////////////////////// Types //////////////////////////////

    /// @notice The approver's consent to one payment (`Approval` in packages/protocol/src/Approval.ts).
    struct Approval {
        bytes32 invoiceHash;
        address payee;
        uint256 amount;
        uint64 expiry;
        bytes32 nonce;
    }

    ////////////////////////////// Constants //////////////////////////////

    /// @notice Arc's USDC: the ERC-20 view (6 decimals) of the native coin.
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    bytes32 public constant APPROVAL_TYPEHASH =
        keccak256("Approval(bytes32 invoiceHash,address payee,uint256 amount,uint64 expiry,bytes32 nonce)");

    bytes32 private constant NAME_HASH = keccak256("VitaquackApproval");
    bytes32 private constant VERSION_HASH = keccak256("1");

    /// @dev `bytes4(keccak256("transfer(address,uint256)"))`.
    bytes4 private constant TRANSFER_SELECTOR = 0xa9059cbb;

    /// @dev 20-byte target ‖ 32-byte value ‖ 68-byte `transfer(address,uint256)` calldata.
    uint256 private constant TRANSFER_EXECUTION_LENGTH = 120;

    ////////////////////////////// State //////////////////////////////

    /// @notice Approval nonces already consumed, per delegation manager.
    mapping(address delegationManager => mapping(bytes32 nonce => bool used)) public usedNonces;

    ////////////////////////////// Events //////////////////////////////

    /// @notice A payment outside the policy passed with the approver's signature; its nonce is now spent.
    event PaymentApproved(
        address indexed delegationManager,
        bytes32 indexed delegationHash,
        bytes32 indexed nonce,
        address delegator,
        bytes32 invoiceHash,
        address payee,
        uint256 amount
    );

    ////////////////////////////// Hook //////////////////////////////

    /**
     * @notice Allows the USDC transfer when it is within policy or carries a valid, unused approval for exactly it.
     * @param _terms `abi.encode(uint256 perPaymentCap, address[] allowlist, address approver)`.
     * @param _args Empty, or `abi.encode(Approval, bytes signature)`.
     * @param _mode Must be single call type with default exec type.
     * @param _executionCallData `abi.encodePacked(USDC, uint256(0), transfer(payee, amount))`.
     * @param _delegationHash The hash of the delegation carrying this caveat (the grant).
     * @param _delegator The delegator of that delegation (the owner's account).
     */
    function beforeHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCallData,
        bytes32 _delegationHash,
        address _delegator,
        address
    ) public override onlySingleCallTypeMode(_mode) onlyDefaultExecutionMode(_mode) {
        _enforce(_terms, _args, _executionCallData, _delegationHash, _delegator);
    }

    ////////////////////////////// Views //////////////////////////////

    /// @notice Decodes the terms: `abi.encode(uint256 perPaymentCap, address[] allowlist, address approver)`.
    function getTermsInfo(bytes calldata _terms)
        public
        pure
        returns (uint256 perPaymentCap_, address[] memory allowlist_, address approver_)
    {
        (perPaymentCap_, allowlist_, approver_) = abi.decode(_terms, (uint256, address[], address));
    }

    /// @notice The EIP-712 domain separator of approvals for this enforcer on this chain.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    /// @notice The digest the approver signs (raw, no EIP-191 prefix), equal to protocol's `approvalDigest`.
    function approvalDigest(Approval memory _approval) public view returns (bytes32) {
        bytes32 structHash_ = keccak256(
            abi.encode(
                APPROVAL_TYPEHASH,
                _approval.invoiceHash,
                _approval.payee,
                _approval.amount,
                _approval.expiry,
                _approval.nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash_));
    }

    ////////////////////////////// Internal //////////////////////////////

    /// @dev The hook body, out of `beforeHook` so the stack fits without via-IR (Arc Studio compiles the legacy way).
    function _enforce(
        bytes calldata _terms,
        bytes calldata _args,
        bytes calldata _executionCallData,
        bytes32 _delegationHash,
        address _delegator
    ) private {
        (address payee_, uint256 amount_) = _decodeTransfer(_executionCallData);
        (bool withinPolicy_, address approver_) = _checkPolicy(_terms, payee_, amount_);
        if (withinPolicy_) return;

        require(_args.length != 0, "RPP:approval-required");
        _consumeApproval(_args, approver_, payee_, amount_, _delegationHash, _delegator);
    }

    /// @dev Decodes the single execution as `USDC.transfer(payee, amount)` with zero value.
    function _decodeTransfer(bytes calldata _executionCallData) private pure returns (address payee_, uint256 amount_) {
        require(_executionCallData.length == TRANSFER_EXECUTION_LENGTH, "RPP:invalid-execution-length");
        (address target_, uint256 value_, bytes calldata callData_) = _executionCallData.decodeSingle();
        require(target_ == USDC, "RPP:invalid-target");
        require(value_ == 0, "RPP:invalid-value");
        require(bytes4(callData_[0:4]) == TRANSFER_SELECTOR, "RPP:invalid-method");

        uint256 payeeWord_ = uint256(bytes32(callData_[4:36]));
        require(payeeWord_ >> 160 == 0, "RPP:invalid-payee");
        // forge-lint: disable-next-line(unsafe-typecast) -- the require above proves the upper 96 bits are zero
        payee_ = address(uint160(payeeWord_));
        amount_ = uint256(bytes32(callData_[36:68]));
    }

    /// @dev Whether the payment is within policy, and the approver who may approve it otherwise.
    function _checkPolicy(bytes calldata _terms, address _payee, uint256 _amount)
        private
        pure
        returns (bool withinPolicy_, address approver_)
    {
        uint256 perPaymentCap_;
        address[] memory allowlist_;
        (perPaymentCap_, allowlist_, approver_) = getTermsInfo(_terms);
        if (_amount <= perPaymentCap_) {
            uint256 length_ = allowlist_.length;
            for (uint256 i = 0; i < length_; ++i) {
                if (allowlist_[i] == _payee) {
                    withinPolicy_ = true;
                    break;
                }
            }
        }
    }

    /// @dev Verifies the approval against this payment and the approver, then spends its nonce.
    function _consumeApproval(
        bytes calldata _args,
        address _approver,
        address _payee,
        uint256 _amount,
        bytes32 _delegationHash,
        address _delegator
    ) private {
        (Approval memory approval_, bytes memory signature_) = abi.decode(_args, (Approval, bytes));
        require(approval_.payee == _payee, "RPP:approval-payee-mismatch");
        require(approval_.amount == _amount, "RPP:approval-amount-mismatch");
        // forge-lint: disable-next-line(block-timestamp) -- an approval expiry is minutes long; seconds of drift are fine
        require(block.timestamp <= approval_.expiry, "RPP:approval-expired");
        {
            (address signer_, ECDSA.RecoverError error_,) = ECDSA.tryRecover(approvalDigest(approval_), signature_);
            require(error_ == ECDSA.RecoverError.NoError && signer_ == _approver, "RPP:invalid-approval-signature");
        }
        require(!usedNonces[msg.sender][approval_.nonce], "RPP:approval-nonce-used");
        usedNonces[msg.sender][approval_.nonce] = true;

        // forge-lint: disable-next-item(reentrancy-events) -- the only call before it is the ecrecover precompile
        emit PaymentApproved(
            msg.sender, _delegationHash, approval_.nonce, _delegator, approval_.invoiceHash, _payee, _amount
        );
    }
}

