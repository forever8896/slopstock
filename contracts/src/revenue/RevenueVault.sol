// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RevenueVault
/// @notice Holds USDC paid by subscribers; weekly snapshots + pro-rata distribution.
/// @dev Stub. Lives on Base (where x402 settles). Spec: docs/02-smart-contracts.md §7
///      and docs/04-revenue-and-payments.md §6.
contract RevenueVault {
    struct Snapshot {
        uint256 sharesSnapshotId;
        uint256 balanceAtSnapshot;
        uint64 ts;
        bool distributed;
    }

    Snapshot[] public snapshots;
    mapping(address => mapping(uint256 => bool)) public claimedAt;

    event Received(uint256 amount, address indexed from);
    event Snapped(uint256 indexed snapshotId, uint256 balance);
    event Distributed(uint256 indexed snapshotId, address indexed holder, uint256 amount);

    // TODO: fund(amount) — explicit pay-in via SafeERC20.
    // TODO: snap() — permissionless; KeeperHub calls weekly. Captures shareToken.snapshot() id.
    // TODO: claim(snapshotIdx) — pull-pattern, gas-cheap path.
    // TODO: distributeTo(snapshotIdx, holder) — push-pattern, idempotent, called by KeeperHub.
}
