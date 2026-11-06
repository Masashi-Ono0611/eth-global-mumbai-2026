// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { Test } from "forge-std/Test.sol";

import { EpisodeLog } from "../src/EpisodeLog.sol";

contract EpisodeLogTest is Test {
    string internal constant EPISODE_ID = "aaaqeayeaudaocajbifqydiob4";
    bytes32 internal constant ROOT_HASH = keccak256("0g-storage-root");
    uint256 internal constant NOW = 1_794_000_000;

    EpisodeLog internal episodeLog;
    address internal uploader;
    bytes32 internal requestIdsHash;

    event EpisodeRecorded(
        address indexed recorder,
        bytes32 indexed episodeKey,
        string episodeId,
        bytes32 rootHash,
        bytes32 requestIdsHash,
        uint64 recordedAt
    );

    function setUp() public {
        vm.warp(NOW);
        episodeLog = new EpisodeLog();
        uploader = makeAddr("evidence-uploader");
        // protocol's requestIdsHash: keccak256(utf8(requestIds.join(","))).
        requestIdsHash = keccak256(bytes("req-1,req-2"));
    }

    function test_record_storesTheRecordAndEmits() public {
        bytes32 key_ = keccak256(bytes(EPISODE_ID));
        vm.expectEmit(true, true, true, true, address(episodeLog));
        emit EpisodeRecorded(uploader, key_, EPISODE_ID, ROOT_HASH, requestIdsHash, uint64(NOW));
        vm.prank(uploader);
        episodeLog.record(EPISODE_ID, ROOT_HASH, requestIdsHash);

        (bytes32 rootHash_, bytes32 requestIdsHash_, address recorder_, uint64 recordedAt_) = episodeLog.records(key_);
        assertEq(rootHash_, ROOT_HASH);
        assertEq(requestIdsHash_, requestIdsHash);
        assertEq(recorder_, uploader);
        assertEq(recordedAt_, uint64(NOW));
    }

    function test_episodeKey_isKeccakOfTheId() public view {
        assertEq(episodeLog.episodeKey(EPISODE_ID), keccak256(bytes(EPISODE_ID)));
    }

    function test_duplicate_reverts() public {
        vm.prank(uploader);
        episodeLog.record(EPISODE_ID, ROOT_HASH, requestIdsHash);

        bytes32 key_ = keccak256(bytes(EPISODE_ID));
        // The same values again, and other values from another recorder: both refused.
        vm.expectRevert(abi.encodeWithSelector(EpisodeLog.AlreadyRecorded.selector, key_));
        vm.prank(uploader);
        episodeLog.record(EPISODE_ID, ROOT_HASH, requestIdsHash);

        vm.expectRevert(abi.encodeWithSelector(EpisodeLog.AlreadyRecorded.selector, key_));
        vm.prank(makeAddr("someone-else"));
        episodeLog.record(EPISODE_ID, keccak256("other-root"), bytes32(0));

        (bytes32 rootHash_,, address recorder_,) = episodeLog.records(key_);
        assertEq(rootHash_, ROOT_HASH);
        assertEq(recorder_, uploader);
    }

    function test_zeroRootHash_reverts() public {
        vm.expectRevert(EpisodeLog.ZeroRootHash.selector);
        vm.prank(uploader);
        episodeLog.record(EPISODE_ID, bytes32(0), requestIdsHash);
    }

    function test_unrecordedEpisode_readsEmpty() public view {
        (bytes32 rootHash_, bytes32 requestIdsHash_, address recorder_, uint64 recordedAt_) =
            episodeLog.records(episodeLog.episodeKey("never-recorded"));
        assertEq(rootHash_, bytes32(0));
        assertEq(requestIdsHash_, bytes32(0));
        assertEq(recorder_, address(0));
        assertEq(recordedAt_, 0);
    }

    function testFuzz_record_roundTrips(
        string calldata _episodeId,
        bytes32 _rootHash,
        bytes32 _requestIdsHash,
        address _recorder
    ) public {
        vm.assume(_rootHash != bytes32(0) && _recorder != address(0));
        vm.prank(_recorder);
        episodeLog.record(_episodeId, _rootHash, _requestIdsHash);
        (bytes32 rootHash_, bytes32 requestIdsHash_, address recorder_, uint64 recordedAt_) =
            episodeLog.records(episodeLog.episodeKey(_episodeId));
        assertEq(rootHash_, _rootHash);
        assertEq(requestIdsHash_, _requestIdsHash);
        assertEq(recorder_, _recorder);
        assertEq(recordedAt_, uint64(NOW));
    }
}
