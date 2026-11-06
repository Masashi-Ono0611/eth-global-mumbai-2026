// SPDX-License-Identifier: MIT
pragma solidity =0.8.23;

import {Test} from "forge-std/Test.sol";
import {EpisodeLog} from "../EpisodeLog.sol";

contract EpisodeLogTest is Test {
    EpisodeLog internal episodeLog;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    bytes32 internal constant ROOT = keccak256("root");
    bytes32 internal constant REQS = keccak256("req-1,req-2");

    event EpisodeRecorded(
        address indexed recorder,
        bytes32 indexed episodeKey,
        string episodeId,
        bytes32 rootHash,
        bytes32 requestIdsHash,
        uint64 recordedAt
    );

    function setUp() public {
        vm.warp(1_700_000_000);
        episodeLog = new EpisodeLog();
    }

    function test_EpisodeKeyIsKeccakOfId() public view {
        assertEq(episodeLog.episodeKey("ep-1"), keccak256(bytes("ep-1")));
        assertEq(episodeLog.episodeKey(""), keccak256(""));
    }

    function test_RecordStoresAndEmits() public {
        bytes32 key = keccak256(bytes("ep-1"));
        vm.expectEmit(true, true, false, true, address(episodeLog));
        emit EpisodeRecorded(alice, key, "ep-1", ROOT, REQS, uint64(block.timestamp));
        vm.prank(alice);
        episodeLog.record("ep-1", ROOT, REQS);

        (bytes32 root, bytes32 reqs, address recorder, uint64 at) = episodeLog.records(key);
        assertEq(root, ROOT);
        assertEq(reqs, REQS);
        assertEq(recorder, alice);
        assertEq(at, uint64(block.timestamp));
    }

    function test_UnrecordedEpisodeIsEmpty() public view {
        (bytes32 root, bytes32 reqs, address recorder, uint64 at) = episodeLog.records(keccak256("none"));
        assertEq(root, bytes32(0));
        assertEq(reqs, bytes32(0));
        assertEq(recorder, address(0));
        assertEq(at, 0);
    }

    function test_ZeroRequestIdsHashAllowed() public {
        vm.prank(alice);
        episodeLog.record("ep-z", ROOT, bytes32(0));
        (bytes32 root, bytes32 reqs,,) = episodeLog.records(episodeLog.episodeKey("ep-z"));
        assertEq(root, ROOT);
        assertEq(reqs, bytes32(0));
    }

    function test_RevertWhen_DuplicateEpisode() public {
        vm.prank(alice);
        episodeLog.record("ep-1", ROOT, REQS);
        vm.expectRevert(abi.encodeWithSelector(EpisodeLog.AlreadyRecorded.selector, keccak256(bytes("ep-1"))));
        vm.prank(bob);
        episodeLog.record("ep-1", keccak256("other"), REQS);
        // original record untouched
        (bytes32 root,, address recorder,) = episodeLog.records(keccak256(bytes("ep-1")));
        assertEq(root, ROOT);
        assertEq(recorder, alice);
    }

    function test_RevertWhen_ZeroRootHash() public {
        vm.expectRevert(EpisodeLog.ZeroRootHash.selector);
        episodeLog.record("ep-1", bytes32(0), REQS);
    }

    function test_ZeroRootCheckPrecedesDuplicateCheck() public {
        episodeLog.record("ep-1", ROOT, REQS);
        vm.expectRevert(EpisodeLog.ZeroRootHash.selector);
        episodeLog.record("ep-1", bytes32(0), REQS);
    }

    function test_DifferentEpisodesByDifferentRecordersCoexist() public {
        vm.prank(alice);
        episodeLog.record("ep-a", ROOT, REQS);
        vm.warp(block.timestamp + 100);
        vm.prank(bob);
        episodeLog.record("ep-b", keccak256("root-b"), keccak256("reqs-b"));

        (bytes32 rootA,, address recA, uint64 atA) = episodeLog.records(episodeLog.episodeKey("ep-a"));
        (bytes32 rootB, bytes32 reqsB, address recB, uint64 atB) = episodeLog.records(episodeLog.episodeKey("ep-b"));
        assertEq(rootA, ROOT);
        assertEq(recA, alice);
        assertEq(rootB, keccak256("root-b"));
        assertEq(reqsB, keccak256("reqs-b"));
        assertEq(recB, bob);
        assertEq(atB, atA + 100);
    }

    function testFuzz_RecordRoundTrip(
        string calldata id,
        bytes32 root,
        bytes32 reqs,
        address recorder,
        uint64 ts
    ) public {
        vm.assume(root != bytes32(0));
        vm.assume(recorder != address(0));
        vm.warp(ts);
        bytes32 key = keccak256(bytes(id));
        assertEq(episodeLog.episodeKey(id), key);

        vm.expectEmit(true, true, false, true, address(episodeLog));
        emit EpisodeRecorded(recorder, key, id, root, reqs, ts);
        vm.prank(recorder);
        episodeLog.record(id, root, reqs);

        (bytes32 r, bytes32 q, address rec, uint64 at) = episodeLog.records(key);
        assertEq(r, root);
        assertEq(q, reqs);
        assertEq(rec, recorder);
        assertEq(at, ts);

        vm.expectRevert(abi.encodeWithSelector(EpisodeLog.AlreadyRecorded.selector, key));
        episodeLog.record(id, root, reqs);
    }
}
