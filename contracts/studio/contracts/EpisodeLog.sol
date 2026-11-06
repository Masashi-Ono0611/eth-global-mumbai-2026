// SPDX-License-Identifier: MIT
pragma solidity =0.8.23;

// src/EpisodeLog.sol

/**
 * @title EpisodeLog
 * @notice The on-chain anchor of a Vitaquack errand's evidence on 0G: the 0G Storage root hash of the episode JSON and
 * `keccak256(utf8(requestIds.join(",")))` over the 0G request ids of its decisions (`requestIdsHash` in
 * packages/protocol/src/Errand.ts).
 *
 * @dev One record per episode, keyed by `keccak256(bytes(episodeId))`; a second record for the same episode reverts
 * with `AlreadyRecorded`. Anyone may record: the stored `recorder` (the evidence uploader's address) is the evidence of
 * who wrote it. The root hash is the 0G Storage locator; no URI is stored.
 */
contract EpisodeLog {
    struct Record {
        bytes32 rootHash;
        bytes32 requestIdsHash;
        address recorder;
        uint64 recordedAt;
    }

    /// @notice Records by episode key (`episodeKey(episodeId)`).
    mapping(bytes32 episodeKey => Record) public records;

    /// @notice An episode's evidence was anchored.
    event EpisodeRecorded(
        address indexed recorder,
        bytes32 indexed episodeKey,
        string episodeId,
        bytes32 rootHash,
        bytes32 requestIdsHash,
        uint64 recordedAt
    );

    /// @notice The episode already has a record; records are write-once.
    error AlreadyRecorded(bytes32 episodeKey);

    /// @notice A record needs the 0G Storage root hash.
    error ZeroRootHash();

    /// @notice Anchors an episode's 0G Storage root hash and request-ids hash, with the caller as recorder.
    function record(string calldata episodeId, bytes32 rootHash, bytes32 requestIdsHash) external {
        if (rootHash == bytes32(0)) revert ZeroRootHash();
        bytes32 key = keccak256(bytes(episodeId));
        if (records[key].rootHash != bytes32(0)) revert AlreadyRecorded(key);

        // forge-lint: disable-next-line(unsafe-typecast) -- unix seconds fit in 64 bits for billions of years
        uint64 recordedAt = uint64(block.timestamp);
        records[key] = Record({
            rootHash: rootHash, requestIdsHash: requestIdsHash, recorder: msg.sender, recordedAt: recordedAt
        });
        emit EpisodeRecorded(msg.sender, key, episodeId, rootHash, requestIdsHash, recordedAt);
    }

    /// @notice The record key of an episode id: `keccak256(bytes(episodeId))`.
    function episodeKey(string calldata episodeId) external pure returns (bytes32) {
        return keccak256(bytes(episodeId));
    }
}

