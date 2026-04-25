// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ShareToken
/// @notice ERC-20 fractional shares of a single Stratum agent (one ShareToken per agent).
/// @dev Stub. Spec: docs/02-smart-contracts.md §4.
///      Total supply: 1,000,000 shares (× 1e18). Owner = RevenueVault.
contract ShareToken is ERC20, Ownable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000 * 1e18;

    address public immutable agentNft;
    uint256 public immutable agentTokenId;

    constructor(address _agentNft, uint256 _agentTokenId, string memory name_, string memory symbol_, address recipient)
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {
        agentNft = _agentNft;
        agentTokenId = _agentTokenId;
        _mint(recipient, TOTAL_SUPPLY);
    }

    // TODO: snapshot() — only RevenueVault (after we transfer ownership to vault).
    //       Use OZ ERC20Votes/ERC20Snapshot or a hand-rolled checkpoint scheme.
}
