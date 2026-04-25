// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { ShareToken } from "./ShareToken.sol";

/// @title Fractionalizer
/// @notice Locks an agent iNFT in this vault contract and mints 1M ERC-20 shares
///         representing fractional ownership. Singleton per agent NFT contract on
///         0G Chain.
/// @dev We treat the underlying NFT as plain ERC-721 here — the 7857-specific
///      `iTransfer` re-encryption flow is the Marketplace's concern, not ours.
///      Fractionalizer just owns the NFT until 100% of shares are returned.
contract Fractionalizer is IERC721Receiver {
    /// @dev Per-tokenId bookkeeping. `active = true` while the iNFT is locked here.
    struct Vault {
        address shareToken;
        address creator;
        bool active;
    }

    /// @dev The agent NFT contract (assumed to be a single instance shared across all
    ///      Stratum agents — i.e., StratumAgentNFT).
    IERC721 public immutable agentNft;

    /// @dev tokenId → vault state. Inactive vaults can be re-fractionalized, but the
    ///      caller must own the iNFT again (i.e., they previously redeemed it).
    mapping(uint256 => Vault) public vaults;

    event Fractionalized(uint256 indexed tokenId, address shareToken, address indexed creator);
    event Redeemed(uint256 indexed tokenId, address indexed by);

    error AlreadyFractionalized();
    error NotFractionalized();
    error NotOwner();
    error NotFullHolder();

    constructor(address _agentNft) {
        agentNft = IERC721(_agentNft);
    }

    /// @notice Lock `tokenId`, deploy a fresh ShareToken, mint 1M shares to `recipient`.
    /// @dev Caller must own the iNFT and have `setApprovalForAll` or per-token approval
    ///      set for this contract. Reverts with AlreadyFractionalized if a live vault
    ///      already exists.
    function fractionalize(
        uint256 tokenId,
        string calldata shareName,
        string calldata shareSymbol,
        address recipient
    )
        external
        returns (address shareTokenAddr)
    {
        if (vaults[tokenId].active) revert AlreadyFractionalized();
        if (agentNft.ownerOf(tokenId) != msg.sender) revert NotOwner();

        // Pull the iNFT into this contract.
        agentNft.safeTransferFrom(msg.sender, address(this), tokenId);

        // Deploy fresh shares; constructor mints TOTAL_SUPPLY to `recipient`.
        ShareToken shares = new ShareToken(address(agentNft), tokenId, shareName, shareSymbol, recipient);
        shareTokenAddr = address(shares);

        vaults[tokenId] = Vault({ shareToken: shareTokenAddr, creator: msg.sender, active: true });
        emit Fractionalized(tokenId, shareTokenAddr, msg.sender);
    }

    /// @notice Burn 100% of an agent's shares to release the iNFT.
    /// @dev Caller must (a) hold the entire ShareToken supply, and (b) have approved
    ///      this contract for at least `totalSupply` via ERC-20 `approve` (or use
    ///      ERC20Permit out-of-band). The shares are burned via `burnFrom`.
    function redeem(uint256 tokenId) external {
        Vault memory v = vaults[tokenId];
        if (!v.active) revert NotFractionalized();

        ShareToken s = ShareToken(v.shareToken);
        uint256 supply = s.totalSupply();
        if (s.balanceOf(msg.sender) != supply) revert NotFullHolder();

        // Burns from msg.sender — requires allowance(msg.sender, this) >= supply.
        s.burnFrom(msg.sender, supply);

        vaults[tokenId].active = false;
        agentNft.safeTransferFrom(address(this), msg.sender, tokenId);
        emit Redeemed(tokenId, msg.sender);
    }

    /// @inheritdoc IERC721Receiver
    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }
}
