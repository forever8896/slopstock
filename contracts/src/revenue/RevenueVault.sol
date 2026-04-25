// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ShareToken } from "../shares/ShareToken.sol";

/// @title RevenueVault
/// @notice Holds USDC paid by subscribers and distributes pro-rata to shareholders.
///         Lives on Base (where x402 settles); the ShareToken is on the same chain.
/// @dev Snapshot model:
///        - `snap()` records the vault's USDC balance plus a *past* block.number as
///          the timepoint at which holder shares are read.
///        - Storing `block.number - 1` (rather than `block.number`) guarantees the
///          ERC20Votes lookup is always strictly in the past — `getPastVotes` reverts
///          for the current block.
///        - `claim` (pull) and `distributeTo` (push) settle the same way; both are
///          idempotent via `claimedAt`.
///      Rounding: integer division. Sub-wei dust stays in the vault and rolls into
///      the next snapshot.
contract RevenueVault {
    using SafeERC20 for IERC20;

    IERC20 public immutable paymentAsset;
    ShareToken public immutable shareToken;
    uint256 public immutable agentTokenId;

    struct Snapshot {
        uint256 timepoint; // ERC20Votes timepoint (block number) for getPastVotes
        uint256 balanceAtSnapshot; // payment-asset balance at snap()
        uint64 ts; // wall-clock timestamp at snap()
    }

    Snapshot[] private _snapshots;

    /// @dev snapshotId → holder → settled. Marked even when the holder's pro-rata
    ///      amount is zero so that downstream sweeps don't loop forever.
    mapping(uint256 => mapping(address => bool)) public claimedAt;

    event Received(uint256 amount, address indexed from);
    event Snapped(uint256 indexed snapshotId, uint256 timepoint, uint256 balance);
    event Distributed(uint256 indexed snapshotId, address indexed holder, uint256 amount);

    error NoBalance();
    error AlreadyClaimed();
    error InvalidSnapshot();

    constructor(address _paymentAsset, address _shareToken, uint256 _agentTokenId) {
        paymentAsset = IERC20(_paymentAsset);
        shareToken = ShareToken(_shareToken);
        agentTokenId = _agentTokenId;
    }

    /// @notice Anyone may explicitly fund the vault. The vault also receives funds
    ///         passively from x402 settlement (a direct ERC-20 `transfer` to this
    ///         address); `fund` only exists for clarity-of-intent + the event.
    function fund(uint256 amount) external {
        paymentAsset.safeTransferFrom(msg.sender, address(this), amount);
        emit Received(amount, msg.sender);
    }

    /// @notice Capture the current vault balance into a new snapshot. Permissionless —
    ///         anyone may trigger, KeeperHub does so on a weekly cron.
    /// @return snapshotId Index of the newly-created snapshot.
    function snap() external returns (uint256 snapshotId) {
        uint256 bal = paymentAsset.balanceOf(address(this));
        if (bal == 0) revert NoBalance();

        // ERC20Votes' getPastVotes / getPastTotalSupply require timepoint < block.number.
        // Storing block.number - 1 ensures every later claim resolves cleanly. block 0
        // is unreachable in practice (we'd be in genesis); the unchecked subtraction is
        // safe under any realistic test or chain.
        uint256 timepoint = block.number - 1;

        snapshotId = _snapshots.length;
        _snapshots.push(Snapshot({ timepoint: timepoint, balanceAtSnapshot: bal, ts: uint64(block.timestamp) }));

        emit Snapped(snapshotId, timepoint, bal);
    }

    /// @notice Number of snapshots taken so far.
    function snapshotCount() external view returns (uint256) {
        return _snapshots.length;
    }

    /// @notice Public read of a snapshot's fields.
    function snapshotAt(uint256 snapshotId)
        external
        view
        returns (uint256 timepoint, uint256 balanceAtSnapshot, uint64 ts)
    {
        if (snapshotId >= _snapshots.length) revert InvalidSnapshot();
        Snapshot memory s = _snapshots[snapshotId];
        return (s.timepoint, s.balanceAtSnapshot, s.ts);
    }

    /// @notice Compute the holder's pro-rata claim for a snapshot, ignoring whether
    ///         it's already been settled. Useful for UIs.
    function pendingFor(uint256 snapshotId, address holder) public view returns (uint256) {
        if (snapshotId >= _snapshots.length) revert InvalidSnapshot();
        if (claimedAt[snapshotId][holder]) return 0;

        Snapshot memory s = _snapshots[snapshotId];
        uint256 holderShares = shareToken.getPastVotes(holder, s.timepoint);
        uint256 totalShares = shareToken.getPastTotalSupply(s.timepoint);
        if (holderShares == 0 || totalShares == 0) return 0;

        return s.balanceAtSnapshot * holderShares / totalShares;
    }

    /// @notice Holder pulls their pro-rata payout for a single snapshot.
    function claim(uint256 snapshotId) external {
        _settle(snapshotId, msg.sender);
    }

    /// @notice KeeperHub (or anyone) pushes a holder's pro-rata payout. Idempotent.
    function distributeTo(uint256 snapshotId, address holder) external {
        _settle(snapshotId, holder);
    }

    function _settle(uint256 snapshotId, address holder) internal {
        if (snapshotId >= _snapshots.length) revert InvalidSnapshot();
        if (claimedAt[snapshotId][holder]) revert AlreadyClaimed();

        Snapshot memory s = _snapshots[snapshotId];
        uint256 holderShares = shareToken.getPastVotes(holder, s.timepoint);
        uint256 totalShares = shareToken.getPastTotalSupply(s.timepoint);

        // Mark first to prevent reentrancy from a malicious payment asset (USDC isn't
        // reentrant, but defense-in-depth is cheap).
        claimedAt[snapshotId][holder] = true;

        if (holderShares > 0 && totalShares > 0) {
            uint256 amount = s.balanceAtSnapshot * holderShares / totalShares;
            if (amount > 0) {
                paymentAsset.safeTransfer(holder, amount);
                emit Distributed(snapshotId, holder, amount);
            }
        }
    }
}
