// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { Test } from "forge-std/Test.sol";
import { ModeLib, RobotPaymentPolicyEnforcer } from "../studio/contracts/RobotPaymentPolicyEnforcer.sol";

/// @dev Byte-for-byte parity with the app's TypeScript encoders. test/fixtures/golden.json comes from
/// test/fixtures/golden.ts, which calls `policyTerms`, `approvalArgs`, `singleExecution` and `transferCall`
/// (packages/chain/src/Grant.ts), `approvalDigest` and `approvalNonce` (packages/protocol/src/Approval.ts) and signs with
/// `makeApprover` (packages/chain/src/Approver.ts). The enforcer runs at the fixture's address, as the digest binds it.
contract GoldenTest is Test {
    address internal constant USDC = 0x3600000000000000000000000000000000000000;

    string internal json;
    RobotPaymentPolicyEnforcer internal enforcer;
    address internal delegationManager;

    function setUp() public {
        json = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/golden.json"));
        vm.chainId(vm.parseJsonUint(json, ".chainId"));
        address at_ = vm.parseJsonAddress(json, ".enforcer");
        vm.etch(at_, address(new RobotPaymentPolicyEnforcer()).code);
        enforcer = RobotPaymentPolicyEnforcer(at_);
        delegationManager = makeAddr("DelegationManager");
    }

    function _approval() internal view returns (RobotPaymentPolicyEnforcer.Approval memory) {
        return RobotPaymentPolicyEnforcer.Approval({
            invoiceHash: vm.parseJsonBytes32(json, ".approval.invoiceHash"),
            payee: vm.parseJsonAddress(json, ".approval.payee"),
            amount: vm.parseJsonUint(json, ".approval.amount"),
            expiry: uint64(vm.parseJsonUint(json, ".approval.expiry")),
            nonce: vm.parseJsonBytes32(json, ".approval.nonce")
        });
    }

    function test_approvalDigest_equalsProtocolApprovalDigest() public view {
        assertEq(enforcer.approvalDigest(_approval()), vm.parseJsonBytes32(json, ".approvalDigest"));
    }

    /// @dev protocol's `approvalNonce` is the digest of the same approval with the invoice hash as its nonce.
    function test_approvalNonce_isTheDigestWithInvoiceHashAsNonce() public view {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval();
        a_.nonce = a_.invoiceHash;
        assertEq(enforcer.approvalDigest(a_), vm.parseJsonBytes32(json, ".approval.nonce"));
    }

    function test_policyTerms_equalGrantPolicyTerms() public view {
        bytes memory fixtureTerms_ = vm.parseJsonBytes(json, ".policyTerms");
        uint256 cap_ = vm.parseJsonUint(json, ".policy.perPaymentCap");
        address[] memory allowlist_ = vm.parseJsonAddressArray(json, ".policy.allowlist");
        address approver_ = vm.parseJsonAddress(json, ".policy.approver");
        assertEq(abi.encode(cap_, allowlist_, approver_), fixtureTerms_);

        (uint256 decodedCap_, address[] memory decodedAllowlist_, address decodedApprover_) =
            enforcer.getTermsInfo(fixtureTerms_);
        assertEq(decodedCap_, cap_);
        assertEq(decodedAllowlist_, allowlist_);
        assertEq(decodedApprover_, approver_);
    }

    function test_approvalArgs_equalGrantApprovalArgs() public view {
        bytes memory fixtureArgs_ = vm.parseJsonBytes(json, ".approvalArgs");
        bytes memory signature_ = vm.parseJsonBytes(json, ".signature");
        assertEq(abi.encode(_approval(), signature_), fixtureArgs_);

        (RobotPaymentPolicyEnforcer.Approval memory decoded_, bytes memory decodedSignature_) =
            abi.decode(fixtureArgs_, (RobotPaymentPolicyEnforcer.Approval, bytes));
        assertEq(abi.encode(decoded_), abi.encode(_approval()));
        assertEq(decodedSignature_, signature_);
    }

    function test_executions_equalGrantSingleExecution() public view {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval();
        assertEq(
            abi.encodePacked(USDC, uint256(0), abi.encodeWithSelector(bytes4(0xa9059cbb), a_.payee, a_.amount)),
            vm.parseJsonBytes(json, ".approvedExecution")
        );
    }

    /// @dev viem and forge both sign with RFC 6979, so the app's approver and forge's agree on the exact signature.
    function test_approverSignature_equalsForgeSignature() public {
        (address approver_, uint256 key_) = makeAddrAndKey(vm.parseJsonString(json, ".approverLabel"));
        assertEq(approver_, vm.parseJsonAddress(json, ".approver"));
        (uint8 v_, bytes32 r_, bytes32 s_) = vm.sign(key_, vm.parseJsonBytes32(json, ".approvalDigest"));
        assertEq(abi.encodePacked(r_, s_, v_), vm.parseJsonBytes(json, ".signature"));
    }

    function test_beforeHook_acceptsTheAppsApprovedPayment() public {
        RobotPaymentPolicyEnforcer.Approval memory a_ = _approval();
        bytes memory terms_ = vm.parseJsonBytes(json, ".policyTerms");
        bytes memory args_ = vm.parseJsonBytes(json, ".approvalArgs");
        bytes memory execution_ = vm.parseJsonBytes(json, ".approvedExecution");
        vm.warp(uint256(a_.expiry) - 60);

        vm.expectEmit(true, true, true, true, address(enforcer));
        emit RobotPaymentPolicyEnforcer.PaymentApproved(
            delegationManager, keccak256("grant"), a_.nonce, address(this), a_.invoiceHash, a_.payee, a_.amount
        );
        vm.prank(delegationManager);
        enforcer.beforeHook(
            terms_, args_, ModeLib.encodeSimpleSingle(), execution_, keccak256("grant"), address(this), address(1)
        );
        assertTrue(enforcer.usedNonces(delegationManager, a_.nonce));

        vm.expectRevert(bytes("RPP:approval-nonce-used"));
        vm.prank(delegationManager);
        enforcer.beforeHook(
            terms_, args_, ModeLib.encodeSimpleSingle(), execution_, keccak256("grant"), address(this), address(1)
        );
    }

    function test_beforeHook_acceptsTheAppsInPolicyPaymentAndRefusesTheApprovedOneWithoutArgs() public {
        bytes memory terms_ = vm.parseJsonBytes(json, ".policyTerms");
        vm.prank(delegationManager);
        enforcer.beforeHook(
            terms_,
            "",
            ModeLib.encodeSimpleSingle(),
            vm.parseJsonBytes(json, ".inPolicyExecution"),
            keccak256("grant"),
            address(this),
            address(1)
        );

        bytes memory execution_ = vm.parseJsonBytes(json, ".approvedExecution");
        vm.expectRevert(bytes("RPP:approval-required"));
        vm.prank(delegationManager);
        enforcer.beforeHook(
            terms_, "", ModeLib.encodeSimpleSingle(), execution_, keccak256("grant"), address(this), address(1)
        );
    }
}
