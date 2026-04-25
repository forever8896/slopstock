// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Fractionalizer
/// @notice Locks an iNFT and mints 1M fractional ERC-20 shares.
/// @dev Stub. Spec: docs/02-smart-contracts.md §5.
contract Fractionalizer {
    struct Vault {
        address shareToken;
        address creator;
        bool active;
    }

    mapping(uint256 => Vault) public vaults;

    event Fractionalized(uint256 indexed tokenId, address shareToken, address creator);
    event Redeemed(uint256 indexed tokenId, address by);

    // TODO: fractionalize(tokenId, name, symbol, recipient) → deploys ShareToken, transfers iNFT here.
    // TODO: redeem(tokenId) → burns 100% of shares to release iNFT.
    // TODO: onERC721Received hook so the iNFT can be transferred in.
}
