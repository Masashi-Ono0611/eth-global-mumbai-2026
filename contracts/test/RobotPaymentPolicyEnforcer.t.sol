// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { Test } from "forge-std/Test.sol";
import {
    ModeLib,
    ModeCode,
    ModePayload,
    CALLTYPE_BATCH,
    CALLTYPE_SINGLE,
    EXECTYPE_DEFAULT,
    EXECTYPE_TRY,
    MODE_DEFAULT
} from "@erc7579/lib/ModeLib.sol";

import { RobotPaymentPolicyEnforcer } from "../src/RobotPaymentPolicyEnforcer.sol";

/// @dev The grant's policy in every test: cap 0.30 USDC per payment, allowlist [cafe, bakery], one approver key. The
/// test contract plays no role; `delegationManager` is the hook's caller, as the DelegationManager is on Arc.
contract RobotPaymentPolicyEnforcerTest is Test {
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant ARC_CHAIN_ID = 5042;
    uint256 internal constant CAP = 300_000; // 0.30 USDC, 6 decimals
    bytes32 internal constant GRANT_HASH = keccak256("grant");
    bytes32 internal constant INVOICE_HASH = keccak256("invoice:cigarettes");
    uint256 internal constant NOW = 1_794_000_000;

    RobotPaymentPolicyEnforcer internal enforcer;
    address internal delegationManager;
    address internal owner;
    address internal relayer;
    address internal cafe;
    address internal bakery;
    address internal restricted;
    address internal approver;
    uint256 internal approverKey;
    bytes internal terms;

    event PaymentApproved(
        address indexed delegationManager,
        bytes32 indexed delegationHash,
        bytes32 indexed nonce,
        address delegator,
        bytes32 invoiceHash,
        address payee,
        uint256 amount
    );

    function setUp() public {
        vm.chainId(ARC_CHAIN_ID);
        vm.warp(NOW);
        delegationManager = makeAddr("DelegationManager");
        owner = makeAddr("owner");
        relayer = makeAddr("relayer");
        cafe = makeAddr("duck-cafe");
        bakery = makeAddr("bakery");
        restricted = makeAddr("restricted-payee");
        (approver, approverKey) = makeAddrAndKey("approver");
        enforcer = new RobotPaymentPolicyEnforcer();
        terms = _terms(CAP, approver);
    }

    ////////////////////////////// Helpers //////////////////////////////

    function _terms(uint256 _cap, address _approver) internal view returns (bytes memory) {
        address[] memory allowlist_ = new address[](2);
        allowlist_[0] = cafe;
        allowlist_[1] = bakery;
        return abi.encode(_cap, allowlist_, _approver);
    }

    function _transfer(address _payee, uint256 _amount) internal pure returns (bytes memory) {
        return abi.encodePacked(USDC, uint256(0), abi.encodeWithSelector(bytes4(0xa9059cbb), _payee, _amount));
    }

    function _approval(address _payee, uint256 _amount)
        internal
        view
        returns (RobotPaymentPolicyEnforcer.Approval memory)
    {
        return RobotPaymentPolicyEnforcer.Approval({
            invoiceHash: INVOICE_HASH,
            payee: _payee,
            amount: _amount,
            expiry: uint64(block.timestamp + 300),
            nonce: keccak256(abi.encode("nonce", _payee, _amount))
        });
    }

    /// @dev EIP-712 written out independently of the contract, so a shared mistake cannot hide.
    function _digest(RobotPaymentPolicyEnforcer.Approval memory _a, address _verifyingContract, uint256 _chainId)
        internal
        pure
        returns (bytes32)
    {
        bytes32 domain_ = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("VitaquackApproval"),
                keccak256("1"),
                _chainId,
                _verifyingContract
            )
        );
        bytes32 struct_ = keccak256(
            abi.encode(
                keccak256("Approval(bytes32 invoiceHash,address payee,uint256 amount,uint64 expiry,bytes32 nonce)"),
                _a.invoiceHash,
                _a.payee,
                _a.amount,
                _a.expiry,
                _a.nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain_, struct_));
    }

    function _sign(uint256 _key, bytes32 _hash) internal pure returns (bytes memory) {
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(_key, _hash);
        return abi.encodePacked(r_, s_, v_);
    }

    function _signedArgs(RobotPaymentPolicyEnforcer.Approval memory _a) internal view returns (bytes memory) {
        return abi.encode(_a, _sign(approverKey, _digest(_a, address(enforcer), block.chainid)));
    }

    function _hook(bytes memory _args, bytes memory _execution) internal {
        _hookWith(terms, _args, ModeLib.encodeSimpleSingle(), _execution);
    }

    function _hookWith(bytes memory _terms_, bytes memory _args, ModeCode _mode, bytes memory _execution) internal {
        vm.prank(delegationManager);
        enforcer.beforeHook(_terms_, _args, _mode, _execution, GRANT_HASH, owner, relayer);
    }

    ////////////////////////////// Within policy //////////////////////////////

    function test_underCapAllowlisted_passes() public {
        _hook("", _transfer(cafe, 100_000));
    }

    function test_atCapAllowlisted_passes() public {
        _hook("", _transfer(bakery, CAP));
    }

    function test_withinPolicy_ignoresArgsAndKeepsNonce() public {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(cafe, 100_000);
        _hook(_signedArgs(a_), _transfer(cafe, 100_000));
        assertFalse(enforcer.usedNonces(delegationManager, a_.nonce));
    }

    ////////////////////////////// Outside policy, no approval //////////////////////////////

    function test_overCapWithoutApproval_reverts() public {
        bytes memory execution_ = _transfer(cafe, CAP + 1);
        vm.expectRevert(bytes("RPP:approval-required"));
        _hook("", execution_);
    }

    function test_unallowlistedWithoutApproval_reverts() public {
        bytes memory execution_ = _transfer(restricted, 100_000);
        vm.expectRevert(bytes("RPP:approval-required"));
        _hook("", execution_);
    }

    function test_emptyAllowlist_requiresApprovalForEveryPayee() public {
        bytes memory terms_ = abi.encode(CAP, new address[](0), approver);
        bytes memory execution_ = _transfer(cafe, 1);
        vm.expectRevert(bytes("RPP:approval-required"));
        _hookWith(terms_, "", ModeLib.encodeSimpleSingle(), execution_);
    }

    ////////////////////////////// Valid approvals //////////////////////////////

    function test_overCapWithValidApproval_passesAndSpendsNonce() public {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(cafe, 500_000);
        bytes memory args_ = _signedArgs(a_);
        vm.expectEmit(true, true, true, true, address(enforcer));
        emit PaymentApproved(delegationManager, GRANT_HASH, a_.nonce, owner, INVOICE_HASH, cafe, 500_000);
        _hook(args_, _transfer(cafe, 500_000));
        assertTrue(enforcer.usedNonces(delegationManager, a_.nonce));
    }

    function test_unallowlistedWithValidApproval_passes() public {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(restricted, 250_000);
        _hook(_signedArgs(a_), _transfer(restricted, 250_000));
        assertTrue(enforcer.usedNonces(delegationManager, a_.nonce));
    }

    function test_approvalValidAtExpirySecond() public {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(restricted, 500_000);
        bytes memory args_ = _signedArgs(a_);
        vm.warp(a_.expiry);
        _hook(args_, _transfer(restricted, 500_000));
    }

    ////////////////////////////// Invalid approvals //////////////////////////////

    function test_wrongSigner_reverts() public {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(restricted, 500_000);
        (, uint256 strangerKey_) = makeAddrAndKey("stranger");
        bytes memory args_ = abi.encode(a_, _sign(strangerKey_, _digest(a_, address(enforcer), block.chainid)));
        bytes memory execution_ = _transfer(restricted, 500_000);
        vm.expectRevert(bytes("RPP:invalid-approval-signature"));
        _hook(args_, execution_);
    }

    function test_signatureForAnotherEnforcer_reverts() public {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(restricted, 500_000);
        bytes memory args_ = abi.encode(a_, _sign(approverKey, _digest(a_, address(0xE4F02), block.chainid)));
        bytes memory execution_ = _transfer(restricted, 500_000);
        vm.expectRevert(bytes("RPP:invalid-approval-signature"));
        _hook(args_, execution_);
    }

    function test_signatureForAnotherChain_reverts() public {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(restricted, 500_000);
        bytes memory args_ = abi.encode(a_, _sign(approverKey, _digest(a_, address(enforcer), 5_042_002)));
        bytes memory execution_ = _transfer(restricted, 500_000);
        vm.expectRevert(bytes("RPP:invalid-approval-signature"));
        _hook(args_, execution_);
    }

    function test_malformedSignatures_revert() public {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(restricted, 500_000);
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(approverKey, _digest(a_, address(enforcer), block.chainid));
        bytes memory execution_ = _transfer(restricted, 500_000);

        // 64 bytes (no v).
        bytes memory args_ = abi.encode(a_, abi.encodePacked(r_, s_));
        vm.expectRevert(bytes("RPP:invalid-approval-signature"));
        _hook(args_, execution_);

        // The malleable twin (n - s, flipped v) of a valid signature.
        uint256 n_ = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        args_ = abi.encode(a_, abi.encodePacked(r_, bytes32(n_ - uint256(s_)), v_ == 27 ? uint8(28) : uint8(27)));
        vm.expectRevert(bytes("RPP:invalid-approval-signature"));
        _hook(args_, execution_);
    }

    function test_zeroApprover_cannotApprove() public {
        bytes memory terms_ = _terms(CAP, address(0));
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(restricted, 500_000);
        bytes memory args_ = _signedArgs(a_);
        bytes memory execution_ = _transfer(restricted, 500_000);
        vm.expectRevert(bytes("RPP:invalid-approval-signature"));
        _hookWith(terms_, args_, ModeLib.encodeSimpleSingle(), execution_);
    }

    function test_expiredApproval_reverts() public {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(restricted, 500_000);
        bytes memory args_ = _signedArgs(a_);
        bytes memory execution_ = _transfer(restricted, 500_000);
        vm.warp(uint256(a_.expiry) + 1);
        vm.expectRevert(bytes("RPP:approval-expired"));
        _hook(args_, execution_);
    }

    function test_nonceReplay_reverts() public {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(restricted, 500_000);
        bytes memory args_ = _signedArgs(a_);
        bytes memory execution_ = _transfer(restricted, 500_000);
        _hook(args_, execution_);
        vm.expectRevert(bytes("RPP:approval-nonce-used"));
        _hook(args_, execution_);
    }

    function test_nonceReplay_withAnotherSignedPayment_reverts() public {
        RobotPaymentPolicyEnforcer.Approval memory first_ = _approval(restricted, 500_000);
        _hook(_signedArgs(first_), _transfer(restricted, 500_000));

        RobotPaymentPolicyEnforcer.Approval memory second_ = _approval(restricted, 400_000);
        second_.nonce = first_.nonce;
        bytes memory args_ = _signedArgs(second_);
        bytes memory execution_ = _transfer(restricted, 400_000);
        vm.expectRevert(bytes("RPP:approval-nonce-used"));
        _hook(args_, execution_);
    }

    function test_approvalForAnotherPayee_reverts() public {
        bytes memory args_ = _signedArgs(_approval(restricted, 500_000));
        bytes memory execution_ = _transfer(makeAddr("other-shop"), 500_000);
        vm.expectRevert(bytes("RPP:approval-payee-mismatch"));
        _hook(args_, execution_);
    }

    function test_approvalForAnotherAmount_reverts() public {
        bytes memory args_ = _signedArgs(_approval(restricted, 500_000));
        bytes memory execution_ = _transfer(restricted, 500_001);
        vm.expectRevert(bytes("RPP:approval-amount-mismatch"));
        _hook(args_, execution_);
    }

    function test_approvalWithSwappedInvoiceHash_reverts() public {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(restricted, 500_000);
        bytes memory signature_ = _sign(approverKey, _digest(a_, address(enforcer), block.chainid));
        a_.invoiceHash = keccak256("invoice:another");
        bytes memory args_ = abi.encode(a_, signature_);
        bytes memory execution_ = _transfer(restricted, 500_000);
        vm.expectRevert(bytes("RPP:invalid-approval-signature"));
        _hook(args_, execution_);
    }

    function test_approvalWithStretchedExpiry_reverts() public {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(restricted, 500_000);
        bytes memory signature_ = _sign(approverKey, _digest(a_, address(enforcer), block.chainid));
        a_.expiry += 3600;
        bytes memory args_ = abi.encode(a_, signature_);
        bytes memory execution_ = _transfer(restricted, 500_000);
        vm.expectRevert(bytes("RPP:invalid-approval-signature"));
        _hook(args_, execution_);
    }

    /// @dev Front-running grief: someone copies the approval from the mempool and calls the hook directly. That spends
    /// the nonce only in the caller's namespace; the DelegationManager's redemption still passes.
    function test_directCall_cannotBurnTheDelegationManagersNonce() public {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(restricted, 500_000);
        bytes memory args_ = _signedArgs(a_);
        bytes memory execution_ = _transfer(restricted, 500_000);

        address griefer_ = makeAddr("griefer");
        vm.prank(griefer_);
        enforcer.beforeHook(terms, args_, ModeLib.encodeSimpleSingle(), execution_, GRANT_HASH, owner, griefer_);
        assertTrue(enforcer.usedNonces(griefer_, a_.nonce));
        assertFalse(enforcer.usedNonces(delegationManager, a_.nonce));

        _hook(args_, execution_);
        assertTrue(enforcer.usedNonces(delegationManager, a_.nonce));
    }

    ////////////////////////////// Execution shape //////////////////////////////

    function test_batchCallType_reverts() public {
        ModeCode mode_ = ModeLib.encode(CALLTYPE_BATCH, EXECTYPE_DEFAULT, MODE_DEFAULT, ModePayload.wrap(0x00));
        bytes memory execution_ = _transfer(cafe, 100_000);
        vm.expectRevert(bytes("CaveatEnforcer:invalid-call-type"));
        _hookWith(terms, "", mode_, execution_);
    }

    function test_tryExecType_reverts() public {
        ModeCode mode_ = ModeLib.encode(CALLTYPE_SINGLE, EXECTYPE_TRY, MODE_DEFAULT, ModePayload.wrap(0x00));
        bytes memory execution_ = _transfer(cafe, 100_000);
        vm.expectRevert(bytes("CaveatEnforcer:invalid-execution-type"));
        _hookWith(terms, "", mode_, execution_);
    }

    function test_nonTransferMethod_reverts() public {
        // approve(cafe, 0.10) on USDC: same shape as a transfer, wrong selector.
        bytes memory execution_ =
            abi.encodePacked(USDC, uint256(0), abi.encodeWithSelector(bytes4(0x095ea7b3), cafe, uint256(100_000)));
        vm.expectRevert(bytes("RPP:invalid-method"));
        _hook("", execution_);
    }

    function test_otherToken_reverts() public {
        bytes memory execution_ = abi.encodePacked(
            makeAddr("other-token"), uint256(0), abi.encodeWithSelector(bytes4(0xa9059cbb), cafe, uint256(100_000))
        );
        vm.expectRevert(bytes("RPP:invalid-target"));
        _hook("", execution_);
    }

    function test_nativeValue_reverts() public {
        bytes memory execution_ =
            abi.encodePacked(USDC, uint256(1), abi.encodeWithSelector(bytes4(0xa9059cbb), cafe, uint256(100_000)));
        vm.expectRevert(bytes("RPP:invalid-value"));
        _hook("", execution_);
    }

    function test_executionLength_reverts() public {
        bytes memory long_ = abi.encodePacked(_transfer(cafe, 100_000), bytes1(0x00));
        vm.expectRevert(bytes("RPP:invalid-execution-length"));
        _hook("", long_);

        bytes memory short_ = abi.encodePacked(USDC, uint256(0));
        vm.expectRevert(bytes("RPP:invalid-execution-length"));
        _hook("", short_);
    }

    function test_dirtyPayeeWord_reverts() public {
        bytes memory execution_ = abi.encodePacked(
            USDC,
            uint256(0),
            bytes4(0xa9059cbb),
            bytes32(uint256(uint160(cafe)) | (uint256(1) << 200)),
            uint256(100_000)
        );
        vm.expectRevert(bytes("RPP:invalid-payee"));
        _hook("", execution_);
    }

    ////////////////////////////// Views //////////////////////////////

    function test_getTermsInfo_decodesTerms() public view {
        (uint256 cap_, address[] memory allowlist_, address approver_) = enforcer.getTermsInfo(terms);
        assertEq(cap_, CAP);
        assertEq(allowlist_.length, 2);
        assertEq(allowlist_[0], cafe);
        assertEq(allowlist_[1], bakery);
        assertEq(approver_, approver);
    }

    function test_approvalDigest_matchesIndependentEip712() public view {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval(restricted, 500_000);
        assertEq(enforcer.approvalDigest(a_), _digest(a_, address(enforcer), ARC_CHAIN_ID));
    }

    ////////////////////////////// Fuzz //////////////////////////////

    function testFuzz_withinCapToAllowlisted_passes(uint256 _amount, bool _toBakery) public {
        _amount = bound(_amount, 0, CAP);
        _hook("", _transfer(_toBakery ? bakery : cafe, _amount));
    }

    function testFuzz_overCap_needsApproval(uint256 _amount) public {
        _amount = bound(_amount, CAP + 1, type(uint256).max);
        bytes memory execution_ = _transfer(cafe, _amount);
        vm.expectRevert(bytes("RPP:approval-required"));
        _hook("", execution_);
    }

    function testFuzz_unallowlisted_needsApproval(address _payee, uint256 _amount) public {
        vm.assume(_payee != cafe && _payee != bakery);
        _amount = bound(_amount, 0, CAP);
        bytes memory execution_ = _transfer(_payee, _amount);
        vm.expectRevert(bytes("RPP:approval-required"));
        _hook("", execution_);
    }

    ////////////////////////////// Gas //////////////////////////////

    /// @dev Execution gas of the hook call as the DelegationManager makes it (cold enforcer storage), logged with -vv.
    function test_gas_policyPath() public {
        bytes memory execution_ = _transfer(cafe, 100_000);
        ModeCode mode_ = ModeLib.encodeSimpleSingle();
        bytes memory terms_ = terms;
        vm.prank(delegationManager);
        uint256 before_ = gasleft();
        enforcer.beforeHook(terms_, "", mode_, execution_, GRANT_HASH, owner, relayer);
        emit log_named_uint("beforeHook gas, within policy (cap + allowlist)", before_ - gasleft());
    }

    function test_gas_approvalPath() public {
        bytes memory execution_ = _transfer(restricted, 500_000);
        bytes memory args_ = _signedArgs(_approval(restricted, 500_000));
        ModeCode mode_ = ModeLib.encodeSimpleSingle();
        bytes memory terms_ = terms;
        vm.prank(delegationManager);
        uint256 before_ = gasleft();
        enforcer.beforeHook(terms_, args_, mode_, execution_, GRANT_HASH, owner, relayer);
        emit log_named_uint("beforeHook gas, approval path (verify + spend nonce + event)", before_ - gasleft());
    }
}
