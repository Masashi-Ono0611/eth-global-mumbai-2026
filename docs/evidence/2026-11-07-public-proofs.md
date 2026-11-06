# Uploader freeze and fix, then public proofs on 0G (6 Nov evening to 7 Nov 02:30 IST)

## The freeze, 6 Nov 23:46 IST

The uploader, then running by hand in tmux, sent a frame's 0G Storage submission,
[0x8a2101dc…9564](https://chainscan-galileo.0g.ai/tx/0x8a2101dc47b3ecf26ac8ed2be451108ca81a054df5715ba9933604db17359564).
It reverted in the block of 6 Nov 19:16:22 CET (23:46 IST): receipt status 0, gasUsed `0x4c31d` of a `0x4d44d` limit,
most likely out of gas. The storage SDK kept waiting for that submission and printed "Waiting for storage node to sync"
about 6,000 times. Nothing reached 0G for about 2 h 40 min. The uploader wallet still held 2.4 0G.

## The fix (f098bc9), started 6 Nov 21:57:43 CET (7 Nov 02:27 IST)

The uploader is now the systemd service `vitaquack-evidence-uploader` (`Restart=always`). One upload that takes longer
than 4 minutes exits with code 3, and systemd starts a fresh process. The Worker hands an unfinished claim out again
after 5 minutes. The first pass uploaded the two pending episodes and their frames, then logged `no pending evidence`:

| Upload | 0G Storage root | Storage tx | `EpisodeLog.record` tx |
| --- | --- | --- | --- |
| frame `t4vbyvactcyyoecd7fldu2hmci` / `0xde2c3fbd3d85f1aa35905d585aca12ee704ddf06a1c04463b44df3a9786f9712` | `0x5be299ace909e325239b2e09cf4023314f9ec7970d5a83fb05a3d653dfe8bf86` (the root the frozen run had prepared) | [`0x0f2dbf56…128f`](https://chainscan-galileo.0g.ai/tx/0x0f2dbf567a32f4638dc75e6bf28c3d051e9f4d1cedf50e66073aff9c64cb128f) | |
| episode `t4vbyvactcyyoecd7fldu2hmci` | `0x74fabcbdf72263846961dc50a3f0f04f022775ab934e2a112d7ba39a1a3d76e6` | [`0xf2efc006…919e`](https://chainscan-galileo.0g.ai/tx/0xf2efc0069de4e7f986cbfe93b17c5639bdb1adce4d56230a1cc632523d5d919e) | [`0x83e66491…449b`](https://chainscan-galileo.0g.ai/tx/0x83e664918d6a718e6bde53519c72b366da1aea71bbc39b1ae5c99b036f0a449b) |
| frame `nsgqpnlr2titi22icgmgntb5vi` / `0x87ab3b175456fb6fbf527dfc4287caef712173bd6280e9134e7b51dc66176b69` | `0x9c83141ba4358a1a12b7a074fd68c7c76ec45c82f304867d62e36d1ff05bf2d9` | [`0x53a211cd…e969`](https://chainscan-galileo.0g.ai/tx/0x53a211cdbdfccc8efcd754836e2fe5b1cdcae31692305f465bd0b91fd7c3e969) | |
| episode `nsgqpnlr2titi22icgmgntb5vi` | `0x71c0b3fd45ba45b5ee9247f222ecb4fa5964f67dcbb32a86cf75e92b611fd6fe` | [`0x9b10cd63…33ee`](https://chainscan-galileo.0g.ai/tx/0x9b10cd63618c65ceee41ef3bfce29a2f69412c631649bb98da1c7cac77dc33ee) | [`0xea5d545a…e527`](https://chainscan-galileo.0g.ai/tx/0xea5d545a9e3ba3ee6bee256d31a6362850fa3fdf39b051808d505d16013be527) |

## Public proofs (0ae138a, deployed)

`GET https://vitaquack.com/api/health` answered release `0ae138a6326bbe2e2f55e4d67f6550f7e40f7b85`.
`GET https://vitaquack.com/api/proofs` listed 48 errands with the anchors `{chainId 16602, episodeLog
0x4C947E6D794C78d0F684e46EFC97f712E51a206A, rpcUrl https://evmrpc-testnet.0g.ai, indexerUrl
https://indexer-storage-testnet-turbo.0g.ai}`. An unknown id answered 404.

A signed-out headless Chromium (Playwright, 390 px wide) opened `/app/proofs` (48 rows,
`screens/2026-11-07-proofs-list.png`) and `/app/proofs/nsgqpnlr2titi22icgmgntb5vi` ("Proof: Chai", with the frame
loaded from 0G Storage). It pressed "Verify against 0G" and the page answered "Every check passed." with all five
checks yes (`screens/2026-11-07-proof-verified.png`):

1. EpisodeLog has a record.
2. The record's root is the root the file was downloaded by.
3. The request-ids hash matches.
4. The file is this errand's.
5. The frame's SHA-256 matches what the chip signed.

The record was made 6 Nov 20:58:46 UTC (7 Nov 02:28:46 IST) by `0xc6ff8a666f4c7f674c1d129c73b46d61f2891fcd`. The
browser's only 0G requests were `GET indexer-storage-testnet-turbo.0g.ai/file` and `POST evmrpc-testnet.0g.ai/`, and
the page logged no errors.

## Live chain check by hand: `jg2wabvwez4mxe22ecnfjvigbq`

The calldata selector is `0x01e64725`, which equals viem's `toFunctionSelector('records(bytes32)')`.
`EpisodeLog.records` returned root `0x11040dfc6bcf714618f8ade9c774ee1558c36e37d8dbb7fc99cc0c3118838c6c`, requestIdsHash
`0x2067f1b9e31d63975063b086dc1a00ed143f48b5dcf163c5e87a720c6077606d`, recorder `0xc6ff8a66…` and recordedAt
1793979208. The episode JSON downloaded from the indexer by that root (4,023 bytes) decoded as `EpisodeEvidence` and
passed all four anchor checks. The same record is the fixture of `packages/protocol/test/Proof.test.ts`.
