// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title IPOSale
/// @notice Fixed-price sale of an agent's seed share allocation. One IPOSale is
///         deployed per agent at mint time on Base.
/// @dev Pull pattern: shares come *from* `beneficiary` (the operator's treasury)
///      via `transferFrom`, so the beneficiary must approve this contract for the
///      full allocation before the sale opens. Payment goes directly to beneficiary
///      — this contract never custodies funds, only orchestrates the swap.
///
///      Pricing: `pricePerShare` is the smallest unit of `paymentAsset` charged
///      per 1e18 shares (i.e., per 1 whole share).
///        Example: USDC ($1 / share) → pricePerShare = 1_000_000.
contract IPOSale {
    using SafeERC20 for IERC20;

    IERC20 public immutable shareToken;
    IERC20 public immutable paymentAsset;
    uint256 public immutable pricePerShare;
    uint256 public immutable maxShares;
    address public immutable beneficiary;
    uint64 public immutable startsAt;
    uint64 public immutable endsAt;

    uint256 public sold;

    event Bought(address indexed buyer, uint256 amount, uint256 cost);

    error InvalidConfig();
    error NotOpen();
    error SoldOut();
    error ZeroAmount();

    constructor(
        address _shareToken,
        address _paymentAsset,
        uint256 _pricePerShare,
        uint256 _maxShares,
        address _beneficiary,
        uint64 _startsAt,
        uint64 _endsAt
    ) {
        if (_shareToken == address(0) || _paymentAsset == address(0) || _beneficiary == address(0)) {
            revert InvalidConfig();
        }
        if (_pricePerShare == 0 || _maxShares == 0) revert InvalidConfig();
        if (_startsAt >= _endsAt) revert InvalidConfig();

        shareToken = IERC20(_shareToken);
        paymentAsset = IERC20(_paymentAsset);
        pricePerShare = _pricePerShare;
        maxShares = _maxShares;
        beneficiary = _beneficiary;
        startsAt = _startsAt;
        endsAt = _endsAt;
    }

    /// @notice Buy `amount` shares (in 1e18 units) at the fixed price.
    /// @dev Reverts if outside the time window, the round is sold out, or amount is 0.
    function buy(uint256 amount) external {
        if (block.timestamp < startsAt || block.timestamp >= endsAt) revert NotOpen();
        if (amount == 0) revert ZeroAmount();
        if (sold + amount > maxShares) revert SoldOut();

        uint256 cost = amount * pricePerShare / 1e18;

        // Effects first.
        sold += amount;

        // Interactions: pull payment to beneficiary, push shares from beneficiary.
        paymentAsset.safeTransferFrom(msg.sender, beneficiary, cost);
        shareToken.safeTransferFrom(beneficiary, msg.sender, amount);

        emit Bought(msg.sender, amount, cost);
    }

    /// @notice Shares still available in this round.
    function available() external view returns (uint256) {
        return maxShares - sold;
    }

    /// @notice True iff the current block.timestamp is within [startsAt, endsAt).
    function isOpen() external view returns (bool) {
        return block.timestamp >= startsAt && block.timestamp < endsAt;
    }
}
