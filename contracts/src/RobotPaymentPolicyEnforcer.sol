// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import { CaveatEnforcer } from "@delegation-framework/enforcers/CaveatEnforcer.sol";
import { EIP712_DOMAIN_TYPEHASH } from "@delegation-framework/utils/Constants.sol";
import { ModeCode } from "@delegation-framework/utils/Types.sol";

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
