// SPDX-License-Identifier: MIT
pragma solidity =0.8.23;

import {Test} from "forge-std/Test.sol";
import {RobotPaymentPolicyEnforcer, ModeCode, ModeLib} from "../RobotPaymentPolicyEnforcer.sol";

contract RobotPaymentPolicyEnforcerTest is Test {
    RobotPaymentPolicyEnforcer internal enforcer;

    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant CAP = 100e6;

    address internal manager = makeAddr("manager");
    address internal manager2 = makeAddr("manager2");
    address internal delegator = makeAddr("delegator");
    address internal redeemer = makeAddr("redeemer");
    address internal vendor = makeAddr("vendor");
    address internal stranger = makeAddr("stranger");
    address internal approver;
    uint256 internal approverKey;
    address internal other;
    uint256 internal otherKey;

    bytes32 internal constant DHASH = keccak256("delegation");
    bytes32 internal constant NONCE = keccak256("nonce-1");
    bytes32 internal constant INVOICE = keccak256("invoice-1");

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
        vm.chainId(5042002);
        vm.warp(1_000_000);
        enforcer = new RobotPaymentPolicyEnforcer();
        (approver, approverKey) = makeAddrAndKey("approver");
        (other, otherKey) = makeAddrAndKey("other");
        address[] memory list = new address[](2);
        list[0] = makeAddr("listed0");
        list[1] = vendor;
        terms = abi.encode(CAP, list, approver);
    }

    ///////////////////////// helpers /////////////////////////

    function _exec(address payee, uint256 amount) internal pure returns (bytes memory) {
        return abi.encodePacked(USDC, uint256(0), abi.encodeWithSelector(0xa9059cbb, payee, amount));
    }

    function _approval(address payee, uint256 amount, uint64 expiry, bytes32 nonce)
        internal
        pure
        returns (RobotPaymentPolicyEnforcer.Approval memory)
    {
        return RobotPaymentPolicyEnforcer.Approval(INVOICE, payee, amount, expiry, nonce);
    }

    function _sign(RobotPaymentPolicyEnforcer.Approval memory a, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, enforcer.approvalDigest(a));
        return abi.encodePacked(r, s, v);
    }

    function _args(RobotPaymentPolicyEnforcer.Approval memory a, uint256 key) internal view returns (bytes memory) {
        return abi.encode(a, _sign(a, key));
    }

    function _hook(address caller, bytes memory args, bytes memory exec) internal {
        vm.prank(caller);
        enforcer.beforeHook(terms, args, ModeLib.encodeSimpleSingle(), exec, DHASH, delegator, redeemer);
    }

    function _hookMode(ModeCode mode) internal {
        vm.prank(manager);
        enforcer.beforeHook(terms, "", mode, _exec(vendor, 1), DHASH, delegator, redeemer);
    }

    ///////////////////////// within policy /////////////////////////

    function test_WithinPolicyPassesWithoutArgs() public {
        _hook(manager, "", _exec(vendor, CAP));
    }

    function test_WithinPolicyIgnoresArgsAndDoesNotConsumeNonce() public {
        RobotPaymentPolicyEnforcer.Approval memory a = _approval(vendor, 5e6, uint64(block.timestamp + 1), NONCE);
        vm.recordLogs();
        _hook(manager, _args(a, approverKey), _exec(vendor, 5e6));
        assertEq(vm.getRecordedLogs().length, 0);
        assertFalse(enforcer.usedNonces(manager, NONCE));
    }

    function test_WithinPolicyIgnoresGarbageArgs() public {
        _hook(manager, hex"deadbeef", _exec(vendor, 1));
    }

    function testFuzz_AllowlistedUnderCapAlwaysPasses(uint256 amount) public {
        amount = bound(amount, 0, CAP);
        _hook(manager, "", _exec(vendor, amount));
    }

    function testFuzz_AllowlistedUnderRandomCapPasses(uint256 cap, uint256 amount) public {
        amount = bound(amount, 0, cap);
        address[] memory list = new address[](1);
        list[0] = vendor;
        terms = abi.encode(cap, list, approver);
        _hook(manager, "", _exec(vendor, amount));
    }

    ///////////////////////// approval required /////////////////////////

    function test_RevertWhen_OverCapWithoutApproval() public {
        vm.expectRevert(bytes("RPP:approval-required"));
        _hook(manager, "", _exec(vendor, CAP + 1));
    }

    function test_RevertWhen_UnlistedPayeeWithoutApproval() public {
        vm.expectRevert(bytes("RPP:approval-required"));
        _hook(manager, "", _exec(stranger, 1e6));
    }

    ///////////////////////// approvals /////////////////////////

    function test_ValidApprovalOverCapPassesEmitsAndSetsNonce() public {
        uint256 amount = CAP + 50e6;
        RobotPaymentPolicyEnforcer.Approval memory a = _approval(vendor, amount, uint64(block.timestamp + 600), NONCE);
        bytes memory args = _args(a, approverKey);
        assertFalse(enforcer.usedNonces(manager, NONCE));

        vm.expectEmit(true, true, true, true, address(enforcer));
        emit PaymentApproved(manager, DHASH, NONCE, delegator, INVOICE, vendor, amount);
        _hook(manager, args, _exec(vendor, amount));

        assertTrue(enforcer.usedNonces(manager, NONCE));
    }

    function test_ValidApprovalForUnlistedPayeePasses() public {
        RobotPaymentPolicyEnforcer.Approval memory a = _approval(stranger, 1e6, uint64(block.timestamp + 600), NONCE);
        vm.expectEmit(true, true, true, true, address(enforcer));
        emit PaymentApproved(manager, DHASH, NONCE, delegator, INVOICE, stranger, 1e6);
        _hook(manager, _args(a, approverKey), _exec(stranger, 1e6));
        assertTrue(enforcer.usedNonces(manager, NONCE));
    }

    function test_RevertWhen_ApprovalPayeeMismatch() public {
        RobotPaymentPolicyEnforcer.Approval memory a = _approval(vendor, CAP + 1, uint64(block.timestamp + 600), NONCE);
        bytes memory args = _args(a, approverKey);
        vm.expectRevert(bytes("RPP:approval-payee-mismatch"));
        _hook(manager, args, _exec(stranger, CAP + 1));
    }

    function test_RevertWhen_ApprovalAmountMismatch() public {
        RobotPaymentPolicyEnforcer.Approval memory a = _approval(vendor, CAP + 1, uint64(block.timestamp + 600), NONCE);
        bytes memory args = _args(a, approverKey);
        vm.expectRevert(bytes("RPP:approval-amount-mismatch"));
        _hook(manager, args, _exec(vendor, CAP + 2));
    }

    function test_RevertWhen_ApprovalExpired() public {
        RobotPaymentPolicyEnforcer.Approval memory a = _approval(vendor, CAP + 1, uint64(block.timestamp - 1), NONCE);
        bytes memory args = _args(a, approverKey);
        vm.expectRevert(bytes("RPP:approval-expired"));
        _hook(manager, args, _exec(vendor, CAP + 1));
    }

    function test_ApprovalAtExactExpiryPasses() public {
        RobotPaymentPolicyEnforcer.Approval memory a = _approval(vendor, CAP + 1, uint64(block.timestamp), NONCE);
        _hook(manager, _args(a, approverKey), _exec(vendor, CAP + 1));
        assertTrue(enforcer.usedNonces(manager, NONCE));
    }

    function test_RevertWhen_ApprovalNonceReused() public {
        RobotPaymentPolicyEnforcer.Approval memory a = _approval(vendor, CAP + 1, uint64(block.timestamp + 600), NONCE);
        bytes memory args = _args(a, approverKey);
        _hook(manager, args, _exec(vendor, CAP + 1));
        vm.expectRevert(bytes("RPP:approval-nonce-used"));
        _hook(manager, args, _exec(vendor, CAP + 1));
    }

    function test_NonceIsPerManager() public {
        RobotPaymentPolicyEnforcer.Approval memory a = _approval(vendor, CAP + 1, uint64(block.timestamp + 600), NONCE);
        bytes memory args = _args(a, approverKey);
        _hook(manager, args, _exec(vendor, CAP + 1));
        _hook(manager2, args, _exec(vendor, CAP + 1));
        assertTrue(enforcer.usedNonces(manager, NONCE));
        assertTrue(enforcer.usedNonces(manager2, NONCE));
    }

    function test_RevertWhen_WrongSigner() public {
        RobotPaymentPolicyEnforcer.Approval memory a = _approval(vendor, CAP + 1, uint64(block.timestamp + 600), NONCE);
        bytes memory args = _args(a, otherKey);
        vm.expectRevert(bytes("RPP:invalid-approval-signature"));
        _hook(manager, args, _exec(vendor, CAP + 1));
        assertFalse(enforcer.usedNonces(manager, NONCE));
    }

    function test_RevertWhen_SignatureTampered() public {
        // approver signed a different invoice/nonce than the one presented
        RobotPaymentPolicyEnforcer.Approval memory signed = _approval(vendor, CAP + 1, uint64(block.timestamp + 600), NONCE);
        RobotPaymentPolicyEnforcer.Approval memory presented = _approval(vendor, CAP + 1, uint64(block.timestamp + 600), keccak256("other-nonce"));
        bytes memory args = abi.encode(presented, _sign(signed, approverKey));
        vm.expectRevert(bytes("RPP:invalid-approval-signature"));
        _hook(manager, args, _exec(vendor, CAP + 1));
    }

    function test_RevertWhen_SignatureTooShort() public {
        RobotPaymentPolicyEnforcer.Approval memory a = _approval(vendor, CAP + 1, uint64(block.timestamp + 600), NONCE);
        bytes memory sig = _sign(a, approverKey);
        bytes memory shortSig = new bytes(64);
        for (uint256 i = 0; i < 64; i++) shortSig[i] = sig[i];
        vm.expectRevert(bytes("RPP:invalid-approval-signature"));
        _hook(manager, abi.encode(a, shortSig), _exec(vendor, CAP + 1));
    }

    function test_RevertWhen_SignatureEmpty() public {
        RobotPaymentPolicyEnforcer.Approval memory a = _approval(vendor, CAP + 1, uint64(block.timestamp + 600), NONCE);
        vm.expectRevert(bytes("RPP:invalid-approval-signature"));
        _hook(manager, abi.encode(a, bytes("")), _exec(vendor, CAP + 1));
    }

    function test_RevertWhen_SignatureTooLong() public {
        RobotPaymentPolicyEnforcer.Approval memory a = _approval(vendor, CAP + 1, uint64(block.timestamp + 600), NONCE);
        bytes memory longSig = bytes.concat(_sign(a, approverKey), hex"00");
        vm.expectRevert(bytes("RPP:invalid-approval-signature"));
        _hook(manager, abi.encode(a, longSig), _exec(vendor, CAP + 1));
    }

    ///////////////////////// execution decoding /////////////////////////

    function test_RevertWhen_WrongSelector() public {
        bytes memory exec = abi.encodePacked(USDC, uint256(0), abi.encodeWithSelector(0x23b872dd, vendor, uint256(1)));
        vm.expectRevert(bytes("RPP:invalid-method"));
        _hook(manager, "", exec);
    }

    function test_RevertWhen_WrongTarget() public {
        bytes memory exec =
            abi.encodePacked(stranger, uint256(0), abi.encodeWithSelector(0xa9059cbb, vendor, uint256(1)));
        vm.expectRevert(bytes("RPP:invalid-target"));
        _hook(manager, "", exec);
    }

    function test_RevertWhen_NonzeroValue() public {
        bytes memory exec = abi.encodePacked(USDC, uint256(1), abi.encodeWithSelector(0xa9059cbb, vendor, uint256(1)));
        vm.expectRevert(bytes("RPP:invalid-value"));
        _hook(manager, "", exec);
    }

    function test_RevertWhen_ExecutionTooLong() public {
        bytes memory exec = bytes.concat(_exec(vendor, 1), hex"00");
        vm.expectRevert(bytes("RPP:invalid-execution-length"));
        _hook(manager, "", exec);
    }

    function test_RevertWhen_ExecutionTooShort() public {
        vm.expectRevert(bytes("RPP:invalid-execution-length"));
        _hook(manager, "", abi.encodePacked(USDC, uint256(0)));
    }

    function test_RevertWhen_PayeeHasDirtyUpperBits() public {
        bytes32 dirty = bytes32(uint256(uint160(vendor)) | (uint256(1) << 160));
        bytes memory exec = abi.encodePacked(USDC, uint256(0), bytes4(0xa9059cbb), dirty, uint256(1));
        assertEq(exec.length, 120);
        vm.expectRevert(bytes("RPP:invalid-payee"));
        _hook(manager, "", exec);
    }

    ///////////////////////// modes /////////////////////////

    function test_RevertWhen_BatchCallType() public {
        vm.expectRevert(bytes("CaveatEnforcer:invalid-call-type"));
        _hookMode(ModeLib.encodeSimpleBatch());
    }

    function test_RevertWhen_TryExecType() public {
        // call type 0x00 (single), exec type 0x01 (try)
        ModeCode tryMode = ModeCode.wrap(bytes32(bytes2(0x0001)));
        vm.expectRevert(bytes("CaveatEnforcer:invalid-execution-type"));
        _hookMode(tryMode);
    }

    ///////////////////////// views /////////////////////////

    function test_UsdcConstant() public view {
        assertEq(enforcer.USDC(), USDC);
    }

    function test_DomainSeparatorMatchesEip712() public view {
        bytes32 typeHash = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        bytes32 expected = keccak256(
            abi.encode(typeHash, keccak256("VitaquackApproval"), keccak256("1"), block.chainid, address(enforcer))
        );
        assertEq(enforcer.domainSeparator(), expected);
    }

    function test_DomainSeparatorTracksChainId() public {
        bytes32 before_ = enforcer.domainSeparator();
        vm.chainId(1234);
        assertTrue(enforcer.domainSeparator() != before_);
    }

    function test_ApprovalDigestMatchesEip712() public view {
        RobotPaymentPolicyEnforcer.Approval memory a = _approval(vendor, 123e6, 4242, NONCE);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Approval(bytes32 invoiceHash,address payee,uint256 amount,uint64 expiry,bytes32 nonce)"),
                a.invoiceHash,
                a.payee,
                a.amount,
                a.expiry,
                a.nonce
            )
        );
        bytes32 typeHash = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        bytes32 sep = keccak256(
            abi.encode(typeHash, keccak256("VitaquackApproval"), keccak256("1"), block.chainid, address(enforcer))
        );
        assertEq(enforcer.approvalDigest(a), keccak256(abi.encodePacked("\x19\x01", sep, structHash)));
    }

    function test_GetTermsInfoRoundTrips() public {
        (uint256 cap, address[] memory list, address app) = enforcer.getTermsInfo(terms);
        assertEq(cap, CAP);
        assertEq(list.length, 2);
        assertEq(list[0], makeAddr("listed0"));
        assertEq(list[1], vendor);
        assertEq(app, approver);
    }
}
