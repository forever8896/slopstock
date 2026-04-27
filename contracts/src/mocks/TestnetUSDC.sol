// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestnetUSDC
/// @notice ERC-20 with a permissionless `mint` for chains where Circle's testnet
///         USDC isn't available (i.e. 0G Galileo). Decimals = 6 to match real USDC.
/// @dev Not a "mock" in the unit-test sense — this is the production-on-testnet
///      USDC stand-in for Stratum demos. Anyone can mint themselves USDC on the
///      target chain. On Base Sepolia we use Circle's real testnet USDC instead.
contract TestnetUSDC is ERC20 {
    constructor() ERC20("USD Coin (Stratum testnet)", "USDC") { }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint USDC to any address. Permissionless on testnet by design.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
