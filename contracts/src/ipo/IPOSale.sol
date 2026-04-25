// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPOSale
/// @notice Fixed-price sale of an agent's seed share allocation.
/// @dev Stub. v1 ships fixed-price; bonding curve is a stretch. Spec: docs/02-smart-contracts.md §6.
contract IPOSale {
    uint256 public sold;

    event Bought(address indexed buyer, uint256 amount, uint256 cost);

    // TODO: constructor(shareToken, paymentAsset, pricePerShare, maxShares, beneficiary, startsAt, endsAt).
    // TODO: buy(amount) — pulls payment, transfers shares from beneficiary (pre-approved).
}
