// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Marketplace
/// @notice Whole-iNFT bid/accept flow — the headline acquisition primitive.
/// @dev Stub. On `accept`, calls iNFT.iTransfer with a re-encryption proof so the
///      previous owner is cryptographically locked out. Spec: docs/02-smart-contracts.md §8.
contract Marketplace {
    struct Bid {
        address bidder;
        uint256 price;
        bytes bidderPubkey;
        uint64 expiresAt;
    }

    mapping(uint256 => Bid) public bestBid;

    event BidPosted(uint256 indexed tokenId, address indexed bidder, uint256 price);
    event Acquired(uint256 indexed tokenId, address indexed acquirer);

    // TODO: postBid(tokenId, price, bidderPubkey, expiresAt) — escrows payment; refunds prior best.
    // TODO: accept(tokenId, transferValidityProof) — only owner; calls iTransfer; releases escrow.
    // TODO: cancelExpired(tokenId).
}
