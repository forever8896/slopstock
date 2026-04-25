// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAgentNFT } from "../interfaces/IAgentNFT.sol";

/// @title AgentRegistry
/// @notice One-shot registry mapping `tokenId` → cross-chain pointers (share token,
///         RevenueVault on Base, ENS namehash, original operator, mint timestamp).
/// @dev Registration is gated on iNFT ownership at the time of the call. Entries are
///      immutable: the `operator` field is the original minter even after the iNFT
///      is acquired, and `vaultBase` / `shareToken` / `ensNameHash` are pinned at
///      mint time. Acquisitions don't update the registry — that's the iNFT's job
///      via `iTransfer`.
contract AgentRegistry {
    struct AgentInfo {
        address shareToken;
        address vaultBase;
        bytes32 ensNameHash;
        address operator;
        uint64 createdAt;
    }

    IAgentNFT public immutable agentNft;

    mapping(uint256 => AgentInfo) private _info;

    event Registered(
        uint256 indexed tokenId, address shareToken, address vaultBase, bytes32 ensNameHash, address operator
    );

    error AlreadyRegistered();
    error NotOwner();
    error InvalidConfig();

    constructor(address _agentNft) {
        if (_agentNft == address(0)) revert InvalidConfig();
        agentNft = IAgentNFT(_agentNft);
    }

    /// @notice Register an agent. Caller must currently own the iNFT.
    /// @dev `vaultBase` and `ensNameHash` may be left zero if the operator hasn't
    ///      finished setting up the cross-chain pieces, but the entry is still
    ///      one-shot. `shareToken` is required since the registry's main job is to
    ///      let dApps find the shares for any given iNFT.
    function register(uint256 tokenId, address shareToken, address vaultBase, bytes32 ensNameHash) external {
        if (_info[tokenId].operator != address(0)) revert AlreadyRegistered();
        if (agentNft.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (shareToken == address(0)) revert InvalidConfig();

        _info[tokenId] = AgentInfo({
            shareToken: shareToken,
            vaultBase: vaultBase,
            ensNameHash: ensNameHash,
            operator: msg.sender,
            createdAt: uint64(block.timestamp)
        });

        emit Registered(tokenId, shareToken, vaultBase, ensNameHash, msg.sender);
    }

    /// @notice Read an entry. Returns a zeroed struct if `tokenId` is unregistered.
    function info(uint256 tokenId) external view returns (AgentInfo memory) {
        return _info[tokenId];
    }

    /// @notice True iff `tokenId` has been registered.
    function isRegistered(uint256 tokenId) external view returns (bool) {
        return _info[tokenId].operator != address(0);
    }
}
