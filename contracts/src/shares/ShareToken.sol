// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { ERC20Votes } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import { Nonces } from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title ShareToken
/// @notice ERC-20 fractional shares of a single Stratum agent. One ShareToken per agent.
///         Total supply: 1,000,000 × 10^18, minted in full to `recipient` at construction.
/// @dev Uses ERC20Votes' historical balance lookups (`getPastVotes` /
///      `getPastTotalSupply`) so RevenueVault can snapshot holders at a given block
///      and distribute pro-rata. To avoid forcing every holder to call `delegate(self)`
///      before they can earn dividends, we auto-delegate on receive — see `_update`.
///      ERC20Permit is included so future flows (acquisition, redeem) can use signed
///      permits instead of separate `approve` transactions.
contract ShareToken is ERC20Burnable, ERC20Permit, ERC20Votes {
    /// @dev 1M shares with 18 decimals, identical for every Stratum agent.
    uint256 public constant TOTAL_SUPPLY = 1_000_000 * 1e18;

    /// @dev Pointer back to the iNFT this share token represents (informational —
    ///      iNFT is on 0G Chain while this token may live on Base).
    address public immutable agentNft;
    uint256 public immutable agentTokenId;

    constructor(
        address _agentNft,
        uint256 _agentTokenId,
        string memory name_,
        string memory symbol_,
        address recipient
    )
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        agentNft = _agentNft;
        agentTokenId = _agentTokenId;
        _mint(recipient, TOTAL_SUPPLY);
    }

    /// @dev Auto-delegate-to-self on first receive so checkpoints are written without
    ///      requiring a separate `delegate(self)` transaction. Must run before
    ///      `super._update` so the subsequent voting-units transfer credits the
    ///      recipient's own checkpoint.
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        if (to != address(0) && delegates(to) == address(0)) {
            _delegate(to, to);
        }
        super._update(from, to, value);
    }

    /// @dev Required override: ERC20Permit and Nonces both define `nonces(address)`.
    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
