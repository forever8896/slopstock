// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAgentNFT } from "../interfaces/IAgentNFT.sol";

/// @title StratumAgentNFT
/// @notice Subclass of the 0G Foundation reference ERC-7857 implementation that adds
///         per-tokenId pointers to the Stratum share token, revenue vault, and ENS name.
/// @dev Stub. Implementation pending — we fork `0gfoundation/0g-agent-nft` and extend.
///      See docs/02-smart-contracts.md §3.3.
contract StratumAgentNFT {
    /// @dev tokenId → ERC-20 share token (zero until fractionalized).
    mapping(uint256 => address) public shareToken;

    /// @dev tokenId → RevenueVault address (cross-chain pointer; vault lives on Base).
    mapping(uint256 => address) public revenueVault;

    /// @dev tokenId → human-readable ENS name (e.g. "auditor.stratum.eth").
    mapping(uint256 => string) public ensName;

    // TODO: extend the forked 7857 impl. Override _afterTransfer to clear authorizeUsage[]
    //       (already mandated by the spec — verified in tests).

    // TODO: setMappings(tokenId, shareToken, revenueVault, ensName) — only operator at mint time.
}
